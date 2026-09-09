import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CONTEXT_MAP_REPOSITORIES,
  integrateRouterOutput,
  recordContextEntry,
  refreshContextMap,
  sourceFingerprint,
  validateContextMap,
} from '../wayper-context-map.mjs';
import { fingerprintCorpus } from './check-graph-scopes.mjs';

const REQUIRED_FEATURES = new Set(['EVIDENCE', 'DEPENDENCY', 'RISK_LIFECYCLE', 'PERSISTENCE',
  'TERRITORY', 'MULTI_CAPABILITY', 'SITE_ONLY', 'CROSS_REPO', 'EVIDENCE_STALENESS',
  'GRAPHIFY_NOT_NEEDED', 'GRAPHIFY_TARGETED', 'EVIDENCE_DEDUP', 'PROOF_GAP',
  'KNOWN_GOOD_UNCHANGED', 'KNOWN_GOOD_QUESTIONED']);
const CEILINGS = { BOUNDED: 4_000, BUG: 8_000, INVESTIGATION: 10_000,
  ARCHITECTURAL: 16_000, CRITICAL_RUNTIME: 24_000 };
const hash = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

function sourceLocation(root, spec) {
  const separator = spec.indexOf(':');
  const repository = CONTEXT_MAP_REPOSITORIES.has(spec.slice(0, separator)) ? spec.slice(0, separator) : 'wayper';
  const relativePath = repository === 'wayper' && !spec.startsWith('wayper:') ? spec : spec.slice(separator + 1);
  const sourceRoot = repository === 'wayper' ? root : path.resolve(root, '../wayper-site');
  const file = path.resolve(sourceRoot, relativePath);
  if (!file.startsWith(`${path.resolve(sourceRoot)}${path.sep}`) || !fs.statSync(file).isFile()) {
    throw new Error(`Invalid eval source: ${spec}`);
  }
  return { file, repository };
}

function createRepositories(item, sourceRoot) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `wayper-map-${item.id.toLowerCase()}-`));
  const materializedRoot = path.join(parent, 'without-map');
  fs.mkdirSync(materializedRoot);
  let materializedBytes = 0;
  const repositories = item.repositories.map((id) => {
    const root = path.join(parent, id);
    fs.mkdirSync(path.join(root, 'fixtures'), { recursive: true });
    fs.writeFileSync(path.join(root, '.gitignore'), 'graphify-out/\n');
    return { id, root, logicalRoot: id === 'wayper' ? '.' : '../wayper-site' };
  });
  const artifacts = item.sourceArtifacts.map((source, index) => {
    const location = sourceLocation(sourceRoot, source);
    const repository = repositories.find((entry) => entry.id === location.repository)
      ?? repositories[index % repositories.length];
    const relativePath = `fixtures/artifact-${index}.txt`;
    const content = fs.readFileSync(location.file);
    fs.writeFileSync(path.join(repository.root, relativePath), content);
    for (let copy = 0; copy < item.materializationCopies; copy += 1) {
      const materialized = path.join(materializedRoot, `${index}-${copy}.txt`);
      fs.writeFileSync(materialized, content);
      materializedBytes += fs.statSync(materialized).size;
    }
    return { repository: repository.id, relativePath };
  });
  for (const repository of repositories) {
    fs.writeFileSync(path.join(repository.root, 'fixtures/test.txt'), 'fixture dependency\n');
    execFileSync('git', ['init', '-q'], { cwd: repository.root });
    execFileSync('git', ['add', '.'], { cwd: repository.root });
    execFileSync('git', ['-c', 'user.name=Wayper', '-c', 'user.email=wayper@example.test',
      'commit', '-qm', 'fixture'], { cwd: repository.root });
  }
  return { parent, repositories, artifacts, materializedBytes };
}

function writeGraphFixture(repository) {
  const directory = path.join(repository.root, 'graphify-out');
  fs.mkdirSync(directory, { recursive: true });
  const graph = { nodes: [{ id: 'fixture_owner' }, { id: 'fixture_test' }],
    edges: [{ source: 'fixture_owner', target: 'fixture_test', relation: 'tests' }] };
  const graphSource = JSON.stringify(graph);
  fs.writeFileSync(path.join(directory, 'graph.json'), graphSource);
  const metadata = { schemaVersion: 1, repository: repository.id,
    root: fs.realpathSync(repository.root), branch: 'main', head: execFileSync('git', ['rev-parse', 'HEAD'],
      { cwd: repository.root, encoding: 'utf8' }).trim(),
    sourceFingerprint: fingerprintCorpus({ repository: repository.id, root: repository.root,
      peerDirectory: repository.id === 'wayper' ? 'wayper-site' : 'wayper', querySymbols: [] }).fingerprint,
    graphSha256: hash(graphSource), graphifyVersion: 'graphify eval-1',
    builtAt: 'fixture', buildMode: 'full', scope: 'repository-code-only' };
  fs.writeFileSync(path.join(directory, 'scope.json'), JSON.stringify(metadata));
  return metadata;
}

function routerOutput(item, features, decision) {
  const capabilities = [features.has('MULTI_CAPABILITY') ? 'context-efficiency' : null,
    features.has('MULTI_CAPABILITY') ? 'quality-gates' : null].filter(Boolean);
  const facts = { goalId: item.id, knownGoodCapabilities: [], changedFiles: [], candidatePaths: [],
    questionsExistingBehavior: false };
  return { mode: 'SHADOW', routerVersion: 'eval-1', taskFingerprint: { hash: hash(JSON.stringify(facts)), facts },
    repositories: [...item.repositories], requiredCapabilities: capabilities.map((id) => ({ id })),
    optionalCapabilities: [], selectedProfiles: [], coverage: { required: { uncovered: [] } },
    graphifyDecision: decision, requiresModelJudgment: false, ambiguities: [] };
}

function executeCase(item, sourceRoot) {
  const features = new Set(item.features);
  const fixture = createRepositories(item, sourceRoot);
  try {
    const byId = new Map(fixture.repositories.map((repository) => [repository.id, repository]));
    const first = fixture.artifacts[0];
    const workingArtifacts = features.has('KNOWN_GOOD_UNCHANGED') || features.has('KNOWN_GOOD_QUESTIONED')
      ? [{ repository: first.repository, spec: first.relativePath, status: 'KNOWN_GOOD_UNCHANGED',
        fingerprint: sourceFingerprint(byId.get(first.repository).root, first.relativePath).hash,
        evidence: [`${first.relativePath}:1`] }] : [];
    const risks = features.has('RISK_LIFECYCLE') ? ['LIFECYCLE']
      : features.has('PERSISTENCE') ? ['OFFLINE_STORAGE']
        : features.has('TERRITORY') ? ['GEOSPATIAL'] : ['BUILD_TOOLING'];
    const options = { goalId: item.id, taskClass: item.taskClass,
      tokenCeiling: CEILINGS[item.taskClass], repositories: fixture.repositories,
      risks, validations: ['eval'], workingArtifacts };
    let map = refreshContextMap(null, options);
    const targeted = features.has('GRAPHIFY_TARGETED') || features.has('GRAPHIFY_ISOLATED');
    map = integrateRouterOutput(map, routerOutput(item, features,
      targeted ? 'TARGETED_RECOMMENDED' : 'NOT_NEEDED'), options);

    for (const [index, artifact] of fixture.artifacts.entries()) {
      map = recordContextEntry(map, 'evidence', { repository: artifact.repository,
        path: artifact.relativePath, category: item.features[0], claim: `Artifact ${index} supports ${item.id}`,
        provenance: 'SOURCE', status: 'PROVEN' }, fixture.repositories, options);
    }
    if (features.has('EVIDENCE_DEDUP')) {
      map = recordContextEntry(map, 'evidence', { repository: first.repository, path: first.relativePath,
        category: item.features[0].toLocaleLowerCase(), claim: `artifact 0 supports ${item.id}!`,
        provenance: 'SOURCE', status: 'PROVEN' }, fixture.repositories, options);
    }
    if (features.has('DEPENDENCY') || features.has('CROSS_REPO')) {
      const target = features.has('CROSS_REPO') ? fixture.repositories.find((repo) => repo.id !== first.repository) : byId.get(first.repository);
      map = recordContextEntry(map, 'dependency', {
        from: { repository: first.repository, ref: first.relativePath },
        to: { repository: target.id, ref: 'fixtures/test.txt' }, relation: 'TESTS', provenance: 'TEST',
        evidenceIds: [map.evidence.find((entry) => entry.repository === first.repository &&
          entry.path === first.relativePath).id],
      }, fixture.repositories, options);
    }
    if (features.has('PROOF_GAP')) map = recordContextEntry(map, 'proof-gap', {
      claim: 'Physical behavior remains unobserved', reason: 'Fixture has no physical device',
      requiredEvidence: 'Observed device result', status: 'OPEN',
    }, fixture.repositories, options);
    if (targeted) for (const repository of fixture.repositories) {
      const metadata = writeGraphFixture(repository);
      map = recordContextEntry(map, 'graphify', { repository: repository.id,
        version: metadata.graphifyVersion, scopeFingerprint: metadata.sourceFingerprint,
        graphFingerprint: metadata.graphSha256, purpose: `Locate ${repository.id} owner`,
        nodeRefs: [`${repository.id}:fixture_owner`],
        edgeRefs: [`${repository.id}:fixture_owner->fixture_test`],
      }, fixture.repositories, options);
    }
    if (features.has('KNOWN_GOOD_QUESTIONED')) map = refreshContextMap(map,
      { ...options, questions: [first.relativePath] });
    if (features.has('EVIDENCE_STALENESS')) {
      fs.appendFileSync(path.join(byId.get(first.repository).root, first.relativePath), '\nchanged after proof\n');
      map = refreshContextMap(map, options);
    }
    map = recordContextEntry(map, 'validation', { id: 'eval', status: 'PASS',
      evidence: `node --test ${item.id} PASS` }, fixture.repositories, options);

    const validation = validateContextMap(map, { repositoryDefinitions: fixture.repositories });
    const serializedBytes = Buffer.byteLength(JSON.stringify(map));
    const assertions = {
      structurallyValid: validation.status === 'VALID',
      serializedMetric: map.metrics.bytes === serializedBytes,
      shadowOnly: map.router?.mode === 'SHADOW',
      siteIsolated: !features.has('SITE_ONLY') || map.evidence.every((entry) => entry.repository === 'wayper-site'),
      crossRepository: !features.has('CROSS_REPO') || map.dependencies.some((entry) => entry.from.repository !== entry.to.repository),
      dependencyRecorded: !features.has('DEPENDENCY') || map.dependencies.length > 0,
      deduplicated: !features.has('EVIDENCE_DEDUP') || map.evidence.length === fixture.artifacts.length,
      staleDetected: !features.has('EVIDENCE_STALENESS') || map.evidence.some((entry) => entry.status === 'STALE'),
      proofGapVisible: !features.has('PROOF_GAP') || map.proofGaps.some((entry) => entry.status === 'OPEN'),
      knownGoodStable: !features.has('KNOWN_GOOD_UNCHANGED') || map.knownGood.some((entry) => entry.status === 'KNOWN_GOOD_UNCHANGED'),
      knownGoodQuestioned: !features.has('KNOWN_GOOD_QUESTIONED') || map.knownGood.some((entry) => entry.status === 'QUESTIONED'),
      graphDecision: targeted ? Object.values(map.graphify).every((entry) => entry.status === 'CURRENT')
        : Object.values(map.graphify).every((entry) => entry.status === 'NOT_USED' && entry.queries.length === 0),
      graphIsolation: !features.has('GRAPHIFY_ISOLATED') || Object.entries(map.graphify).every(([repository, graph]) =>
        graph.queries.every((query) => [...query.nodeRefs, ...query.edgeRefs].every((ref) => ref.startsWith(`${repository}:`)))),
    };
    const withoutMapBytes = fixture.materializedBytes;
    const withMapBytes = serializedBytes;
    const reduction = withoutMapBytes ? (withoutMapBytes - withMapBytes) / withoutMapBytes : 0;
    return { id: item.id, withoutMapBytes, withMapBytes,
      withoutMapTokenProxy: Math.ceil(withoutMapBytes / 4), withMapTokenProxy: Math.ceil(withMapBytes / 4),
      reduction, assertions, metrics: { evidenceAttempts: fixture.artifacts.length + Number(features.has('EVIDENCE_DEDUP')),
        storedEvidence: map.evidence.length, dependencies: map.dependencies.length,
        graphQueries: Object.values(map.graphify).reduce((sum, graph) => sum + graph.queries.length, 0),
        proofGaps: map.proofGaps.length },
      pass: Object.values(assertions).every(Boolean) && reduction >= 0.5 };
  } finally {
    fs.rmSync(fixture.parent, { recursive: true, force: true });
  }
}

export function evaluateContextMapCases(suite, sourceRoot) {
  const cases = suite.contextMapCases;
  if (!Array.isArray(cases) || cases.length < 15 || new Set(cases.map((item) => item.id)).size !== cases.length ||
    [...REQUIRED_FEATURES].some((feature) => !cases.some((item) => item.features?.includes(feature)))) {
    throw new Error('Context Map eval corpus is incomplete');
  }
  for (const item of cases) if (!item.id || !CEILINGS[item.taskClass] || !Array.isArray(item.repositories) ||
    item.repositories.some((id) => !CONTEXT_MAP_REPOSITORIES.has(id)) || !item.sourceArtifacts?.length ||
    !Number.isInteger(item.materializationCopies) || item.materializationCopies < 1) {
    throw new Error(`Invalid Context Map eval: ${item.id}`);
  }
  return cases.map((item) => executeCase(item, sourceRoot));
}
