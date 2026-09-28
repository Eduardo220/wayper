import { createGoalExecution, goalReference } from '../wayper-context-identity.mjs';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../wayper-context.mjs';
import {
  finalizeContextMap,
  recordContextEntry,
  refreshContextMap,
  sourceFingerprint,
} from '../wayper-context-map.mjs';
import { buildContextPacket } from '../wayper-context-packet.mjs';
import {
  STRUCTURED_HANDOFF_EVALS_PATH,
  buildStructuredHandoff,
  consumePacketizedCanary,
  selectSpecialistExecutionPolicy,
  validateStructuredHandoff,
} from '../wayper-structured-handoff.mjs';
import { loadCapabilityFiles } from './check-capability-routing.mjs';

export function createHandoffFixture(targetId = 'wayper_geospatial_reviewer', overrides = {}) {
  const registry = overrides.registry ?? loadCapabilityFiles().registry;
  const capability = overrides.capability ?? 'route-geometry';
  const risks = overrides.risks ?? ['GPS_GEO'];
  const evidence = overrides.evidence ?? { path: 'src/utils/zones.js', range: 'L37-L92',
    claim: 'Zone coordinate normalization and polygon validation owner' };
  const repositories = [{ id: 'wayper', root: ROOT, logicalRoot: '.' }];
  const execution = createGoalExecution({ threadId: 'handoff-eval', repositories });
  const mapOptions = { execution, goalId: goalReference(execution.identity), taskClass: 'BOUNDED', tokenCeiling: 4_000,
    repositories, registry, risks, invariants: ['STRUCTURED_FACTS_NOT_TRANSCRIPT'],
    validations: [], workingArtifacts: [] };
  let map = refreshContextMap(null, mapOptions);
  map.capabilities.required = [capability];
  map = finalizeContextMap(map, mapOptions);
  map = recordContextEntry(map, 'evidence', { repository: 'wayper', path: evidence.path,
    range: evidence.range, status: 'PROVEN', category: 'SOURCE_OWNER', provenance: 'SOURCE',
    claim: evidence.claim, capabilityRefs: [capability] },
  repositories, mapOptions);
  const sourceEvidenceId = map.evidence.at(-1).id;
  map = recordContextEntry(map, 'evidence', { repository: 'wayper', path: evidence.path,
    range: evidence.range, status: 'PROVEN', category: 'AUDIT_RESULT', provenance: 'SOURCE',
    claim: overrides.priorClaim ?? 'Prior analysis concluded polygon validation is correct', capabilityRefs: [capability],
    reviewDisposition: 'PRIOR_ANALYSIS_CONCLUSION' }, repositories, mapOptions);
  const priorEvidenceId = map.evidence.find((item) => item.reviewDisposition)?.id;
  const proofGap = overrides.proofGap ?? { claim: 'Runtime polygon behavior remains unobserved',
    reason: 'No runtime observation is in scope', requiredEvidence: 'A runtime polygon behavior observation' };
  map = recordContextEntry(map, 'proof-gap', { status: 'OPEN', evidenceIds: [], capabilityRefs: [capability],
    ...proofGap }, repositories, mapOptions);
  const proofGapId = map.proofGaps[0].id;
  const target = targetId === 'independent-review' || targetId === 'followup-review'
    ? { type: 'validationRole', id: targetId, capabilities: [capability], repositories: ['wayper'],
      objective: `${targetId} polygon validation` }
    : { type: 'agentProfile', id: targetId, repositories: ['wayper'],
      objective: overrides.objective ?? 'Review polygon validation' };
  const packet = buildContextPacket(map, target, { registry });
  return { registry, map, packet, repositories, sourceEvidenceId, priorEvidenceId, proofGapId };
}

export function validHandoffDraft(packet) {
  return { schemaVersion: 1, goalId: packet.goalId, taskId: 'polygon-validation', agentId: packet.target.id,
    packetId: packet.packetId, status: 'NO_FINDINGS', confidence: 0.8, coverage: ['route-geometry'], findings: [],
    evidenceRefs: [packet.evidenceRefs[0]], newEvidence: [], risks: ['GPS_GEO'], recommendations: [],
    filesRead: [{ repository: 'wayper', path: 'src/utils/zones.js', range: 'L37-L92', symbol: 'isValidPolygon',
      classification: 'PACKET_SCOPED_READ' }], filesChanged: [], tests: [],
    proofGaps: packet.proofGapRefs.map((id) => ({ id })),
    ambiguities: [], blockers: [], metrics: {} };
}

function finding(packet, id = 'F-collinear') {
  return { id, severity: 'MEDIUM', category: 'POLYGON_VALIDATION',
    claim: 'Three distinct collinear points are accepted as a polygon',
    scenario: 'A three-point route lies on one straight latitude', impact: 'The capture path can emit a zero-area polygon',
    safeguard: 'Reject near-zero triangle area', confidence: 0.95, evidenceRefs: [packet.evidenceRefs[0]], proofGapRefs: [],
    affectedCapabilities: ['route-geometry'] };
}

function validate(draft, fixture, budgetReason) {
  const handoff = buildStructuredHandoff(draft, { packet: fixture.packet, budgetReason });
  return { handoff, result: validateStructuredHandoff(handoff, { packet: fixture.packet, contextMap: fixture.map,
    registry: fixture.registry, repositoryDefinitions: fixture.repositories }) };
}

async function execute(item) {
  let fixture = createHandoffFixture();
  const draft = validHandoffDraft(fixture.packet);
  let expected = 'VALID'; let assertion = () => true; let correction;
  switch (item.scenario) {
    case 'DONE_NO_FINDING': draft.status = 'DONE'; break;
    case 'EXISTING_EVIDENCE': draft.status = 'DONE'; draft.findings = [finding(fixture.packet)]; break;
    case 'NEW_EVIDENCE': {
      const source = sourceFingerprint(ROOT, 'scripts/wayper-structured-handoff.mjs', 'L1-L20');
      draft.filesRead.push({ repository: 'wayper', path: 'scripts/wayper-structured-handoff.mjs', range: 'L1-L20',
        classification: 'OUT_OF_PACKET_READ', reason: 'Validate the handoff boundary implementation' });
      draft.newEvidence.push({ id: 'NE-validator', repository: 'wayper', path: 'scripts/wayper-structured-handoff.mjs',
        range: 'L1-L20', symbol: 'STRUCTURED_HANDOFF_SCHEMA_VERSION', sourceHash: source.hash, category: 'VALIDATOR',
        claim: 'The validator exposes schema v1', provenance: 'SOURCE', capabilityRefs: ['route-geometry'] });
      break;
    }
    case 'INVALID_EVIDENCE_REF': draft.evidenceRefs.push('E-missing'); expected = 'INVALID_HANDOFF'; break;
    case 'STALE_PACKET': fixture.map.risks.push('STALE_PACKET_TEST');
      fixture.map = finalizeContextMap(fixture.map, { tokenCeiling: fixture.map.metrics.tokenProxyCeiling });
      expected = 'INVALID_HANDOFF'; break;
    case 'STALE_EVIDENCE': fixture.map.evidence[0].status = 'STALE'; expected = 'INVALID_HANDOFF'; break;
    case 'PROOF_GAP': draft.proofGaps.push({ id: 'PGP-collinearity', claim: 'Collinearity threshold is not established',
      reason: 'No approved tolerance is referenced', requiredEvidence: 'Approved geospatial tolerance',
      evidenceRefs: [fixture.packet.evidenceRefs[0]], capabilityRefs: ['route-geometry'] }); break;
    case 'PARTIAL': draft.status = 'PARTIAL'; break;
    case 'BLOCKED': draft.status = 'BLOCKED'; draft.blockers.push('Source dependency is unavailable'); break;
    case 'INVALID_STATUS': draft.status = 'INVALID_HANDOFF'; expected = 'INVALID_HANDOFF'; break;
    case 'DUPLICATE_FINDING': draft.status = 'DONE';
      draft.findings = [finding(fixture.packet, 'F-one'), finding(fixture.packet, 'F-two')];
      expected = 'INVALID_HANDOFF'; break;
    case 'OVER_BUDGET':
      draft.status = 'DONE'; draft.findings = Array.from({ length: 28 }, (_, index) => ({ ...finding(fixture.packet, `F-${index}`),
        claim: `Collinear polygon acceptance finding ${index}`, scenario: `Collinear route scenario ${index}` }));
      assertion = ({ handoff }) => handoff.metrics.budgetStatus === 'OVER_BUDGET' && Boolean(handoff.metrics.budgetReason);
      break;
    case 'READ_ONLY_WRITE': draft.filesChanged.push({ repository: 'wayper', path: 'src/utils/zones.js' }); expected = 'INVALID_HANDOFF'; break;
    case 'INDEPENDENT_REVIEW':
      fixture = createHandoffFixture('independent-review'); Object.assign(draft, validHandoffDraft(fixture.packet));
      assertion = () => !fixture.packet.evidenceRefs.includes(fixture.priorEvidenceId); break;
    case 'FOLLOWUP_REVIEW':
      fixture = createHandoffFixture('followup-review'); Object.assign(draft, validHandoffDraft(fixture.packet));
      assertion = () => fixture.packet.evidenceRefs.includes(fixture.priorEvidenceId); break;
    case 'CROSS_REPO_INVALID': draft.filesRead[0].repository = 'wayper-site'; expected = 'INVALID_HANDOFF'; break;
    case 'ONE_CORRECTION': draft.status = 'INVALID_HANDOFF'; correction = validHandoffDraft(fixture.packet); break;
    case 'SECOND_INVALID': draft.status = 'INVALID_HANDOFF'; correction = { ...validHandoffDraft(fixture.packet), status: 'INVALID_HANDOFF' };
      expected = 'INVALID_HANDOFF'; break;
    case 'SOURCE_EXPANSION':
      draft.filesRead.push({ repository: 'wayper', path: 'src/utils/zones.js', range: 'L93-L104',
        classification: 'OUT_OF_PACKET_READ', reason: 'Finish reading the target implementation beyond its packet range' });
      assertion = ({ handoff }) => handoff.metrics.outOfPacketReads === 1; break;
    case 'TRANSCRIPT_BLOAT': draft.transcript = 'copied agent transcript'; expected = 'INVALID_HANDOFF'; break;
    default: throw new Error(`Unknown handoff eval scenario: ${item.scenario}`);
  }
  if (item.scenario === 'ONE_CORRECTION' || item.scenario === 'SECOND_INVALID') {
    const policy = selectSpecialistExecutionPolicy(fixture.packet);
    const dispatch = { source: 'ORCHESTRATOR', event: 'FINAL_RESULT', mode: 'CANARY', optIn: true, readOnly: true,
      forkTurns: 'none', descendants: 0, packetId: fixture.packet.packetId, agentId: fixture.packet.target.id,
      selectionSource: 'DECISION_GATE', policyId: policy.id, model: policy.model,
      reasoningEffort: policy.reasoningEffort };
    const consumed = await consumePacketizedCanary({ dispatch,
      completion: draft, correct: async () => correction, packet: fixture.packet, contextMap: fixture.map,
      registry: fixture.registry, repositoryDefinitions: fixture.repositories });
    const invalidExpected = item.scenario === 'ONE_CORRECTION' ? 1 : 2;
    return { id: item.id, pass: consumed.status === expected && consumed.correctionAttempts === 1 &&
      consumed.invalidHandoffs === invalidExpected,
      status: consumed.status, correctionAttempts: consumed.correctionAttempts };
  }
  const evaluated = validate(draft, fixture, item.scenario === 'OVER_BUDGET' ? 'Critical findings retained without truncation' : undefined);
  return { id: item.id, pass: evaluated.result.status === expected && assertion(evaluated),
    status: evaluated.result.status, bytes: evaluated.handoff.metrics.handoffBytes,
    tokenProxy: evaluated.handoff.metrics.handoffTokenProxy };
}

export async function evaluateStructuredHandoffCases(root = ROOT) {
  const suite = JSON.parse(fs.readFileSync(path.join(root, STRUCTURED_HANDOFF_EVALS_PATH), 'utf8'));
  const ids = suite?.cases?.map((item) => item.id) ?? [];
  if (suite?.schemaVersion !== 1 || !Array.isArray(suite.cases) || ids.length !== 20 || new Set(ids).size !== 20 ||
    ids.some((id, index) => !id.startsWith(`SH${String(index + 1).padStart(2, '0')}_`))) {
    throw new Error('Unsupported or incomplete Structured Handoff eval corpus');
  }
  const cases = [];
  for (const item of suite.cases) cases.push(await execute(item));
  return { status: cases.every((item) => item.pass) ? 'PASS' : 'FAIL', passed: cases.filter((item) => item.pass).length,
    evals: cases.length, handoffBytes: cases.filter((item) => item.status === 'VALID')
      .reduce((sum, item) => sum + (item.bytes ?? 0), 0), cases };
}

export function formatStructuredHandoffBenchmark(result) {
  return [`STRUCTURED HANDOFFS ${result.status}`, `${result.passed}/${result.evals} evals`,
    `${result.handoffBytes} validated handoff bytes`].join('\n');
}
