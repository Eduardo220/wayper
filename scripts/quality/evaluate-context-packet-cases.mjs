import { createGoalExecution, goalReference } from '../wayper-context-identity.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT } from '../wayper-context.mjs';
import {
  integrateRouterOutput,
  recordContextEntry,
  refreshContextMap,
  sourceFingerprint,
  validateContextMap,
} from '../wayper-context-map.mjs';
import { routeTask } from '../wayper-agent-router.mjs';
import {
  CONTEXT_PACKET_EVALS_PATH,
  aggregatePacketTelemetry,
  buildContextPacket,
  isReviewConclusionEvidence,
  validateContextPacket,
} from '../wayper-context-packet.mjs';
import { loadCapabilityFiles } from './check-capability-routing.mjs';
import { fingerprintCorpus } from './check-graph-scopes.mjs';
import { observedGate } from './evidence-fixture.mjs';

const CEILINGS = { TRIVIAL: 1_500, BOUNDED: 4_000, BUG: 8_000, INVESTIGATION: 10_000,
  ARCHITECTURAL: 16_000, CRITICAL_RUNTIME: 24_000 };
const REQUIRED_CASE_IDS = new Set([
  'CP01_ZERO_SPECIALIST_TRIVIAL', 'CP02_LIFECYCLE', 'CP03_GPS',
  'CP04_PERSISTENCE', 'CP05_CONCURRENCY', 'CP06_TERRITORY',
  'CP07_ANDROID_NATIVE', 'CP08_MOBILE_CROSS_DOMAIN', 'CP09_SITE_WEBGL', 'CP10_SITE_PUBLIC_CONTRACT',
  'CP11_CROSS_REPO', 'CP12_KNOWN_GOOD_REUSE', 'CP13_QUESTIONED_KNOWN_GOOD', 'CP14_PROOF_GAP',
  'CP15_SHARED_EVIDENCE_THREE_PACKETS', 'CP16_PACKET_OVER_BUDGET', 'CP17_STALE_PACKET',
  'CP18_MISSING_OPERATIONAL_PROFILE', 'CP19_INDEPENDENT_REVIEW', 'CP20_GRAPHIFY_REFS_AVAILABLE',
]);

function repository(id, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${id}-packet-`));
  fs.writeFileSync(path.join(root, '.gitignore'), 'graphify-out/\n.wayper-context/\n');
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(root, file), content);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Wayper', '-c', 'user.email=wayper@example.test',
    'commit', '-qm', 'packet fixture'], { cwd: root });
  return { id, root, logicalRoot: id === 'wayper' ? '.' : '../wayper-site' };
}

function graphFixture(repo) {
  const output = path.join(repo.root, 'graphify-out');
  fs.mkdirSync(output, { recursive: true });
  const graph = { nodes: [{ id: 'owner' }, { id: 'dependency' }],
    edges: [{ source: 'owner', target: 'dependency', relation: 'imports' }] };
  fs.writeFileSync(path.join(output, 'graph.json'), JSON.stringify(graph));
  const sourceFingerprintValue = fingerprintCorpus({ repository: repo.id, root: repo.root,
    peerDirectory: repo.id === 'wayper' ? 'wayper-site' : 'wayper', querySymbols: [] }).fingerprint;
  const metadata = { repository: repo.id, root: fs.realpathSync(repo.root), scope: 'repository-code-only',
    sourceFingerprint: sourceFingerprintValue,
    graphSha256: sourceFingerprint(repo.root, 'graphify-out/graph.json').hash,
    graphifyVersion: 'packet-eval-1' };
  fs.writeFileSync(path.join(output, 'scope.json'), JSON.stringify(metadata));
  return metadata;
}

function fixtureFiles(item) {
  const files = { 'shared.js': `export const shared = true;\n/* ${'shared-context '.repeat(180)}*/\n`,
    'dependency.js': 'export const dependency = true;\n' };
  item.capabilities.forEach((capability, index) => {
    files[`owner-${index}.js`] = `export const owner${index} = true;\n/* ${`${capability} `.repeat(220)}*/\n`;
  });
  if (!item.capabilities.length) files['owner.js'] = 'export const owner = true;\n';
  return files;
}

function targetList(item, routerOutput) {
  const common = { objective: item.id, repositories: item.repositories,
    tokenProxyCeiling: item.tokenProxyCeiling,
    budgetReason: item.tokenProxyCeiling === 1 ? 'Required evidence exercises OVER_BUDGET without truncation' : undefined };
  if (item.targetMode === 'NATIVE_ROLE') return [{ ...common, type: 'nativeRole', id: 'explorer',
    capabilities: item.capabilities }];
  if (item.targetMode === 'INDEPENDENT_REVIEW') return [{ ...common, type: 'validationRole', id: 'independent-review',
    capabilities: item.capabilities }];
  if (item.targetMode === 'THREE_CAPABILITY_PACKETS') return item.capabilities.map((capability) => ({
    ...common, type: 'capabilitySet', id: capability, capabilities: [capability],
  }));
  const targets = routerOutput.selectedProfiles.map((profile) => ({ ...common, type: 'agentProfile', id: profile.id }));
  for (const capability of routerOutput.coverage.required.uncovered) targets.push({ ...common,
    type: 'capabilitySet', id: capability, capabilities: [capability] });
  return targets;
}

function percent(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function executeCase(item, registry, registryBytes) {
  const files = fixtureFiles(item);
  const repos = item.repositories.map((id) => repository(id, files));
  try {
    const graph = item.graphify ? graphFixture(repos[0]) : null;
    const execution = createGoalExecution({ threadId: item.id, repositories: repos });
    const options = { execution, goalId: goalReference(execution.identity), taskClass: item.taskClass,
      tokenCeiling: CEILINGS[item.taskClass], repositories: repos, risks: item.riskFlags ?? [],
      invariants: ['MINIMUM_SUFFICIENT_CONTEXT', 'REFERENCE_BEFORE_CONTENT'],
      validations: ['quality:context-packets'], workingArtifacts: [], registry };
    let map = refreshContextMap(null, options);
    const changedFiles = item.repositories.map((repositoryId, index) => ({ repository: repositoryId,
      path: item.capabilities.length ? `owner-${index % item.capabilities.length}.js` : 'owner.js' }));
    const routerInput = { schemaVersion: 1, goalId: options.goalId, operation: 'CONTEXT_PACKET_SHADOW',
      repositories: item.repositories, changedFiles, candidatePaths: [], riskFlags: item.riskFlags ?? [],
      knownCapabilities: item.capabilities, knownGoodCapabilities: [], capabilityAssessmentComplete: true,
      structuralUncertainty: item.structuralUncertainty === true, signals: [] };
    const routerOutput = routeTask(routerInput, registry);
    map = integrateRouterOutput(map, routerOutput, options);
    const evidenceIds = [];
    if (item.sharedEvidence && item.capabilities.length) {
      map = recordContextEntry(map, 'evidence', { repository: repos[0].id, path: 'shared.js', category: 'SHARED_OWNER',
        claim: 'Shared evidence is required by three capability packets', provenance: 'SOURCE', status: 'PROVEN',
        capabilityRefs: item.capabilities }, repos, options);
      evidenceIds.push(map.evidence.at(-1).id);
    } else for (const [index, capability] of item.capabilities.entries()) {
      const repo = repos[index % repos.length];
      map = recordContextEntry(map, 'evidence', { repository: repo.id, path: `owner-${index}.js`, category: 'REQUIRED_OWNER',
        claim: `Current source proves ${capability}`, provenance: 'SOURCE', status: 'PROVEN',
        capabilityRefs: [capability] }, repos, options);
      evidenceIds.push(map.evidence.find((entry) => entry.capabilityRefs?.includes(capability)).id);
    }
    if (item.reviewConclusion) map = recordContextEntry(map, 'evidence', { repository: repos[0].id,
      path: 'shared.js', category: 'AUDIT_RESULT', claim: 'Prior reviewer concluded the implementation is correct',
      reviewDisposition: 'PRIOR_ANALYSIS_CONCLUSION',
      provenance: 'OBSERVATION', status: 'PROVEN', capabilityRefs: item.capabilities }, repos, options);
    if (item.dependency) {
      map = recordContextEntry(map, 'dependency', { from: { repository: repos[0].id, ref: 'owner-0.js' },
        to: { repository: repos[0].id, ref: 'dependency.js' }, relation: 'IMPORTS', provenance: 'SOURCE',
        evidenceIds: [evidenceIds[0]] }, repos, options);
    }
    if (item.knownGood) {
      map = recordContextEntry(map, 'validation', { id: 'quality:capabilities', status: 'PASS',
        evidence: observedGate({ root: repos[0].root, repositories: repos, execution,
          repository: repos[0].id }, 'quality:capabilities').receiptId }, repos, options);
      map = recordContextEntry(map, 'known-good', { repository: repos[0].id,
        capability: item.capabilities[0], proofRefs: ['quality:capabilities'] }, repos, options);
      if (item.questionKnownGood) map = refreshContextMap(map, { ...options, questions: [item.capabilities[0]] });
    }
    if (item.proofGap) map = recordContextEntry(map, 'proof-gap', { claim: 'Runtime replay remains unobserved',
      reason: 'No runtime observation in packet eval', requiredEvidence: 'Observed replay result',
      capabilityRefs: item.capabilities }, repos, options);
    if (graph) map = recordContextEntry(map, 'graphify', { repository: repos[0].id,
      version: graph.graphifyVersion, scopeFingerprint: graph.sourceFingerprint, graphFingerprint: graph.graphSha256,
      purpose: 'Confirm structural owner dependency', nodeRefs: [`${repos[0].id}:owner`], edgeRefs: [],
      capabilityRefs: item.capabilities }, repos, options);
    const mapValidation = validateContextMap(map, { repositoryDefinitions: repos, registry });
    assert.equal(mapValidation.status, 'VALID', mapValidation.errors.join('; '));
    const targets = targetList(item, routerOutput);
    const packets = targets.map((target) => buildContextPacket(map, target, { registry, routerOutput }));
    const packetValidations = packets.map((packet) => validateContextPacket(packet, { contextMap: map, registry, repositoryDefinitions: repos }));
    let staleDetected = false;
    if (item.scenario === 'STALE_PACKET') {
      map = recordContextEntry(map, 'validation', { id: 'post-build-change', status: 'PASS',
        evidence: 'post-build-change PASS' }, repos, options);
      staleDetected = validateContextPacket(packets[0], { contextMap: map, registry, repositoryDefinitions: repos }).errors.includes('PACKET_STALE');
    }
    const telemetry = aggregatePacketTelemetry(map, packets, { routerOutput, shadowLogBytes: 0 });
    const allEvidence = new Set(packets.flatMap((packet) => packet.evidenceRefs));
    const allCapabilities = new Set(packets.flatMap((packet) => packet.capabilities.required));
    const allGaps = new Set(packets.flatMap((packet) => packet.proofGapRefs));
    const requiredCapabilities = new Set(routerOutput.requiredCapabilities.map(({ id }) => id));
    const independent = item.targetMode === 'INDEPENDENT_REVIEW';
    const requiredEvidence = map.evidence.filter((entry) => ['PROVEN', 'HIGH_CONFIDENCE'].includes(entry.status) &&
      !(independent && isReviewConclusionEvidence(entry)) &&
      (entry.capabilityRefs ?? []).some((id) => requiredCapabilities.has(id)));
    const requiredGaps = map.proofGaps.filter((gap) => gap.status === 'OPEN' &&
      (gap.capabilityRefs ?? []).some((id) => requiredCapabilities.has(id)));
    const broadBytes = map.metrics.bytes + registryBytes + Buffer.byteLength(JSON.stringify(routerOutput)) +
      map.evidence.filter((entry) => entry.status !== 'STALE').reduce((sum, entry) => sum + entry.sourceBytes, 0);
    const packetBytes = packets.reduce((sum, packet) => sum + packet.metrics.packetBytes, 0);
    const evidenceCoverage = requiredEvidence.length ? requiredEvidence.filter((entry) => allEvidence.has(entry.id)).length / requiredEvidence.length : 1;
    const capabilityCoverage = requiredCapabilities.size ? [...requiredCapabilities].filter((id) => allCapabilities.has(id)).length / requiredCapabilities.size : 1;
    const proofGapCoverage = requiredGaps.length ? requiredGaps.filter((gap) => allGaps.has(gap.id)).length / requiredGaps.length : 1;
    const scenario = {
      zeroSpecialist: item.scenario !== 'ZERO_SPECIALIST' || packets.length === 0,
      missingProfile: item.scenario !== 'MISSING_PROFILE' || packets.some((packet) => packet.target.type === 'capabilitySet'),
      knownGood: !item.knownGood || item.questionKnownGood || packets.some((packet) => packet.knownGoodRefs.length),
      questionedKnownGood: !item.questionKnownGood || packets.some((packet) =>
        packet.ambiguities.some((value) => value.startsWith('KNOWN_GOOD_QUESTIONED:'))),
      proofGap: !item.proofGap || packets.some((packet) => packet.proofGapRefs.length),
      sharedEvidence: !item.sharedEvidence || (packets.length === 3 && telemetry.deduplication.repeatedRefs >= 2 &&
        telemetry.duplicatedBytesAvoided > 0),
      overBudget: item.scenario !== 'OVER_BUDGET' || packets.every((packet) => packet.contextBudget.status === 'OVER_BUDGET'),
      stalePacket: item.scenario !== 'STALE_PACKET' || staleDetected,
      independentReview: !item.reviewConclusion || packets.every((packet) =>
        packet.exclusions.includes('PRIOR_REVIEW_CONCLUSIONS') && !packet.evidenceRefs.some((id) =>
          isReviewConclusionEvidence(map.evidence.find((entry) => entry.id === id)))),
      graphify: !item.graphify || packets.some((packet) => packet.graphifyRefs.length),
      nativeRole: item.targetMode !== 'NATIVE_ROLE' || packets.every((packet) => packet.target.type === 'nativeRole'),
      crossRepo: item.scenario !== 'CROSS_REPO' || packets.every((packet) => packet.repositories.length === 2),
    };
    const assertions = { schema: packetValidations.every((result) => result.status === 'VALID'),
      determinism: packets.every((packet, index) => JSON.stringify(packet) === JSON.stringify(
        buildContextPacket(map, targets[index], { registry, routerOutput }))) || item.scenario === 'STALE_PACKET',
      evidenceCoverage: evidenceCoverage === 1, capabilityCoverage: capabilityCoverage === 1,
      proofGapCoverage: proofGapCoverage === 1, referenceOnly: packets.every((packet) =>
        packet.metrics.inlineBytes === 0 && packet.metrics.sourceBytesMaterialized === 0),
      reduction: packetBytes < broadBytes, ...scenario };
    return { id: item.id, pass: Object.values(assertions).every(Boolean), assertions,
      packets: packets.length, broadBytes, packetBytes, reduction: broadBytes ? (broadBytes - packetBytes) / broadBytes : 0,
      evidenceCoverage, capabilityCoverage, proofGapCoverage, telemetry };
  } finally {
    for (const repo of repos) fs.rmSync(repo.root, { recursive: true, force: true });
  }
}

export function evaluateContextPacketCases(root = ROOT) {
  const suite = JSON.parse(fs.readFileSync(path.join(root, CONTEXT_PACKET_EVALS_PATH), 'utf8'));
  const ids = suite?.cases?.map((item) => item.id) ?? [];
  if (suite?.schemaVersion !== 1 || !Array.isArray(suite.cases) || ids.length !== REQUIRED_CASE_IDS.size ||
    new Set(ids).size !== ids.length || ids.some((id) => !REQUIRED_CASE_IDS.has(id))) {
    throw new Error('Unsupported or incomplete Context Packet eval corpus');
  }
  const { registry, registryBytes } = loadCapabilityFiles(root);
  const cases = suite.cases.map((item) => executeCase(item, registry, registryBytes));
  const reductions = cases.map((item) => item.reduction);
  const broadBytes = cases.reduce((sum, item) => sum + item.broadBytes, 0);
  const packetBytes = cases.reduce((sum, item) => sum + item.packetBytes, 0);
  return { status: cases.every((item) => item.pass) ? 'PASS' : 'FAIL', evals: cases.length,
    passed: cases.filter((item) => item.pass).length,
    packetsBuilt: cases.reduce((sum, item) => sum + item.packets, 0), broadBytes, packetBytes,
    reduction: broadBytes ? (broadBytes - packetBytes) / broadBytes : 0,
    p50Reduction: percent(reductions, 0.5), p90Reduction: percent(reductions, 0.9),
    bestCase: cases.reduce((best, item) => item.reduction > best.reduction ? item : best),
    worstCase: cases.reduce((worst, item) => item.reduction < worst.reduction ? item : worst),
    zeroSpecialist: cases.find((item) => item.id === 'CP01_ZERO_SPECIALIST_TRIVIAL'),
    complexCrossDomain: cases.find((item) => item.id === 'CP08_MOBILE_CROSS_DOMAIN'), cases };
}

export function formatPacketBenchmark(result) {
  return [`CONTEXT PACKETS ${result.status}`, `${result.passed}/${result.evals} evals / ${result.packetsBuilt} shadow packets`,
    `broad ${result.broadBytes} B -> packets ${result.packetBytes} B (-${(result.reduction * 100).toFixed(1)}%)`,
    `p50 ${(result.p50Reduction * 100).toFixed(1)}% / p90 ${(result.p90Reduction * 100).toFixed(1)}%`,
    `best ${result.bestCase.id} ${(result.bestCase.reduction * 100).toFixed(1)}%`,
    `worst ${result.worstCase.id} ${(result.worstCase.reduction * 100).toFixed(1)}%`,
    `coverage evidence/capability/proof-gap ${result.cases.every((item) => item.evidenceCoverage === 1) ? '100%' : 'FAIL'}/` +
      `${result.cases.every((item) => item.capabilityCoverage === 1) ? '100%' : 'FAIL'}/` +
      `${result.cases.every((item) => item.proofGapCoverage === 1) ? '100%' : 'FAIL'}`].join('\n');
}
