import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { finalizeContextMap, integrateRouterOutput, sourceFingerprint } from './wayper-context-map.mjs';
import {
  LEGACY_SPECIALIST_MODE,
  PACKETIZED_SPECIALIST_MODE,
  SPECIALIST_EXECUTION_POLICY,
  aggregateHandoffTelemetry,
  buildStructuredHandoff,
  consumePacketizedCanary,
  consumePacketizedSpecialist,
  planContextMapMerge,
  preparePacketizedSpecialist,
  selectSpecialistExecutionPolicy,
  validateHarnessSpecialistDispatches,
  validateStructuredHandoff,
} from './wayper-structured-handoff.mjs';
import { createHandoffFixture, validHandoffDraft } from './quality/evaluate-structured-handoff-cases.mjs';
import { ROUTER_SELECTION_DECISIONS, routeTask } from './wayper-agent-router.mjs';
import { baselineFor, createGoalExecution, goalReference } from './wayper-context-identity.mjs';
import { validateContextPacket } from './wayper-context-packet.mjs';

const options = (fixture) => ({ packet: fixture.packet, contextMap: fixture.map, registry: fixture.registry,
  repositoryDefinitions: fixture.repositories });
const dispatch = (fixture) => {
  const policy = selectSpecialistExecutionPolicy(fixture.packet);
  return { source: 'ORCHESTRATOR', event: 'FINAL_RESULT', mode: 'CANARY', optIn: true,
    readOnly: true, forkTurns: 'none', descendants: 0, packetId: fixture.packet.packetId,
    agentId: fixture.packet.target.id, selectionSource: 'DECISION_GATE', policyId: policy.id,
    model: policy.model, reasoningEffort: policy.reasoningEffort };
};
const operationalDispatch = (fixture) => ({ ...dispatch(fixture), mode: PACKETIZED_SPECIALIST_MODE,
  selectionSource: 'DECISION_GATE' });
const selection = (fixture) => ({ source: 'DECISION_GATE', decided: true, agentId: fixture.packet.target.id,
  objective: fixture.packet.objective, repositories: fixture.packet.repositories });

test('SH10 Packet/Handoff v1 reject another Goal, revision or baseline through the Map reference', () => {
  const fixture = createHandoffFixture();
  const handoff = buildStructuredHandoff(validHandoffDraft(fixture.packet), options(fixture));
  for (const change of ['goal', 'revision', 'baseline']) {
    const map = structuredClone(fixture.map);
    if (change === 'goal') map.execution = createGoalExecution({
      threadId: map.execution.identity.threadId, repositories: fixture.repositories });
    if (change === 'revision') map.execution.identity.revision += 1;
    if (change === 'baseline') {
      map.execution.baseline.repositories[0].head = 'f'.repeat(40);
      map.execution.baseline = baselineFor(map.execution.baseline.repositories);
    }
    map.goalId = goalReference(map.execution.identity);
    const changed = finalizeContextMap(map);
    assert.notEqual(changed.validation.fingerprint, fixture.map.validation.fingerprint);
    assert.ok(validateContextPacket(fixture.packet, { contextMap: changed, registry: fixture.registry }).errors.includes('PACKET_STALE'));
    assert.equal(validateStructuredHandoff(handoff, { ...options(fixture), contextMap: changed }).status, 'INVALID_HANDOFF');
  }
});

test('SH1 builds a compact closed read-only handoff and owner-only merge plan', () => {
  const fixture = createHandoffFixture();
  const draft = validHandoffDraft(fixture.packet);
  const source = sourceFingerprint(fixture.repositories[0].root, 'scripts/wayper-structured-handoff.mjs', 'L1-L20');
  draft.filesRead.push({ repository: 'wayper', path: 'scripts/wayper-structured-handoff.mjs', range: 'L1-L20',
    classification: 'OUT_OF_PACKET_READ', reason: 'Inspect the validator boundary' });
  draft.newEvidence.push({ id: 'NE-schema', repository: 'wayper', path: 'scripts/wayper-structured-handoff.mjs',
    range: 'L1-L20', sourceHash: source.hash, category: 'SCHEMA', claim: 'Structured Handoff schema is versioned',
    provenance: 'SOURCE', capabilityRefs: ['route-geometry'] });
  draft.filesRead.push({ repository: 'wayper', path: 'src/utils/zones.js', range: 'L93-L104',
    classification: 'OUT_OF_PACKET_READ', reason: 'Finish reading the target implementation beyond its packet range' });
  const handoff = buildStructuredHandoff(draft, { packet: fixture.packet });
  assert.equal(validateStructuredHandoff(handoff, options(fixture)).status, 'VALID');
  assert.equal(handoff.metrics.outOfPacketReads, 2);
  assert.deepEqual(handoff.filesChanged, []);
  const merge = planContextMapMerge(handoff, options(fixture));
  assert.equal(merge.ownerAction, 'CONTEXT_MAP_OWNER_REVIEW_REQUIRED');
  assert.equal(merge.newEvidence[0].status, 'UNVALIDATED');
  assert.equal(merge.newEvidence[0].sourceHash, undefined);
  const wrongNamespace = structuredClone(draft); wrongNamespace.newEvidence[0].id = 'F-schema';
  const invalid = buildStructuredHandoff(wrongNamespace, { packet: fixture.packet });
  assert.match(validateStructuredHandoff(invalid, options(fixture)).errors.join(';'), /invalid proposed evidence/);
});

test('SH2 rejects stale authority, self-promotion, writes, bloat and ungrounded findings', () => {
  const fixture = createHandoffFixture();
  const validate = (mutate) => {
    const draft = validHandoffDraft(fixture.packet); mutate(draft);
    const handoff = buildStructuredHandoff(draft, { packet: fixture.packet });
    return validateStructuredHandoff(handoff, options(fixture));
  };
  assert.equal(validate((draft) => { draft.filesChanged.push({ path: 'src/utils/zones.js' }); }).status, 'INVALID_HANDOFF');
  assert.equal(validate((draft) => { draft.transcript = 'forbidden'; }).status, 'INVALID_HANDOFF');
  const malformed = validate((draft) => { draft.coverage = { capability: 'route-geometry' }; });
  assert.deepEqual(malformed.errors, ['invalid handoff collections']);
  assert.equal(validate((draft) => { draft.status = 'DONE'; draft.findings.push({ id: 'F-gap', severity: 'HIGH',
    category: 'GEOMETRY', claim: 'Ungrounded claim', scenario: 'Unknown route', impact: 'Unknown impact',
    safeguard: 'Collect evidence', confidence: 0.2, evidenceRefs: [], proofGapRefs: [],
    affectedCapabilities: ['route-geometry'] }); }).status, 'INVALID_HANDOFF');
  assert.equal(validate((draft) => { draft.newEvidence.push({ id: 'NE-promoted', status: 'PROVEN' }); }).status, 'INVALID_HANDOFF');
  const stale = structuredClone(fixture);
  stale.map.risks.push('STALE_PACKET_TEST');
  stale.map = finalizeContextMap(stale.map, { tokenCeiling: stale.map.metrics.tokenProxyCeiling });
  const handoff = buildStructuredHandoff(validHandoffDraft(stale.packet), { packet: stale.packet });
  assert.match(validateStructuredHandoff(handoff, options(stale)).errors.join(';'), /PACKET_STALE/);
});

test('SH3 completion adapter is explicit, event-driven and permits at most one correction', async () => {
  const fixture = createHandoffFixture();
  const invalid = { ...validHandoffDraft(fixture.packet), status: 'INVALID_HANDOFF' };
  let calls = 0;
  const fixed = await consumePacketizedCanary({ dispatch: dispatch(fixture), completion: invalid,
    correct: async () => { calls += 1; return validHandoffDraft(fixture.packet); }, ...options(fixture) });
  assert.equal(fixed.status, 'VALID');
  assert.equal(fixed.correctionAttempts, 1);
  assert.equal(fixed.invalidHandoffs, 1);
  assert.equal(calls, 1);
  const unverified = await consumePacketizedCanary({ dispatch: { ...dispatch(fixture), forkTurns: 'all' },
    completion: validHandoffDraft(fixture.packet), ...options(fixture) });
  assert.equal(unverified.status, 'UNVERIFIED_CANARY');
});

test('SH4 telemetry derives handoff counts and leaves unsupported provider usage unavailable', async () => {
  const fixture = createHandoffFixture();
  const result = await consumePacketizedCanary({ dispatch: dispatch(fixture),
    completion: validHandoffDraft(fixture.packet), ...options(fixture) });
  const telemetry = aggregateHandoffTelemetry([result], { controlPayloadProxy: 900, canaryPayloadProxy: 300,
    controlResultProxy: 500, canaryHandoffProxy: result.handoff.metrics.handoffTokenProxy });
  assert.equal(telemetry.handoffsBuilt, 1);
  assert.equal(telemetry.invalidHandoffs, 0);
  assert.equal(telemetry.providerUsage.status, 'UNAVAILABLE');
});

test('SH5 an already-selected read-only specialist defaults to packetized execution with legacy fallback', async () => {
  const fixture = createHandoffFixture();
  const prepared = preparePacketizedSpecialist({ selection: selection(fixture), contextMap: fixture.map,
    registry: fixture.registry, repositoryDefinitions: fixture.repositories });
  assert.equal(prepared.status, 'READY');
  assert.equal(prepared.executionMode, PACKETIZED_SPECIALIST_MODE);
  assert.deepEqual(prepared.runtime, { forkTurns: 'none', readOnly: true, descendants: 0,
    model: 'gpt-5.6-sol', reasoningEffort: 'high' });
  assert.equal(prepared.policy.id, SPECIALIST_EXECUTION_POLICY);
  assert.deepEqual(prepared.policy.reasons, ['TASK_CLASS:BOUNDED', 'RISK:GPS_GEO',
    'CAPABILITY:NON_CRITICAL', 'COST_CLASS:QUALITY_FIRST']);

  const valid = await consumePacketizedSpecialist({ dispatch: operationalDispatch(fixture),
    completion: validHandoffDraft(fixture.packet), ...options(fixture) });
  assert.equal(valid.status, 'VALID');
  assert.equal(valid.executionMode, PACKETIZED_SPECIALIST_MODE);
  assert.equal(valid.policy.model, 'gpt-5.6-sol');

  let corrections = 0;
  const invalidCompletion = { ...validHandoffDraft(fixture.packet), status: 'INVALID_HANDOFF' };
  const invalid = await consumePacketizedSpecialist({ dispatch: operationalDispatch(fixture),
    completion: invalidCompletion, correct: async () => { corrections += 1; return invalidCompletion; }, ...options(fixture) });
  assert.equal(invalid.status, 'FALLBACK');
  assert.equal(invalid.executionMode, LEGACY_SPECIALIST_MODE);
  assert.equal(invalid.packetizedStatus, 'INVALID_HANDOFF');
  assert.equal(invalid.correctionAttempts, 1);
  assert.equal(invalid.invalidHandoffs, 2);
  assert.equal(corrections, 1);

  const mismatchedPolicy = await consumePacketizedSpecialist({ dispatch: { ...operationalDispatch(fixture),
    model: 'gpt-5.6-terra' }, completion: validHandoffDraft(fixture.packet), ...options(fixture) });
  assert.equal(mismatchedPolicy.status, 'BLOCKED');
  assert.equal(mismatchedPolicy.executionMode, 'NONE');
  assert.equal(mismatchedPolicy.reason, 'UNVERIFIED_PACKETIZED_DISPATCH');

  const routerAttempt = preparePacketizedSpecialist({ selection: { ...selection(fixture), source: 'ROUTER_SHADOW' },
    contextMap: fixture.map, registry: fixture.registry, repositoryDefinitions: fixture.repositories });
  assert.equal(routerAttempt.status, 'NOT_SELECTED');
  const unavailable = preparePacketizedSpecialist({ selection: selection(fixture), contextMap: null,
    registry: fixture.registry, repositoryDefinitions: fixture.repositories });
  assert.equal(unavailable.executionMode, LEGACY_SPECIALIST_MODE);
});

test('SH6 model/reasoning policy lowers simple work and preserves critical capabilities', () => {
  const fixture = createHandoffFixture();
  const simple = selectSpecialistExecutionPolicy({ ...fixture.packet, riskFlags: [],
    contextBudget: { ...fixture.packet.contextBudget, taskClass: 'TRIVIAL' } });
  assert.deepEqual({ model: simple.model, reasoningEffort: simple.reasoningEffort, costClass: simple.costClass },
    { model: 'gpt-5.6-luna', reasoningEffort: 'medium', costClass: 'COST_EFFICIENT' });
  const bounded = selectSpecialistExecutionPolicy({ ...fixture.packet, riskFlags: [] });
  assert.deepEqual({ model: bounded.model, reasoningEffort: bounded.reasoningEffort },
    { model: 'gpt-5.6-terra', reasoningEffort: 'medium' });
  const capabilityCritical = selectSpecialistExecutionPolicy({ ...fixture.packet, riskFlags: [],
    capabilities: { required: ['active-run-lifecycle'], optional: [] } });
  assert.deepEqual({ model: capabilityCritical.model, reasoningEffort: capabilityCritical.reasoningEffort },
    { model: 'gpt-5.6-sol', reasoningEffort: 'high' });
});

test('SH7 project dispatch hardening rejects direct runtime and profile bypasses', () => {
  const fixture = createHandoffFixture();
  const current = validateHarnessSpecialistDispatches({ registry: fixture.registry });
  assert.equal(current.status, 'VALID');
  assert.deepEqual(current.profiles, ['wayper_accessibility_reviewer', 'wayper_auth_security_reviewer',
    'wayper_concurrency_reviewer', 'wayper_diagnostics_privacy_reviewer', 'wayper_geospatial_reviewer',
    'wayper_mobile_lifecycle_reviewer', 'wayper_persistence_reviewer', 'wayper_progression_rules_reviewer']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-dispatch-'));
  try {
    fs.mkdirSync(path.join(root, '.agents/skills/wayper-context-efficiency'), { recursive: true });
    fs.mkdirSync(path.join(root, '.codex/agents'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'HARNESS_SPECIALIST_DISPATCH_V1\n');
    fs.writeFileSync(path.join(root, '.agents/skills/wayper-context-efficiency/SKILL.md'),
      'HARNESS_SPECIALIST_DISPATCH_V1\n');
    fs.writeFileSync(path.join(root, 'scripts/bypass.mjs'), 'spawn_agent({})\n');
    fs.writeFileSync(path.join(root, '.codex/hooks.toml'), 'agent_type = "wayper_concurrency_reviewer"\n');
    fs.writeFileSync(path.join(root, '.codex/agents/wayper_concurrency_reviewer.toml'),
      'name = "wayper_concurrency_reviewer"\nmodel = "gpt-5.6-sol"\n');
    const bypass = validateHarnessSpecialistDispatches({ root, registry: fixture.registry });
    assert.equal(bypass.status, 'BYPASS_DETECTED');
    assert.match(bypass.errors.join(';'), /DIRECT_RUNTIME_DISPATCH:scripts\/bypass\.mjs/);
    assert.match(bypass.errors.join(';'), /DIRECT_SPECIALIST_REFERENCE:\.codex\/hooks\.toml/);
    assert.match(bypass.errors.join(';'), /STATIC_SPECIALIST_POLICY_OVERRIDE/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('SH8 router-selected specialists enter only through the canonical packetized boundary', async () => {
  const fixture = createHandoffFixture();
  const routed = routeTask({ schemaVersion: 1, goalId: fixture.map.goalId, operation: 'REVIEW_ROUTE_GEOMETRY',
    repositories: ['wayper'], changedFiles: [], candidatePaths: [], riskFlags: ['GPS_GEO'],
    knownCapabilities: ['route-geometry'], knownGoodCapabilities: [], capabilityAssessmentComplete: true,
    structuralUncertainty: false, taskClass: 'BOUNDED', orchestrationMode: 'S1',
    executionIntent: 'READ_ONLY_SPECIALIST', signals: [] }, fixture.registry);
  assert.equal(routed.selectionReceipt.decision, ROUTER_SELECTION_DECISIONS.ROUTER_SELECTED);
  fixture.map = integrateRouterOutput(fixture.map, routed, { registry: fixture.registry });
  const agentId = routed.selectionReceipt.profileIds[0];
  const prepared = preparePacketizedSpecialist({ selection: { source: 'ROUTER_SELECTED', decided: true, agentId,
    objective: fixture.packet.objective, repositories: fixture.packet.repositories,
    routerReceipt: routed.selectionReceipt }, contextMap: fixture.map, registry: fixture.registry,
    repositoryDefinitions: fixture.repositories });
  assert.equal(prepared.status, 'READY');
  assert.equal(prepared.selectionAuthority.source, 'ROUTER_SELECTED');
  const routedFixture = { ...fixture, packet: prepared.packet };
  const consumed = await consumePacketizedSpecialist({ dispatch: { ...operationalDispatch(routedFixture),
    selectionSource: 'ROUTER_SELECTED', routerReceipt: routed.selectionReceipt },
    completion: validHandoffDraft(prepared.packet), ...options(routedFixture) });
  assert.equal(consumed.status, 'VALID');

  const critical = routeTask({ ...routed.taskFingerprint.facts, schemaVersion: 1,
    operation: 'REVIEW_ROUTE_GEOMETRY', taskClass: 'CRITICAL_RUNTIME', signals: [] }, fixture.registry);
  assert.equal(critical.selectionReceipt.decision, ROUTER_SELECTION_DECISIONS.BEHAVIORAL_FALLBACK);
  const rejected = preparePacketizedSpecialist({ selection: { source: 'ROUTER_SELECTED', decided: true, agentId,
    objective: fixture.packet.objective, repositories: fixture.packet.repositories,
    routerReceipt: critical.selectionReceipt }, contextMap: fixture.map, registry: fixture.registry,
    repositoryDefinitions: fixture.repositories });
  assert.equal(rejected.status, 'NOT_SELECTED');

  const replay = routeTask({ ...routed.taskFingerprint.facts, schemaVersion: 1, goalId: 'other-goal',
    operation: 'REVIEW_ROUTE_GEOMETRY', signals: [] }, fixture.registry);
  const replayed = preparePacketizedSpecialist({ selection: { source: 'ROUTER_SELECTED', decided: true, agentId,
    objective: fixture.packet.objective, repositories: fixture.packet.repositories,
    routerReceipt: replay.selectionReceipt }, contextMap: fixture.map, registry: fixture.registry,
    repositoryDefinitions: fixture.repositories });
  assert.equal(replayed.status, 'NOT_SELECTED');
});

test('SH9 native-role profile keeps the packetized dispatch and model policy', () => {
  const fixture = createHandoffFixture('wayper_auth_security_reviewer', {
    capability: 'firebase-auth',
    risks: ['AUTH_SECURITY'],
    evidence: { path: 'src/services/auth/authService.js', range: 'L1-L18',
      claim: 'Firebase Auth operations are owned by the mobile auth service' },
    priorClaim: 'Prior analysis identified the mobile auth service as the Firebase Auth owner',
    proofGap: { claim: 'Runtime authentication behavior remains unobserved',
      reason: 'No device auth observation is in scope', requiredEvidence: 'A runtime authentication observation' },
    objective: 'Review the Firebase Auth trust boundary',
  });
  const prepared = preparePacketizedSpecialist({ selection: selection(fixture), contextMap: fixture.map,
    registry: fixture.registry, repositoryDefinitions: fixture.repositories });
  assert.equal(prepared.status, 'READY');
  assert.equal(prepared.executionMode, PACKETIZED_SPECIALIST_MODE);
  assert.equal(prepared.runtime.agentType, 'explorer');
  assert.equal(prepared.runtime.model, 'gpt-5.6-sol');
  assert.equal(prepared.runtime.reasoningEffort, 'high');
  assert.deepEqual(prepared.packet.capabilities.required, ['firebase-auth']);
});
