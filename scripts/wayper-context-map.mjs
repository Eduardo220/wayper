import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sourceFingerprint, RECEIPT_ID, EVIDENCE_KINDS, EVIDENCE_ORIGINS, validateEvidenceRequirement } from './wayper-evidence-receipts.mjs';
import { readReceipt, receiptIndexEntry, evaluateEvidenceRequirement } from './wayper-evidence-store.mjs';
import { fingerprintCorpus } from './quality/check-graph-scopes.mjs';
import { validateRouterSelectionReceipt } from './wayper-agent-router.mjs';
import { assertGoalExecution, assertSameExecution, invalidateMapProofs, repositorySnapshot } from './wayper-context-identity.mjs';
import { createContextValidationPlan, refreshContextValidationPlan } from './wayper-validation-store.mjs';

export { sourceFingerprint } from './wayper-evidence-receipts.mjs';

export const CONTEXT_MAP_SCHEMA_VERSION = 2;
export const CONTEXT_MAP_REPOSITORIES = new Set(['wayper', 'wayper-site']);
const EVIDENCE_STATUSES = new Set(['PROVEN', 'HIGH_CONFIDENCE', 'INFERRED', 'UNVALIDATED', 'STALE']);
const EVIDENCE_PROVENANCE = new Set(['SOURCE', 'TEST', 'CONFIG', 'DOC', 'GRAPHIFY', 'COMMAND', 'OBSERVATION']);
const DEPENDENCY_PROVENANCE = new Set(['SOURCE', 'GRAPHIFY', 'CONFIG', 'TEST', 'DOC']);
const DEPENDENCY_RELATIONS = new Set(['CALLS', 'IMPORTS', 'OWNS', 'RUNTIME', 'TESTS', 'CONTRACT']);
const GRAPHIFY_DECISIONS = new Set(['NOT_NEEDED', 'TARGETED_RECOMMENDED', 'REQUIRED_BY_STRUCTURAL_UNCERTAINTY']);
const REUSABLE_EVIDENCE = new Set(['PROVEN', 'HIGH_CONFIDENCE']);
const PRIOR_ANALYSIS_CONCLUSION = 'PRIOR_ANALYSIS_CONCLUSION';
const HASH = /^sha256:[a-f0-9]{64}$/;
const PROHIBITED_KEY = /source.?blob|transcript|chain.?of.?thought|tool.?diar|raw.?graph|raw.?diff|agent.?summar/i;

const sortedUnique = (items = []) => [...new Set(items)].sort();
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const idFor = (prefix, value) => `${prefix}-${sha256(stable(value)).slice(7, 19)}`;
const compactText = (value, field, limit = 240) => {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text || Buffer.byteLength(text) > limit) throw new Error(`Invalid ${field}`);
  return text;
};
const normalizedClaim = (value) => compactText(value, 'claim').normalize('NFKC').toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const normalizedCategory = (value) => normalizedClaim(value).toLocaleUpperCase().replaceAll(' ', '_');
const parseRange = (value) => {
  if (value == null) return null;
  const match = String(value).match(/^L(\d+)(?:-L(\d+))?$/);
  if (!match || Number(match[2] ?? match[1]) < Number(match[1])) throw new Error(`Invalid range: ${value}`);
  return { value: String(value), start: Number(match[1]), end: Number(match[2] ?? match[1]) };
};
const artifactLocation = (spec) => {
  const match = String(spec).match(/^(.*?)(?:#(L\d+(?:-L\d+)?))?$/);
  return { path: match[1], range: match[2] ?? null };
};
const workingArtifactSpec = (artifact) => {
  if (!artifact.path) return artifact.spec;
  if (artifact.start == null) return artifact.path;
  return `${artifact.path}#L${artifact.start}-L${artifact.end}`;
};

function repoFile(root, relativePath, allowMissing = false) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error(`Invalid repository path: ${relativePath}`);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes repository: ${relativePath}`);
  }
  if (!fs.existsSync(resolved)) {
    if (allowMissing) return null;
    throw new Error(`Missing repository file: ${relativePath}`);
  }
  const real = fs.realpathSync(resolved);
  const realRoot = fs.realpathSync(root);
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`Path escapes repository through symlink: ${relativePath}`);
  }
  if (!fs.statSync(real).isFile()) throw new Error(`Not a file: ${relativePath}`);
  return real;
}

function observedSourceFingerprint(root, relativePath, rangeValue = null) {
  try {
    const current = sourceFingerprint(root, relativePath, rangeValue);
    return { current, invalidationReason: current ? null : 'SOURCE_MISSING' };
  } catch (error) {
    if (/Artifact range exceeds file/.test(error.message)) {
      return { current: null, invalidationReason: 'RANGE_INVALIDATED' };
    }
    throw error;
  }
}

function graphifySnapshot(repository, repo) {
  const metadata = JSON.parse(fs.readFileSync(repoFile(repo.root, 'graphify-out/scope.json'), 'utf8'));
  const graphSource = fs.readFileSync(repoFile(repo.root, 'graphify-out/graph.json'));
  const graph = JSON.parse(graphSource);
  const corpus = fingerprintCorpus({ repository, root: repo.root,
    peerDirectory: repository === 'wayper' ? 'wayper-site' : 'wayper', querySymbols: [] });
  if (metadata.repository !== repository || metadata.scope !== 'repository-code-only' ||
    path.resolve(metadata.root) !== fs.realpathSync(repo.root) || !HASH.test(metadata.sourceFingerprint ?? '') ||
    metadata.sourceFingerprint !== corpus.fingerprint ||
    metadata.graphSha256 !== sha256(graphSource) || !metadata.graphifyVersion ||
    !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error(`Invalid repository-scoped Graphify metadata: ${repository}`);
  }
  return { metadata, graph,
    nodes: new Set(graph.nodes.map((item) => `${repository}:${item.id}`)),
    edges: new Set(graph.edges.map((item) => `${repository}:${item.source}->${item.target}`)) };
}

function reusableProofIds(map) {
  return new Set([
    ...map.evidence.filter((item) => REUSABLE_EVIDENCE.has(item.status)).map((item) => item.id),
    ...map.validation.checks.filter((item) => item.status === 'PASS').map((item) => item.id),
  ]);
}

function receiptOptions(map, repositories, options = {}) {
  return { root: options.root ?? repositories.find((repo) => repo.id === 'wayper')?.root ?? repositories[0]?.root,
    execution: map.execution, repositories };
}

function indexReceipt(map, id, repositories, options) {
  const context = receiptOptions(map, repositories, options);
  const receipt = readReceipt(id, context);
  if (!receipt) throw new Error('Missing Evidence Receipt');
  const entry = receiptIndexEntry(receipt, context);
  if (entry.verification === 'INVALID') throw new Error(`Invalid Evidence Receipt: ${entry.reasons.join(',')}`);
  map.evidenceReceipts ??= [];
  map.evidenceReceipts = [...map.evidenceReceipts.filter((item) => item.receiptId !== id), entry];
}

function refreshReceiptIndex(map, repositories, options) {
  const context = receiptOptions(map, repositories, options);
  map.evidenceReceipts ??= [];
  const relatedIds = sortedUnique([...map.evidence.map((item) => item.receiptId),
    ...map.validation.checks.map((item) => item.evidence), ...map.knownGood.flatMap((item) => item.receiptIds ?? []),
    ...map.proofGaps.flatMap((item) => item.receiptIds ?? []),
    ...(map.validationPlan?.requirements ?? []).flatMap((item) => item.acceptedReceiptIds)].filter((id) => RECEIPT_ID.test(id)));
  for (const id of relatedIds) if (!map.evidenceReceipts.some((item) => item.receiptId === id)) {
    let receipt;
    try { receipt = readReceipt(id, context); } catch { /* Unavailable refs never acquire verification. */ }
    if (receipt) map.evidenceReceipts.push(receiptIndexEntry(receipt, context));
  }
  map.evidenceReceipts = (map.evidenceReceipts ?? []).map((entry) => {
    let receipt;
    try { receipt = readReceipt(entry.receiptId, context); } catch { /* Corrupt/missing evidence stays visible. */ }
    return receipt ? receiptIndexEntry(receipt, context) : { ...entry, verification: 'INVALID', reasons: ['MISSING_RECEIPT'] };
  });
  const accepts = (policy, ids) => evaluateEvidenceRequirement(policy, ids, context).status === 'SATISFIED';
  for (const entry of map.evidence) {
    if (!entry.receiptId) { delete entry.verification; continue; } // Legacy refs remain assertions by default.
    entry.verification = accepts({ kinds: ['SOURCE', 'DOCUMENT'],
    repository: entry.repository, path: entry.path, range: entry.range ?? null, result: 'OBSERVED' }, [entry.receiptId])
    ? 'VERIFIED_SOURCE_OBSERVATION' : 'ASSERTED';
  }
  for (const check of map.validation.checks) {
    // No receipt means LEGACY_UNVERIFIED. Omit this repeated default in the bounded Map.
    if (!RECEIPT_ID.test(check.evidence ?? '')) { delete check.verification; continue; }
    check.verification = check.status === 'PASS' && accepts({
    kinds: ['COMMAND', 'TEST', 'QUALITY_GATE'], repository: map.evidenceReceipts.find((item) => item.receiptId === check.evidence)?.repository ?? 'wayper',
    target: check.id, result: 'PASS' }, [check.evidence]) ? 'VERIFIED' : 'LEGACY_UNVERIFIED';
  }
  for (const item of map.knownGood) {
    const ids = sortedUnique([...(item.receiptIds ?? []), ...item.proofRefs.flatMap((ref) => {
      const evidence = map.evidence.find((entry) => entry.id === ref);
      const check = map.validation.checks.find((entry) => entry.id === ref);
      return [evidence?.receiptId, check?.evidence].filter((id) => RECEIPT_ID.test(id));
    })]);
    const location = item.artifact ? artifactLocation(item.artifact) : null;
    item.receiptIds = ids;
    item.verification = (location && accepts({ kinds: ['SOURCE', 'DOCUMENT'], repository: item.repository,
      path: location.path, range: location.range, result: 'OBSERVED' }, ids) || !location && accepts({
      kinds: ['QUALITY_GATE'], repository: item.repository, target: 'quality:capabilities', result: 'PASS' }, ids))
      ? 'VERIFIED' : 'KNOWN_GOOD_UNVERIFIED';
  }
  for (const gap of map.proofGaps) gap.verification = gap.receiptRequirement &&
    accepts(gap.receiptRequirement, gap.receiptIds) ? 'VERIFIED' : 'UNVERIFIED';
}

function registryCapabilityFingerprint(registry, capability) {
  const entry = registry?.capabilities?.find((item) => item.id === capability);
  return entry ? sha256(stable(entry)) : null;
}

export function capabilityRegistryFingerprint(registry) {
  return registry ? sha256(stable(registry)) : null;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitFingerprint(root, relevantPaths = [], id = 'wayper') {
  const snapshot = repositorySnapshot({ id, root });
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const paths = sortedUnique(relevantPaths.map((item) => item.replace(/#L\d+(?:-L\d+)?$/, '')));
  const diff = git(root, ['diff', '--no-ext-diff', '--binary', 'HEAD']);
  const relevantDiff = paths.length ? git(root, ['diff', '--no-ext-diff', '--binary', 'HEAD', '--', ...paths]) : '';
  const untracked = status.split('\0').filter((item) => item.startsWith('?? ')).map((item) => item.slice(3));
  const untrackedHashes = untracked.map((item) => `${item}:${sourceFingerprint(root, item)?.hash ?? 'MISSING'}`).join('\n');
  const relevantUntracked = untracked.filter((item) => paths.includes(item))
    .map((item) => `${item}:${sourceFingerprint(root, item)?.hash ?? 'MISSING'}`).join('\n');
  return {
    branch: snapshot.branch ?? 'DETACHED', head: snapshot.head,
    checkoutFingerprint: snapshot.checkoutFingerprint, dirty: snapshot.dirty,
    contentFingerprint: snapshot.contentFingerprint,
    dirtyFingerprint: sha256(`${status}\n${diff}\n${untrackedHashes}`),
    relevantDiffFingerprint: sha256(`${relevantDiff}\n${relevantUntracked}`),
  };
}

function definitions(value) {
  const result = new Map();
  for (const item of value) {
    if (!CONTEXT_MAP_REPOSITORIES.has(item.id) || result.has(item.id) || !path.isAbsolute(item.root)) {
      throw new Error(`Invalid repository definition: ${item.id}`);
    }
    result.set(item.id, item);
  }
  if (!result.size) throw new Error('At least one repository is required');
  return result;
}

function delta(map, payload) {
  const entry = { id: idFor('LD', payload), phase: payload.phase ?? 'CURRENT',
    added: sortedUnique(payload.added), updated: sortedUnique(payload.updated),
    invalidated: sortedUnique(payload.invalidated) };
  if (![...entry.added, ...entry.updated, ...entry.invalidated].length) return;
  if (!map.learningDelta.some((item) => item.id === entry.id)) map.learningDelta.push(entry);
  map.learningDelta.sort((left, right) => left.id.localeCompare(right.id));
}

function baseMap({ goalId, execution, taskClass, tokenCeiling }) {
  return {
    schemaVersion: CONTEXT_MAP_SCHEMA_VERSION,
    goalId,
    execution: structuredClone(execution),
    taskClass,
    repositories: [],
    taskFingerprint: null,
    routerFingerprint: null,
    registryFingerprint: null,
    repositoryState: {},
    capabilities: { required: [], optional: [], knownGood: [] },
    router: null,
    risks: [],
    invariants: [],
    evidence: [],
    evidenceReceipts: [],
    dependencies: [],
    knownGood: [],
    graphify: {},
    validation: { structural: 'VALID', fingerprint: null, checks: [] },
    learningDelta: [],
    ambiguities: [],
    proofGaps: [],
    metrics: { tokenProxyCeiling: tokenCeiling },
  };
}

function semanticFingerprint(map) {
  const copy = structuredClone(map);
  delete copy.metrics;
  copy.validation = { checks: copy.validation?.checks ?? [] };
  return sha256(stable(copy));
}

export function finalizeContextMap(map, { tokenCeiling, budgetReason } = {}) {
  const next = structuredClone(map);
  if (next.evidenceReceipts) next.evidenceReceipts.sort((a, b) => a.receiptId.localeCompare(b.receiptId));
  next.evidence.sort((a, b) => a.id.localeCompare(b.id));
  next.dependencies.sort((a, b) => a.id.localeCompare(b.id));
  next.knownGood.sort((a, b) => a.id.localeCompare(b.id));
  next.proofGaps.sort((a, b) => a.id.localeCompare(b.id));
  for (const graph of Object.values(next.graphify)) {
    graph.queries.sort((a, b) => a.queryFingerprint.localeCompare(b.queryFingerprint));
  }
  next.validation = { checks: [...(next.validation?.checks ?? [])].sort((a, b) => a.id.localeCompare(b.id)) };
  next.validation = { structural: 'VALID', fingerprint: semanticFingerprint(next), checks: next.validation.checks };
  const ceiling = tokenCeiling ?? next.metrics?.tokenProxyCeiling;
  let metrics = {};
  for (let index = 0; index < 6; index += 1) {
    const candidate = { ...next, metrics };
    const bytes = Buffer.byteLength(JSON.stringify(candidate));
    const tokenProxy = Math.ceil(bytes / 4);
    metrics = {
      bytes, tokenProxy, tokenProxyCeiling: ceiling,
      budgetStatus: tokenProxy > ceiling ? 'OVER_BUDGET' : 'WITHIN_BUDGET',
      ...(tokenProxy > ceiling && (budgetReason ?? next.metrics?.budgetReason)
        ? { budgetReason: compactText(budgetReason ?? next.metrics.budgetReason, 'budget reason') } : {}),
      evidenceCount: next.evidence.length,
      dependencyCount: next.dependencies.length,
      knownGoodCount: next.knownGood.length,
      proofGapCount: next.proofGaps.length,
      referencedSourceBytes: next.evidence.filter((item) => item.status !== 'STALE')
        .reduce((sum, item) => sum + (item.sourceBytes ?? 0), 0),
    };
  }
  next.metrics = metrics;
  return next;
}

export function refreshContextMap(existing, options) {
  assertGoalExecution(options.execution, options.goalId);
  if (existing) {
    if (existing.schemaVersion !== CONTEXT_MAP_SCHEMA_VERSION) throw new Error('LEGACY_UNVERIFIED Context Map');
    assertSameExecution(existing.execution, options.execution);
  }
  const repos = definitions(options.repositories);
  if (stable([...repos.keys()].sort()) !== stable(options.execution.baseline.repositories.map((repo) => repo.repositoryId).sort())) {
    throw new Error('Context Map baseline repository mismatch');
  }
  const map = existing ? structuredClone(existing) : baseMap(options);
  if (map.goalId !== options.goalId) throw new Error('Context Map Goal mismatch');
  const nextRegistryFingerprint = capabilityRegistryFingerprint(options.registry);
  const registryChanged = Boolean(options.registry && map.registryFingerprint !== nextRegistryFingerprint);
  if (registryChanged && map.router) {
    map.taskFingerprint = null;
    map.routerFingerprint = null;
    map.capabilities = { required: [], optional: [], knownGood: [] };
    map.router = null;
    map.ambiguities = [];
  }
  map.registryFingerprint = nextRegistryFingerprint ?? map.registryFingerprint ?? null;
  if (map.router) map.router.missingOperationalProfiles = (map.router.missingOperationalProfiles ?? []).map((item) =>
    typeof item === 'string' ? { capability: item, reason: 'NO_OPERATIONAL_PROFILE_AVAILABLE' } : item);
  map.taskClass = options.taskClass;
  map.repositories = [...repos.keys()].sort();
  map.risks = sortedUnique(options.risks ?? map.risks);
  map.invariants = sortedUnique(options.invariants ?? map.invariants ?? []);
  const previousRepositoryState = structuredClone(map.repositoryState);
  const relevant = Object.fromEntries(map.repositories.map((id) =>
    [id, [...(map.repositoryState[id]?.relevantRefs ?? [])]]));
  for (const item of map.evidence) relevant[item.repository]?.push(item.path);
  for (const item of map.knownGood.filter((entry) => entry.artifact)) relevant[item.repository]?.push(item.artifact);
  for (const item of options.workingArtifacts ?? []) {
    relevant[item.repository ?? 'wayper']?.push(workingArtifactSpec(item));
  }
  for (const [id, repo] of repos) {
    map.repositoryState[id] = { repository: id, logicalRoot: repo.logicalRoot,
      relevantRefs: sortedUnique(relevant[id]),
      ...gitFingerprint(repo.root, relevant[id], id) };
    map.graphify[id] ??= { decision: 'NOT_NEEDED', status: 'NOT_USED', scopeFingerprint: null,
      version: null, graphFingerprint: null, queries: [] };
    map.graphify[id].status ??= map.graphify[id].queries.length ? 'STALE' : 'NOT_USED';
    if (map.graphify[id].queries.length && previousRepositoryState[id]?.dirtyFingerprint !==
      map.repositoryState[id].dirtyFingerprint) map.graphify[id].status = 'STALE';
  }
  for (const id of Object.keys(map.repositoryState)) if (!repos.has(id)) delete map.repositoryState[id];
  for (const id of Object.keys(map.graphify)) if (!repos.has(id)) delete map.graphify[id];
  const changed = map.repositories.filter((id) => previousRepositoryState[id] &&
    previousRepositoryState[id].contentFingerprint !== map.repositoryState[id].contentFingerprint);
  const incompatible = map.repositories.filter((id) => previousRepositoryState[id] &&
    ['branch', 'head', 'checkoutFingerprint'].some((field) => previousRepositoryState[id][field] !== map.repositoryState[id][field]));
  if (changed.length || incompatible.length) invalidateMapProofs(map, {
    evidence: map.evidence.filter((item) => incompatible.includes(item.repository) ||
      changed.includes(item.repository) && ['COMMAND', 'TEST', 'OBSERVATION'].includes(item.provenance)).map((item) => item.id),
    validations: map.validation.checks.map((item) => item.id),
    artifacts: map.knownGood.filter((item) => incompatible.includes(item.repository)).map((item) => `${item.repository}:${item.artifact}`),
    graphify: [...changed, ...incompatible],
  }, 'REPOSITORY_STATE_CHANGED');
  map.dependencies = [...map.dependencies.reduce((items, item) => {
    const id = idFor('D', { from: item.from, to: item.to, relation: item.relation, provenance: item.provenance });
    const prior = items.get(id);
    items.set(id, { ...item, id, evidenceIds: sortedUnique([...(prior?.evidenceIds ?? []), ...(item.evidenceIds ?? [])]) });
    return items;
  }, new Map()).values()];

  const invalidated = [...(registryChanged ? ['ROUTER'] : []), ...Object.values(map.graphify)
    .filter((item) => item.status === 'STALE').flatMap((item) => item.queries.map((query) => query.queryFingerprint))];
  for (const item of map.evidence) {
    const { current, invalidationReason } = observedSourceFingerprint(
      repos.get(item.repository).root, item.path, item.range);
    if (!current || current.hash !== item.sourceHash) {
      if (item.status !== 'STALE') invalidated.push(item.id);
      item.status = 'STALE';
      item.invalidationReason = current ? 'SOURCE_HASH_CHANGED' : invalidationReason;
    }
  }
  const staleEvidence = new Set(map.evidence.filter((item) => !REUSABLE_EVIDENCE.has(item.status)).map((item) => item.id));
  const reusableProofs = reusableProofIds(map);
  map.dependencies = map.dependencies.filter((item) => {
    const reusable = item.evidenceIds.length && item.evidenceIds.every((id) => !staleEvidence.has(id));
    if (!reusable) invalidated.push(item.id);
    return reusable;
  });
  for (const item of map.proofGaps) {
    if (item.status === 'RESOLVED' && item.evidenceIds.some((id) => !reusableProofs.has(id))) {
      item.status = 'OPEN'; item.evidenceIds = []; invalidated.push(item.id);
    }
  }
  for (const item of map.knownGood) {
    const questioned = (options.questions ?? []).includes(item.artifact ?? item.capability);
    const location = item.artifact ? artifactLocation(item.artifact) : null;
    const observation = location
      ? observedSourceFingerprint(repos.get(item.repository).root, location.path, location.range) : null;
    const current = observation?.current ?? null;
    if (questioned) {
      item.status = 'QUESTIONED';
      item.invalidationReason = 'EXPLICITLY_QUESTIONED';
      invalidated.push(item.id);
    } else if (item.capability && !registryCapabilityFingerprint(options.registry, item.capability)) {
      item.status = 'STALE';
      item.invalidationReason = options.registry ? 'CAPABILITY_MISSING' : 'REGISTRY_UNAVAILABLE';
      invalidated.push(item.id);
    } else if (item.capability &&
      registryCapabilityFingerprint(options.registry, item.capability) !== item.fingerprint) {
      item.status = 'STALE';
      item.invalidationReason = 'CAPABILITY_CHANGED';
      invalidated.push(item.id);
    } else if (location && !current) {
      item.status = 'STALE';
      item.invalidationReason = observation.invalidationReason;
      invalidated.push(item.id);
    } else if (current && current.hash !== item.fingerprint) {
      item.status = 'STALE';
      item.invalidationReason = 'SOURCE_HASH_CHANGED';
      invalidated.push(item.id);
    } else if (item.proofRefs.some((ref) => !ref.startsWith('WC:') && !reusableProofs.has(ref))) {
      item.status = 'STALE';
      item.invalidationReason = 'PROOF_STALE';
      invalidated.push(item.id);
    }
  }
  const freshlyProven = new Set((options.workingArtifacts ?? []).filter((artifact) =>
    artifact.status === 'PROVEN' && (artifact.evidence ?? []).length).map((artifact) =>
    `${artifact.repository ?? 'wayper'}:${workingArtifactSpec(artifact)}`));
  map.knownGood = map.knownGood.filter((item) => {
    const superseded = item.artifact && freshlyProven.has(`${item.repository}:${item.artifact}`);
    if (superseded) invalidated.push(item.id);
    return !superseded;
  });
  for (const artifact of options.workingArtifacts ?? []) {
    if (artifact.status !== 'KNOWN_GOOD_UNCHANGED' || !(artifact.evidence ?? []).length) continue;
    const repository = artifact.repository ?? 'wayper';
    if (!repos.has(repository)) throw new Error(`Unknown working artifact repository: ${repository}`);
    const artifactSpec = workingArtifactSpec(artifact);
    const location = artifactLocation(artifactSpec);
    const { current } = observedSourceFingerprint(repos.get(repository).root, location.path, location.range);
    if (!current || current.hash !== artifact.fingerprint) continue;
    const id = idFor('KG', [repository, artifactSpec]);
    const questioned = (options.questions ?? []).includes(artifact.spec) ||
      (options.questions ?? []).includes(artifactSpec);
    const prior = map.knownGood.find((item) => item.id === id);
    const remainsQuestioned = questioned || prior?.status === 'QUESTIONED';
    const entry = { id, repository, artifact: artifactSpec,
      fingerprint: artifact.fingerprint, receiptIds: artifact.evidence.filter((ref) => RECEIPT_ID.test(ref)), proofRefs: [`WC:${repository}:${artifactSpec}@${artifact.fingerprint}`],
      validatedAtGoal: map.goalId, phase: 'WORKING_CONTEXT_REFRESH',
      status: remainsQuestioned ? 'QUESTIONED' : 'KNOWN_GOOD_UNCHANGED',
      invalidationReason: remainsQuestioned ? 'EXPLICITLY_QUESTIONED' : null };
    const index = map.knownGood.findIndex((item) => item.id === id);
    if (index < 0) map.knownGood.push(entry); else map.knownGood[index] = entry;
  }
  const checks = new Map(map.validation?.checks?.map((item) => [item.id, item]));
  for (const id of options.validations ?? []) checks.set(id, checks.get(id) ?? { id, status: 'NOT_RUN', evidence: null });
  map.validation.checks = [...checks.values()];
  if (map.validationPlan) map.validationPlan = refreshContextValidationPlan(map, receiptOptions(map, [...repos.values()], options));
  refreshReceiptIndex(map, [...repos.values()], options);
  delta(map, { phase: options.phase, invalidated });
  return finalizeContextMap(map, options);
}

function evidenceKey(item) {
  return [item.repository, item.path, item.range ?? item.symbol ?? '', item.sourceHash,
    normalizedCategory(item.category), normalizedClaim(item.claim)];
}

function evidenceSubject(item) {
  return [item.repository, item.path, normalizedCategory(item.category), normalizedClaim(item.claim)];
}

function dependencyPath(ref) {
  return compactText(ref, 'dependency ref', 240).split('#', 1)[0];
}

export function recordContextEntry(map, kind, input, repositoryDefinitions, options = {}) {
  assertGoalExecution(map.execution, map.goalId);
  const repos = definitions(repositoryDefinitions);
  const next = structuredClone(map);
  let id; let existed = false; let invalidated = [];
  if (kind === 'validation-plan') {
    next.validationPlan = createContextValidationPlan(next, input, receiptOptions(next, [...repos.values()], options));
    id = next.validationPlan.planId;
    existed = map.validationPlan?.planId === id;
  } else if (kind === 'receipt') {
    id = input.receiptId;
    existed = next.evidenceReceipts?.some((item) => item.receiptId === id) ?? false;
  } else if (kind === 'evidence') {
    if (!repos.has(input.repository) || !EVIDENCE_STATUSES.has(input.status) ||
      !EVIDENCE_PROVENANCE.has(input.provenance)) throw new Error('Invalid evidence entry');
    const claim = compactText(input.claim, 'claim');
    const range = parseRange(input.range)?.value ?? null;
    const source = sourceFingerprint(repos.get(input.repository).root, input.path, range);
    if (!source) throw new Error(`Missing evidence source: ${input.path}`);
    const capabilityRefs = sortedUnique(input.capabilityRefs ?? []);
    if (capabilityRefs.some((id) => !options.registry?.capabilities?.some((item) => item.id === id))) {
      throw new Error('Invalid evidence capability refs');
    }
    const entry = { repository: input.repository, path: input.path,
      ...(input.symbol ? { symbol: compactText(input.symbol, 'symbol', 160) } : {}),
      ...(range ? { range } : {}), sourceHash: source.hash, sourceBytes: source.bytes,
      claim, category: normalizedCategory(input.category ?? 'GENERAL'),
      provenance: input.provenance, status: input.status,
      ...(input.receiptId ? { receiptId: input.receiptId } : {}),
      ...(input.reviewDisposition ? { reviewDisposition: input.reviewDisposition } : {}),
      ...(capabilityRefs.length ? { capabilityRefs } : {}) };
    if (input.reviewDisposition && input.reviewDisposition !== PRIOR_ANALYSIS_CONCLUSION) {
      throw new Error('Invalid evidence review disposition');
    }
    id = idFor('E', evidenceKey(entry));
    invalidated = next.evidence.filter((item) => item.status === 'STALE' &&
      stable(evidenceSubject(item)) === stable(evidenceSubject(entry))).map((item) => item.id);
    next.evidence = next.evidence.filter((item) => !invalidated.includes(item.id));
    const index = next.evidence.findIndex((item) => item.id === id);
    existed = index >= 0;
    if (index < 0) next.evidence.push({ id, ...entry });
    else {
      const mergedRefs = sortedUnique([...(next.evidence[index].capabilityRefs ?? []), ...capabilityRefs]);
      next.evidence[index] = { id, ...entry, ...(mergedRefs.length ? { capabilityRefs: mergedRefs } : {}) };
    }
  } else if (kind === 'dependency') {
    const from = input.from; const to = input.to;
    if (!repos.has(from?.repository) || !repos.has(to?.repository) ||
      !DEPENDENCY_RELATIONS.has(input.relation) || !DEPENDENCY_PROVENANCE.has(input.provenance)) {
      throw new Error('Invalid dependency entry');
    }
    const evidenceIds = sortedUnique(input.evidenceIds ?? []);
    const reusable = new Set(next.evidence.filter((item) => REUSABLE_EVIDENCE.has(item.status)).map((item) => item.id));
    if (!evidenceIds.length || evidenceIds.some((evidenceId) => !reusable.has(evidenceId))) {
      throw new Error('Dependency requires reusable evidence');
    }
    const entry = { from: { repository: from.repository, ref: compactText(from.ref, 'dependency ref', 240) },
      to: { repository: to.repository, ref: compactText(to.ref, 'dependency ref', 240) },
      relation: input.relation, provenance: input.provenance,
      evidenceIds };
    const endpointPaths = [entry.from, entry.to].map((endpoint) => ({ repository: endpoint.repository,
      path: dependencyPath(endpoint.ref) }));
    for (const endpoint of endpointPaths) repoFile(repos.get(endpoint.repository).root, endpoint.path);
    if (!next.evidence.some((evidence) => evidenceIds.includes(evidence.id) && endpointPaths.some((endpoint) =>
      endpoint.repository === evidence.repository && endpoint.path === evidence.path))) {
      throw new Error('Dependency evidence is unrelated to its endpoints');
    }
    id = idFor('D', { from: entry.from, to: entry.to, relation: entry.relation, provenance: entry.provenance });
    const index = next.dependencies.findIndex((item) => item.id === id);
    existed = index >= 0;
    if (index < 0) next.dependencies.push({ id, ...entry }); else next.dependencies[index] = { id, ...entry };
  } else if (kind === 'proof-gap') {
    const status = input.status ?? 'OPEN';
    const evidenceIds = sortedUnique(input.evidenceIds ?? []);
    if (!['OPEN', 'RESOLVED'].includes(status) || (status === 'RESOLVED') !== Boolean(evidenceIds.length)) {
      throw new Error('Invalid proof gap status');
    }
    if (status === 'RESOLVED' && evidenceIds.some((proofId) => !reusableProofIds(next).has(proofId))) {
      throw new Error('Proof gap requires reusable evidence');
    }
    const capabilityRefs = sortedUnique(input.capabilityRefs ?? []);
    if (capabilityRefs.some((id) => !options.registry?.capabilities?.some((item) => item.id === id))) {
      throw new Error('Invalid proof-gap capability refs');
    }
    const entry = { ...(input.receiptRequirement ? { receiptRequirement: input.receiptRequirement, receiptIds: input.receiptIds ?? [] } : {}),
      claim: compactText(input.claim, 'proof gap claim'),
      reason: compactText(input.reason, 'proof gap reason'),
      requiredEvidence: compactText(input.requiredEvidence, 'required evidence'), status, evidenceIds,
      ...(input.reviewDisposition ? { reviewDisposition: input.reviewDisposition } : {}),
      ...(capabilityRefs.length ? { capabilityRefs } : {}) };
    if (input.reviewDisposition && input.reviewDisposition !== PRIOR_ANALYSIS_CONCLUSION) {
      throw new Error('Invalid proof-gap review disposition');
    }
    id = idFor('PG', [normalizedClaim(entry.claim), normalizedClaim(entry.requiredEvidence)]);
    const index = next.proofGaps.findIndex((item) => item.id === id);
    existed = index >= 0;
    if (index < 0) next.proofGaps.push({ id, ...entry });
    else {
      const mergedRefs = sortedUnique([...(next.proofGaps[index].capabilityRefs ?? []), ...capabilityRefs]);
      next.proofGaps[index] = { id, ...entry, ...(mergedRefs.length ? { capabilityRefs: mergedRefs } : {}) };
    }
  } else if (kind === 'known-good') {
    if (!repos.has(input.repository) || Boolean(input.artifact) === Boolean(input.capability)) {
      throw new Error('Invalid known-good entry');
    }
    const location = input.artifact ? artifactLocation(input.artifact) : null;
    const source = location
      ? sourceFingerprint(repos.get(input.repository).root, location.path, location.range) : null;
    const capabilityFingerprint = input.capability
      ? registryCapabilityFingerprint(options.registry, input.capability) : null;
    if (input.capability && (!capabilityFingerprint ||
      (input.fingerprint && input.fingerprint !== capabilityFingerprint))) {
      throw new Error('Invalid known-good capability');
    }
    const fingerprint = source?.hash ?? capabilityFingerprint;
    const proofRefs = sortedUnique(input.proofRefs ?? []);
    if (!HASH.test(fingerprint ?? '') || !proofRefs.length || proofRefs.some((proofId) => !reusableProofIds(next).has(proofId))) {
      throw new Error('Invalid known-good proof');
    }
    const groundedProof = input.artifact
      ? proofRefs.some((proofId) => next.validation.checks.some((check) => check.id === proofId && check.status === 'PASS') ||
        next.evidence.some((evidence) => evidence.id === proofId && evidence.repository === input.repository &&
          evidence.path === location.path))
      : proofRefs.includes('quality:capabilities') || proofRefs.some((proofId) =>
        next.evidence.some((evidence) => evidence.id === proofId && evidence.path === 'docs/ai/capability-registry.json'));
    if (!groundedProof) throw new Error('Known-good proof is unrelated to its artifact or capability');
    id = idFor('KG', [input.repository, input.artifact ?? input.capability]);
    const entry = { id, repository: input.repository,
      ...(input.artifact ? { artifact: input.artifact } : { capability: input.capability }),
      fingerprint, proofRefs, receiptIds: sortedUnique(input.receiptIds ?? []), validatedAtGoal: next.goalId,
      phase: compactText(input.phase ?? 'CURRENT', 'phase', 80), status: 'KNOWN_GOOD_UNCHANGED',
      invalidationReason: null };
    const index = next.knownGood.findIndex((item) => item.id === id);
    existed = index >= 0;
    if (index < 0) next.knownGood.push(entry); else next.knownGood[index] = entry;
  } else if (kind === 'graphify') {
    const graph = next.graphify[input.repository];
    if (!repos.has(input.repository) || !graph || graph.decision === 'NOT_NEEDED') {
      throw new Error('Graphify refs require a repository-scoped non-NOT_NEEDED decision');
    }
    const snapshot = graphifySnapshot(input.repository, repos.get(input.repository));
    const capabilityRefs = sortedUnique(input.capabilityRefs ?? []);
    if (capabilityRefs.some((id) => !options.registry?.capabilities?.some((item) => item.id === id))) {
      throw new Error('Invalid Graphify capability refs');
    }
    const query = { purpose: compactText(input.purpose, 'Graphify purpose'),
      ...(capabilityRefs.length ? { capabilityRefs } : {}),
      nodeRefs: sortedUnique(input.nodeRefs ?? []), edgeRefs: sortedUnique(input.edgeRefs ?? []) };
    if (![...query.nodeRefs, ...query.edgeRefs].length) throw new Error('Graphify query requires repository-scoped refs');
    const queryFingerprint = sha256(stable({ purpose: query.purpose,
      nodeRefs: query.nodeRefs, edgeRefs: query.edgeRefs }));
    if (input.queryFingerprint && input.queryFingerprint !== queryFingerprint) {
      throw new Error('Graphify query fingerprint mismatch');
    }
    id = queryFingerprint;
    if (!HASH.test(id) || input.scopeFingerprint !== snapshot.metadata.sourceFingerprint ||
      input.graphFingerprint !== snapshot.metadata.graphSha256 || input.version !== snapshot.metadata.graphifyVersion ||
      query.nodeRefs.some((ref) => !snapshot.nodes.has(ref)) || query.edgeRefs.some((ref) => !snapshot.edges.has(ref))) {
      throw new Error('Invalid Graphify fingerprints');
    }
    if (graph.graphFingerprint && graph.graphFingerprint !== input.graphFingerprint) graph.queries = [];
    graph.scopeFingerprint = input.scopeFingerprint;
    graph.version = compactText(input.version, 'Graphify version', 80);
    graph.graphFingerprint = input.graphFingerprint;
    graph.status = 'CURRENT';
    existed = graph.queries.some((item) => item.queryFingerprint === id);
    if (!existed) graph.queries.push({ queryFingerprint: id, ...query });
    else {
      const index = graph.queries.findIndex((item) => item.queryFingerprint === id);
      const mergedRefs = sortedUnique([...(graph.queries[index].capabilityRefs ?? []), ...capabilityRefs]);
      graph.queries[index] = { queryFingerprint: id, ...query,
        ...(mergedRefs.length ? { capabilityRefs: mergedRefs } : {}) };
    }
  } else if (kind === 'validation') {
    if (!['NOT_RUN', 'PASS', 'FAIL', 'NOT_APPLICABLE', 'BLOCKED'].includes(input.status)) {
      throw new Error('Invalid validation status');
    }
    if (input.status !== 'NOT_RUN' && !input.evidence) throw new Error('Validation evidence is required');
    id = compactText(input.id, 'validation id', 120);
    if (input.reviewDisposition && input.reviewDisposition !== PRIOR_ANALYSIS_CONCLUSION) {
      throw new Error('Invalid validation review disposition');
    }
    const entry = { id, status: input.status, evidence: input.evidence ? compactText(input.evidence, 'validation evidence', 400) : null,
      ...(input.reviewDisposition ? { reviewDisposition: input.reviewDisposition } : {}) };
    const index = next.validation.checks.findIndex((item) => item.id === id);
    existed = index >= 0;
    if (index < 0) next.validation.checks.push(entry); else next.validation.checks[index] = entry;
    if (input.status !== 'PASS') {
      for (const gap of next.proofGaps.filter((item) => item.status === 'RESOLVED' && item.evidenceIds.includes(id))) {
        gap.status = 'OPEN'; gap.evidenceIds = [];
      }
      for (const knownGood of next.knownGood.filter((item) => item.status === 'KNOWN_GOOD_UNCHANGED' &&
        item.proofRefs.includes(id))) {
        knownGood.status = 'STALE'; knownGood.invalidationReason = 'PROOF_STALE';
      }
    }
  } else throw new Error(`Unknown Context Map entry kind: ${kind}`);
  if (input.receiptId) indexReceipt(next, input.receiptId, [...repos.values()], options);
  if (kind === 'validation' && RECEIPT_ID.test(input.evidence)) indexReceipt(next, input.evidence, [...repos.values()], options);
  for (const receiptId of input.receiptIds ?? []) indexReceipt(next, receiptId, [...repos.values()], options);
  refreshReceiptIndex(next, [...repos.values()], options);
  delta(next, { phase: input.phase ?? options.phase, invalidated,
    added: existed ? [] : [id], updated: existed ? [id] : [] });
  return finalizeContextMap(next, options);
}

export function integrateRouterOutput(map, output, options = {}) {
  assertGoalExecution(map.execution, map.goalId);
  if (!['SHADOW', 'SELECTIVE'].includes(output?.mode) || !HASH.test(output.taskFingerprint?.hash ?? '') ||
    output.taskFingerprint.facts.goalId !== map.goalId ||
    output.repositories.some((id) => !map.repositories.includes(id))) throw new Error('Invalid router output');
  const proposedProfiles = sortedUnique(output.selectedProfiles.map((item) => item.id));
  if (output.mode === 'SELECTIVE' && (validateRouterSelectionReceipt(output.selectionReceipt,
    { registry: options.registry }).status !== 'VALID' || output.selectionReceipt.taskFingerprint !== output.taskFingerprint.hash ||
    stable(sortedUnique(output.selectionReceipt.repositories)) !== stable(sortedUnique(output.repositories)) ||
    stable(sortedUnique(output.selectionReceipt.proposedProfileIds)) !== stable(proposedProfiles))) {
    throw new Error('Invalid selective router receipt');
  }
  const next = structuredClone(map);
  next.taskFingerprint = output.taskFingerprint.hash;
  next.routerFingerprint = sha256(stable(output));
  next.capabilities = {
    required: sortedUnique(output.requiredCapabilities.map((item) => item.id)),
    optional: sortedUnique(output.optionalCapabilities.map((item) => item.id)),
    knownGood: sortedUnique(output.taskFingerprint.facts.knownGoodCapabilities),
  };
  next.router = { mode: output.mode, version: output.routerVersion,
    selectedProfiles: output.mode === 'SELECTIVE' ? output.selectionReceipt.profileIds : proposedProfiles,
    ...(output.mode === 'SELECTIVE' ? { proposedProfiles, selectionReceipt: output.selectionReceipt } : {}),
    missingOperationalProfiles: sortedUnique(output.coverage.required.uncovered)
      .map((capability) => ({ capability, reason: 'NO_OPERATIONAL_PROFILE_AVAILABLE' })),
    graphifyDecision: output.graphifyDecision,
    requiresModelJudgment: output.requiresModelJudgment };
  for (const item of [...output.taskFingerprint.facts.changedFiles,
    ...output.taskFingerprint.facts.candidatePaths]) {
    next.repositoryState[item.repository].relevantRefs = sortedUnique([
      ...next.repositoryState[item.repository].relevantRefs, item.path,
    ]);
  }
  next.ambiguities = output.ambiguities.map((item) => ({ code: item.code,
    ...(item.capabilities ? { capabilities: sortedUnique(item.capabilities) } : {}) }));
  for (const repository of output.repositories) {
    const graph = next.graphify[repository];
    graph.decision = output.graphifyDecision;
    if (output.graphifyDecision === 'NOT_NEEDED') {
      graph.status = 'NOT_USED'; graph.scopeFingerprint = null; graph.version = null;
      graph.graphFingerprint = null; graph.queries = [];
    }
  }
  const questioned = output.taskFingerprint.facts.questionsExistingBehavior;
  if (questioned) for (const item of next.knownGood) {
    item.status = 'QUESTIONED'; item.invalidationReason = 'EXPLICITLY_QUESTIONED';
  }
  delta(next, { phase: options.phase, updated: ['ROUTER'],
    invalidated: questioned ? next.knownGood.map((item) => item.id) : [] });
  return finalizeContextMap(next, options);
}

function duplicateIds(items, field, errors) {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) errors.push(`duplicate ${field} IDs`);
}

function rejectUnknownKeys(value, allowed, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`invalid ${label} object`);
    return;
  }
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`unknown ${label} field: ${key}`);
}

const MAP_KEYS = new Set(['schemaVersion', 'goalId', 'execution', 'taskClass', 'repositories', 'taskFingerprint',
  'routerFingerprint', 'registryFingerprint', 'repositoryState', 'capabilities', 'router', 'risks', 'evidence', 'dependencies',
  'knownGood', 'graphify', 'validation', 'learningDelta', 'ambiguities', 'proofGaps', 'metrics', 'invariants', 'evidenceReceipts', 'validationPlan']);
const REPOSITORY_KEYS = new Set(['repository', 'logicalRoot', 'relevantRefs', 'branch', 'head',
  'dirtyFingerprint', 'relevantDiffFingerprint', 'checkoutFingerprint', 'dirty', 'contentFingerprint']);
const EVIDENCE_KEYS = new Set(['id', 'repository', 'path', 'symbol', 'range', 'sourceHash', 'sourceBytes',
  'claim', 'category', 'provenance', 'status', 'invalidationReason', 'capabilityRefs', 'reviewDisposition', 'receiptId', 'verification']);
const RECEIPT_INDEX_KEYS = new Set(['receiptId', 'kind', 'repository', 'subject', 'origin', 'verification',
  'reasons', 'baselineFingerprint', 'result', 'summary', 'producer', 'producedAt']);
const DEPENDENCY_KEYS = new Set(['id', 'from', 'to', 'relation', 'provenance', 'evidenceIds']);
const KNOWN_GOOD_KEYS = new Set(['id', 'repository', 'artifact', 'capability', 'fingerprint', 'proofRefs',
  'validatedAtGoal', 'phase', 'status', 'invalidationReason', 'receiptIds', 'verification']);
const GRAPHIFY_KEYS = new Set(['decision', 'status', 'scopeFingerprint', 'version', 'graphFingerprint', 'queries']);
const QUERY_KEYS = new Set(['queryFingerprint', 'purpose', 'nodeRefs', 'edgeRefs', 'capabilityRefs']);
const GAP_KEYS = new Set(['id', 'claim', 'reason', 'requiredEvidence', 'status', 'evidenceIds', 'capabilityRefs', 'verification', 'receiptIds', 'receiptRequirement',
  'reviewDisposition']);
const DELTA_KEYS = new Set(['id', 'phase', 'added', 'updated', 'invalidated']);
const METRIC_KEYS = new Set(['bytes', 'tokenProxy', 'tokenProxyCeiling', 'budgetStatus', 'budgetReason',
  'evidenceCount', 'dependencyCount', 'knownGoodCount', 'proofGapCount', 'referencedSourceBytes']);

function validateContextMapUnsafe(map, { repositoryDefinitions = [], registry } = {}) {
  const errors = [];
  let repos;
  try { repos = definitions(repositoryDefinitions); } catch (error) { errors.push(error.message); repos = new Map(); }
  if (map?.schemaVersion !== CONTEXT_MAP_SCHEMA_VERSION || !map.goalId || !Array.isArray(map.repositories) ||
    !map.repositoryState || !map.capabilities || !map.graphify || !map.validation || !map.metrics ||
    ['evidence', 'dependencies', 'knownGood', 'learningDelta', 'ambiguities', 'proofGaps']
      .some((field) => !Array.isArray(map[field]))) {
    return { status: 'INVALID', errors: ['unsupported Context Map schema'] };
  }
  rejectUnknownKeys(map, MAP_KEYS, 'Context Map', errors);
  assertGoalExecution(map.execution, map.goalId);
  if (map.validationPlan) {
    rejectUnknownKeys(map.validationPlan, new Set(['planId', 'fingerprint', 'ownerContextFingerprint', 'availability',
      'status', 'reasons', 'metrics', 'requirements']), 'validation plan index', errors);
    const currentPlan = refreshContextValidationPlan(map, receiptOptions(map, [...repos.values()], {}));
    if (stable(currentPlan) !== stable(map.validationPlan)) errors.push('stale or invalid validation plan index');
  }
  if (stable(map.repositories) !== stable(map.execution.baseline.repositories.map((repo) => repo.repositoryId).sort())) {
    errors.push('Context Map baseline repository mismatch');
  }
  rejectUnknownKeys(map.capabilities, new Set(['required', 'optional', 'knownGood']), 'capabilities', errors);
  rejectUnknownKeys(map.validation, new Set(['structural', 'fingerprint', 'checks']), 'validation', errors);
  rejectUnknownKeys(map.metrics, METRIC_KEYS, 'metrics', errors);
  if (Buffer.byteLength(JSON.stringify(map)) > 1_000_000) errors.push('Context Map exceeds structural byte limit');
  if (map.router) {
    rejectUnknownKeys(map.router, new Set(['mode', 'version', 'selectedProfiles',
      'proposedProfiles', 'selectionReceipt',
      'missingOperationalProfiles', 'graphifyDecision', 'requiresModelJudgment']), 'router', errors);
    for (const item of map.router.missingOperationalProfiles ?? []) {
      rejectUnknownKeys(item, new Set(['capability', 'reason']), 'missing operational profile', errors);
    }
    if (!Array.isArray(map.router.selectedProfiles) || map.router.selectedProfiles.length > 64 ||
      (map.router.proposedProfiles != null && (!Array.isArray(map.router.proposedProfiles) ||
        map.router.proposedProfiles.length > 64)) ||
      !Array.isArray(map.router.missingOperationalProfiles) || map.router.missingOperationalProfiles.length > 56) {
      errors.push('too many router refs');
    }
  }
  const limits = { repositories: 2, risks: 64, invariants: 64, evidence: 256, evidenceReceipts: 256, dependencies: 256, knownGood: 128,
    learningDelta: 256, ambiguities: 64, proofGaps: 128 };
  for (const [field, limit] of Object.entries(limits)) if ((map[field] ?? []).length > limit) errors.push(`too many ${field}`);
  if (map.validation.checks.length > 128) errors.push('too many validation checks');
  const declared = new Set(map.repositories);
  if (declared.size !== map.repositories.length || [...declared].some((id) => !repos.has(id))) errors.push('invalid repository refs');
  if (Object.keys(map.repositoryState).some((id) => !declared.has(id)) ||
    Object.keys(map.graphify).some((id) => !declared.has(id))) errors.push('undeclared repository state');
  if (!Array.isArray(map.risks) || !Array.isArray(map.invariants ?? []) ||
    [...map.risks, ...(map.invariants ?? [])].some((item) => typeof item !== 'string' || !item) ||
    new Set(map.risks).size !== map.risks.length ||
    new Set(map.invariants ?? []).size !== (map.invariants ?? []).length ||
    ['required', 'optional', 'knownGood'].some((field) => !Array.isArray(map.capabilities[field]) ||
      map.capabilities[field].length > 56 ||
      map.capabilities[field].some((item) => typeof item !== 'string' || !item) ||
      new Set(map.capabilities[field]).size !== map.capabilities[field].length)) errors.push('invalid risk/capability refs');
  if (map.registryFingerprint != null && !HASH.test(map.registryFingerprint)) errors.push('invalid registry fingerprint');
  if (registry && map.registryFingerprint !== capabilityRegistryFingerprint(registry)) {
    errors.push('stale capability registry fingerprint');
  }
  for (const id of declared) {
    const state = map.repositoryState[id];
    rejectUnknownKeys(state, REPOSITORY_KEYS, `repository state ${id}`, errors);
    if (!state || state.repository !== id || !state.logicalRoot || !state.branch || !/^[a-f0-9]{40,64}$/.test(state.head) ||
      !Array.isArray(state.relevantRefs) || state.relevantRefs.length > 512 || !HASH.test(state.dirtyFingerprint) ||
      !HASH.test(state.relevantDiffFingerprint)) errors.push(`invalid repository state: ${id}`);
    else {
      const current = gitFingerprint(repos.get(id).root, state.relevantRefs, id);
      if (['branch', 'head', 'dirtyFingerprint', 'relevantDiffFingerprint', 'checkoutFingerprint', 'dirty', 'contentFingerprint']
        .some((field) => current[field] !== state[field])) errors.push(`stale repository state: ${id}`);
    }
  }
  duplicateIds(map.evidence, 'evidence', errors);
  duplicateIds(map.dependencies, 'dependency', errors);
  duplicateIds(map.knownGood, 'known-good', errors);
  duplicateIds(map.proofGaps, 'proof-gap', errors);
  duplicateIds(map.learningDelta, 'learning-delta', errors);
  duplicateIds(map.validation.checks, 'validation', errors);
  const reusableEvidenceIds = new Set(map.evidence.filter((item) => REUSABLE_EVIDENCE.has(item.status)).map((item) => item.id));
  const evidenceById = new Map(map.evidence.map((item) => [item.id, item]));
  const dedup = new Set();
  for (const item of map.evidence) {
    rejectUnknownKeys(item, EVIDENCE_KEYS, `evidence ${item.id}`, errors);
    if (!declared.has(item.repository) || !EVIDENCE_STATUSES.has(item.status) ||
      !EVIDENCE_PROVENANCE.has(item.provenance) || !HASH.test(item.sourceHash) ||
      !Number.isInteger(item.sourceBytes) || item.sourceBytes < 0 || Buffer.byteLength(item.claim ?? '') > 240 ||
      item.id !== idFor('E', evidenceKey(item))) {
      errors.push(`invalid evidence: ${item.id}`);
    }
    if (item.capabilityRefs && (!Array.isArray(item.capabilityRefs) || item.capabilityRefs.length > 56 ||
      new Set(item.capabilityRefs).size !== item.capabilityRefs.length)) errors.push(`invalid evidence capability refs: ${item.id}`);
    if (item.reviewDisposition && item.reviewDisposition !== PRIOR_ANALYSIS_CONCLUSION) {
      errors.push(`invalid evidence review disposition: ${item.id}`);
    }
    const key = stable(evidenceKey(item));
    if (dedup.has(key)) errors.push(`duplicate evidence: ${item.id}`); else dedup.add(key);
    const root = repos.get(item.repository)?.root;
    const current = root ? observedSourceFingerprint(root, item.path, item.range).current : null;
    if ((!current || current.hash !== item.sourceHash) && item.status !== 'STALE') errors.push(`stale evidence not invalidated: ${item.id}`);
  }
  for (const item of map.dependencies) {
    rejectUnknownKeys(item, DEPENDENCY_KEYS, `dependency ${item.id}`, errors);
    rejectUnknownKeys(item.from, new Set(['repository', 'ref']), `dependency ${item.id} from`, errors);
    rejectUnknownKeys(item.to, new Set(['repository', 'ref']), `dependency ${item.id} to`, errors);
    const expected = idFor('D', { from: item.from, to: item.to, relation: item.relation,
      provenance: item.provenance });
    const endpoints = [item.from, item.to].map((endpoint) => ({ repository: endpoint?.repository,
      path: dependencyPath(endpoint?.ref) }));
    let endpointsExist = true;
    for (const endpoint of endpoints) {
      try { repoFile(repos.get(endpoint.repository)?.root, endpoint.path); }
      catch { endpointsExist = false; }
    }
    const relatedProof = item.evidenceIds?.some((id) => {
      const evidence = evidenceById.get(id);
      return evidence && endpoints.some((endpoint) => endpoint.repository === evidence.repository && endpoint.path === evidence.path);
    });
    if (!declared.has(item.from?.repository) || !declared.has(item.to?.repository) ||
      !DEPENDENCY_RELATIONS.has(item.relation) || !DEPENDENCY_PROVENANCE.has(item.provenance) ||
      !Array.isArray(item.evidenceIds) || !item.evidenceIds.length || item.evidenceIds.length > 64 ||
      item.evidenceIds.some((id) => !reusableEvidenceIds.has(id)) || !endpointsExist || !relatedProof || item.id !== expected) {
      errors.push(`invalid dependency refs: ${item.id}`);
    }
  }
  const checkedReceipts = structuredClone(map);
  for (const entry of map.evidenceReceipts ?? []) {
    rejectUnknownKeys(entry, RECEIPT_INDEX_KEYS, 'receipt index', errors);
    rejectUnknownKeys(entry.subject, new Set(['path', 'range', 'target', 'fingerprint']), 'receipt subject', errors);
    if ([...RECEIPT_INDEX_KEYS].some((key) => !Object.hasOwn(entry, key)) || !RECEIPT_ID.test(entry.receiptId) ||
      !declared.has(entry.repository) || !EVIDENCE_KINDS.includes(entry.kind) || !EVIDENCE_ORIGINS.includes(entry.origin) ||
      !HASH.test(entry.baselineFingerprint) || !HASH.test(entry.subject?.fingerprint) ||
      !['VERIFIED', 'STALE', 'INVALID', 'UNVERIFIED'].includes(entry.verification) || !Array.isArray(entry.reasons)) {
      errors.push('invalid receipt index entry');
    }
  }
  if (new Set((map.evidenceReceipts ?? []).map((entry) => entry.receiptId)).size !== (map.evidenceReceipts ?? []).length) {
    errors.push('duplicate receipt index refs');
  }
  refreshReceiptIndex(checkedReceipts, [...repos.values()], {});
  if (stable(checkedReceipts.evidenceReceipts) !== stable(map.evidenceReceipts ?? [])) errors.push('stale or invalid receipt index');
  for (const collection of ['evidence', 'knownGood', 'proofGaps']) {
    for (const item of map[collection]) if (item.verification && item.verification !== checkedReceipts[collection].find((other) => other.id === item.id)?.verification) errors.push(`invalid receipt verification: ${item.id}`);
  }
  const reusableProofs = reusableProofIds(map);
  const allProofs = new Set([...map.evidence.map((item) => item.id), ...map.validation.checks.map((item) => item.id)]);
  for (const item of map.knownGood) {
    rejectUnknownKeys(item, KNOWN_GOOD_KEYS, `known-good ${item.id}`, errors);
    const ref = item.artifact ?? item.capability;
    const workingContextRef = item.artifact
      ? `WC:${item.repository}:${item.artifact}@${item.fingerprint}` : null;
    const location = item.artifact ? artifactLocation(item.artifact) : null;
    const current = location && repos.get(item.repository)
      ? observedSourceFingerprint(repos.get(item.repository).root, location.path, location.range).current : null;
    const groundedProof = item.artifact
      ? item.proofRefs.some((proofRef) => proofRef === workingContextRef ||
        map.validation.checks.some((check) => check.id === proofRef &&
          (item.status !== 'KNOWN_GOOD_UNCHANGED' || check.status === 'PASS')) ||
        map.evidence.some((evidence) => evidence.id === proofRef && evidence.repository === item.repository &&
          evidence.path === location.path))
      : item.proofRefs.includes('quality:capabilities') || item.proofRefs.some((proofRef) =>
        map.evidence.some((evidence) => evidence.id === proofRef && evidence.path === 'docs/ai/capability-registry.json'));
    if (!declared.has(item.repository) || Boolean(item.artifact) === Boolean(item.capability) ||
      !HASH.test(item.fingerprint ?? '') || !Array.isArray(item.proofRefs) || !item.proofRefs.length ||
      item.proofRefs.length > 64 ||
      item.proofRefs.some((proofRef) => proofRef !== workingContextRef && !allProofs.has(proofRef)) ||
      !groundedProof ||
      (item.status === 'KNOWN_GOOD_UNCHANGED' && item.proofRefs.some((proofRef) =>
        proofRef !== workingContextRef && !reusableProofs.has(proofRef))) ||
      (item.artifact && item.status === 'KNOWN_GOOD_UNCHANGED' && current?.hash !== item.fingerprint) ||
      (item.capability && registry && item.status === 'KNOWN_GOOD_UNCHANGED' &&
        registryCapabilityFingerprint(registry, item.capability) !== item.fingerprint) ||
      item.validatedAtGoal !== map.goalId ||
      !['KNOWN_GOOD_UNCHANGED', 'STALE', 'QUESTIONED'].includes(item.status) ||
      item.id !== idFor('KG', [item.repository, ref])) errors.push(`invalid known-good: ${item.id}`);
  }
  for (const item of map.proofGaps) {
    rejectUnknownKeys(item, GAP_KEYS, `proof gap ${item.id}`, errors);
    if (item.receiptRequirement && validateEvidenceRequirement(item.receiptRequirement).status !== 'VALID') {
      errors.push(`invalid receipt requirement: ${item.id}`);
    }
    if (!['OPEN', 'RESOLVED'].includes(item.status) || !item.claim || !item.reason || !item.requiredEvidence ||
      !Array.isArray(item.evidenceIds) || item.evidenceIds.some((id) => !reusableProofs.has(id)) ||
      item.evidenceIds.length > 64 ||
      (item.status === 'RESOLVED') !== Boolean(item.evidenceIds.length)) {
      errors.push(`invalid proof gap: ${item.id}`);
    }
    if (item.capabilityRefs && (!Array.isArray(item.capabilityRefs) || item.capabilityRefs.length > 56 ||
      new Set(item.capabilityRefs).size !== item.capabilityRefs.length)) errors.push(`invalid proof-gap capability refs: ${item.id}`);
    if (item.reviewDisposition && item.reviewDisposition !== PRIOR_ANALYSIS_CONCLUSION) {
      errors.push(`invalid proof-gap review disposition: ${item.id}`);
    }
  }
  for (const [id, graph] of Object.entries(map.graphify)) {
    rejectUnknownKeys(graph, GRAPHIFY_KEYS, `Graphify ${id}`, errors);
    if (!declared.has(id) || !GRAPHIFY_DECISIONS.has(graph.decision) ||
      !['NOT_USED', 'CURRENT', 'STALE'].includes(graph.status) ||
      !Array.isArray(graph.queries) || graph.queries.length > 128 ||
      (graph.decision === 'NOT_NEEDED' && graph.queries.length)) errors.push(`invalid Graphify state: ${id}`);
    if (new Set(graph.queries.map((query) => query.queryFingerprint)).size !== graph.queries.length) {
      errors.push(`duplicate Graphify query: ${id}`);
    }
    let snapshot;
    if (graph.status === 'CURRENT') {
      try { snapshot = graphifySnapshot(id, repos.get(id)); }
      catch { errors.push(`unverified Graphify state: ${id}`); }
      if (snapshot && (graph.scopeFingerprint !== snapshot.metadata.sourceFingerprint ||
        graph.graphFingerprint !== snapshot.metadata.graphSha256 || graph.version !== snapshot.metadata.graphifyVersion)) {
        errors.push(`stale Graphify metadata: ${id}`);
      }
    }
    for (const query of graph.queries) {
      rejectUnknownKeys(query, QUERY_KEYS, `Graphify query ${id}`, errors);
      if (!Array.isArray(query.nodeRefs) || !Array.isArray(query.edgeRefs) ||
        query.nodeRefs.length + query.edgeRefs.length > 256 || !HASH.test(graph.scopeFingerprint ?? '') ||
        !graph.version || !HASH.test(graph.graphFingerprint ?? '') ||
        query.queryFingerprint !== sha256(stable({ purpose: query.purpose,
          nodeRefs: query.nodeRefs, edgeRefs: query.edgeRefs })) || [...query.nodeRefs, ...query.edgeRefs]
        .some((ref) => !String(ref).startsWith(`${id}:`)) ||
        (snapshot && (query.nodeRefs.some((ref) => !snapshot.nodes.has(ref)) ||
          query.edgeRefs.some((ref) => !snapshot.edges.has(ref))))) errors.push(`mixed Graphify refs: ${id}`);
      if (query.capabilityRefs && (!Array.isArray(query.capabilityRefs) || query.capabilityRefs.length > 56 ||
        new Set(query.capabilityRefs).size !== query.capabilityRefs.length)) errors.push(`invalid Graphify capability refs: ${id}`);
    }
  }
  const capabilities = new Set(registry?.capabilities?.map((item) => item.id) ?? []);
  const profiles = new Set(registry?.agentProfiles?.map((item) => item.id) ?? []);
  if (registry) {
    if ([...map.capabilities.required, ...map.capabilities.optional, ...map.capabilities.knownGood]
      .some((id) => !capabilities.has(id))) errors.push('invalid capability refs');
    if ((map.router?.selectedProfiles ?? []).some((id) => !profiles.has(id))) errors.push('invalid profile refs');
    if ((map.router?.proposedProfiles ?? []).some((id) => !profiles.has(id))) errors.push('invalid proposed profile refs');
    if ((map.router?.missingOperationalProfiles ?? []).some((item) =>
      !capabilities.has(item.capability) || item.reason !== 'NO_OPERATIONAL_PROFILE_AVAILABLE')) {
      errors.push('invalid missing operational profile refs');
    }
    if ([...map.evidence, ...map.proofGaps, ...Object.values(map.graphify).flatMap((item) => item.queries)]
      .flatMap((item) => item.capabilityRefs ?? []).some((id) => !capabilities.has(id))) {
      errors.push('invalid scoped capability refs');
    }
  }
  if (map.router && (!['SHADOW', 'SELECTIVE'].includes(map.router.mode) || !HASH.test(map.taskFingerprint ?? '') ||
    !HASH.test(map.routerFingerprint ?? '') || !GRAPHIFY_DECISIONS.has(map.router.graphifyDecision))) {
    errors.push('invalid router refs');
  }
  if (map.router?.mode === 'SELECTIVE') {
    const receipt = validateRouterSelectionReceipt(map.router.selectionReceipt, { registry });
    if (receipt.status !== 'VALID' || stable(sortedUnique(map.router.selectedProfiles)) !==
      stable(sortedUnique(map.router.selectionReceipt?.profileIds ?? [])) ||
      stable(sortedUnique(map.router.proposedProfiles ?? [])) !==
        stable(sortedUnique(map.router.selectionReceipt?.proposedProfileIds ?? [])) ||
      stable(sortedUnique(map.repositories)) !== stable(sortedUnique(map.router.selectionReceipt?.repositories ?? [])) ||
      map.taskFingerprint !== map.router.selectionReceipt?.taskFingerprint) errors.push('invalid selective router refs');
  }
  for (const check of map.validation.checks) {
    rejectUnknownKeys(check, new Set(['id', 'status', 'evidence', 'reviewDisposition', 'verification']), `validation check ${check.id}`, errors);
    if (!check.id || !['NOT_RUN', 'PASS', 'FAIL', 'NOT_APPLICABLE', 'BLOCKED'].includes(check.status)) {
      errors.push(`invalid validation check: ${check.id}`);
    }
    if (check.verification && check.verification !== checkedReceipts.validation.checks.find((item) => item.id === check.id)?.verification) errors.push(`invalid receipt validation: ${check.id}`);
    if (check.status !== 'NOT_RUN' && !check.evidence) errors.push(`missing validation evidence: ${check.id}`);
    if (check.reviewDisposition && check.reviewDisposition !== PRIOR_ANALYSIS_CONCLUSION) {
      errors.push(`invalid validation review disposition: ${check.id}`);
    }
  }
  for (const item of map.learningDelta) {
    rejectUnknownKeys(item, DELTA_KEYS, `learning delta ${item.id}`, errors);
    if (['added', 'updated', 'invalidated'].some((field) => !Array.isArray(item[field]) || item[field].length > 64)) {
      errors.push(`too many learning delta refs: ${item.id}`);
    }
  }
  for (const item of map.ambiguities) {
    rejectUnknownKeys(item, new Set(['code', 'capabilities']), 'ambiguity', errors);
    if (item.capabilities && (!Array.isArray(item.capabilities) || item.capabilities.length > 56)) {
      errors.push('too many ambiguity capability refs');
    }
  }
  const walk = (value) => {
    if (typeof value === 'string' && Buffer.byteLength(value) > 512) errors.push('prohibited oversized value');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (PROHIBITED_KEY.test(key)) errors.push(`prohibited field: ${key}`);
      walk(child);
    }
  };
  walk(map);
  if (map.metrics.evidenceCount !== map.evidence.length || map.metrics.dependencyCount !== map.dependencies.length ||
    map.metrics.knownGoodCount !== map.knownGood.length || map.metrics.proofGapCount !== map.proofGaps.length) {
    errors.push('invalid Context Map metrics');
  }
  if (!Number.isInteger(map.metrics.bytes) || !Number.isInteger(map.metrics.tokenProxy) ||
    !Number.isInteger(map.metrics.tokenProxyCeiling) || map.metrics.tokenProxyCeiling < 1 ||
    !['WITHIN_BUDGET', 'OVER_BUDGET'].includes(map.metrics.budgetStatus)) errors.push('invalid Context Map budget metrics');
  if (map.validation.structural !== 'VALID' || !HASH.test(map.validation.fingerprint ?? '')) {
    errors.push('invalid structural validation state');
  }
  if (map.metrics.budgetStatus === 'OVER_BUDGET' && !map.metrics.budgetReason) errors.push('OVER_BUDGET requires reason');
  const expected = finalizeContextMap(map, { tokenCeiling: map.metrics.tokenProxyCeiling,
    budgetReason: map.metrics.budgetReason });
  if (expected.metrics.bytes !== map.metrics.bytes || expected.metrics.tokenProxy !== map.metrics.tokenProxy ||
    expected.validation.fingerprint !== map.validation.fingerprint) errors.push('stale Context Map metrics');
  return { status: errors.length ? 'INVALID' : 'VALID', errors: sortedUnique(errors) };
}

export function validateContextMap(map, options = {}) {
  try {
    return validateContextMapUnsafe(map, options);
  } catch (error) {
    return { status: 'INVALID', errors: [`validator rejected malformed map: ${error.message}`] };
  }
}
