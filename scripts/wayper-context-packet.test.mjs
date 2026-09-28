import assert from 'node:assert/strict';
import test from 'node:test';
import { createGoalExecution, goalReference } from './wayper-context-identity.mjs';
import { ROOT } from './wayper-context.mjs';

import {
  aggregatePacketTelemetry,
  buildContextPacket,
  validateContextPacket,
} from './wayper-context-packet.mjs';
import { capabilityRegistryFingerprint } from './wayper-context-map.mjs';
import { loadCapabilityFiles } from './quality/check-capability-routing.mjs';

const fingerprint = `sha256:${'a'.repeat(64)}`;

function contextMap(registry = loadCapabilityFiles().registry) {
  const execution = createGoalExecution({ threadId: 'packet-unit', repositories: [{ id: 'wayper', root: ROOT }] });
  return {
    schemaVersion: 2, execution,
    goalId: goalReference(execution.identity),
    taskClass: 'BOUNDED',
    repositories: ['wayper', 'wayper-site'],
    registryFingerprint: capabilityRegistryFingerprint(registry),
    repositoryState: {
      wayper: { repository: 'wayper', relevantRefs: ['scripts/wayper-context-packet.mjs'] },
      'wayper-site': { repository: 'wayper-site', relevantRefs: [] },
    },
    capabilities: { required: ['quality-gates'], optional: [], knownGood: [] },
    risks: ['FALSE_TELEMETRY'],
    invariants: ['REFERENCE_BEFORE_CONTENT'],
    evidence: [
      { id: 'E-owner', repository: 'wayper', path: 'scripts/wayper-context-packet.mjs', sourceBytes: 1_000,
        status: 'PROVEN', category: 'OWNER', claim: 'Review handler calls the source owner', capabilityRefs: ['quality-gates'] },
      { id: 'E-review', repository: 'wayper', path: 'scripts/wayper-context-packet.test.mjs', sourceBytes: 500,
        status: 'PROVEN', category: 'AUDIT_RESULT', claim: 'Prior reviewer concluded the implementation is correct',
        reviewDisposition: 'PRIOR_ANALYSIS_CONCLUSION', capabilityRefs: ['quality-gates'] },
    ],
    dependencies: [],
    knownGood: [{ id: 'KG-wayper', repository: 'wayper', capability: 'quality-gates', status: 'KNOWN_GOOD_UNCHANGED' }],
    proofGaps: [
      { id: 'PG-raw', status: 'OPEN', evidenceIds: [], capabilityRefs: ['quality-gates'] },
      { id: 'PG-review', status: 'OPEN', evidenceIds: [], capabilityRefs: ['quality-gates'],
        reviewDisposition: 'PRIOR_ANALYSIS_CONCLUSION' },
    ],
    graphify: {
      wayper: { decision: 'NOT_NEEDED', status: 'NOT_USED', queries: [] },
      'wayper-site': { decision: 'NOT_NEEDED', status: 'NOT_USED', queries: [] },
    },
    validation: { structural: 'VALID', fingerprint, checks: [
      { id: 'raw-test', status: 'PASS', evidence: 'raw test PASS' },
      { id: 'prior-verdict', status: 'PASS', evidence: 'prior analysis PASS',
        reviewDisposition: 'PRIOR_ANALYSIS_CONCLUSION' },
    ] },
    ambiguities: [],
    learningDelta: [{ added: ['E-owner', 'E-review'], invalidated: [] }],
    metrics: { bytes: 2_000 },
  };
}

test('CP1 packet schema is closed, deterministic, reference-only and stale-aware', () => {
  const { registry } = loadCapabilityFiles();
  const map = contextMap();
  const target = { type: 'capabilitySet', id: 'quality-gates', capabilities: ['quality-gates'],
    repositories: ['wayper'], objective: 'Validate packet schema' };
  const packet = buildContextPacket(map, target, { registry });
  assert.deepEqual(packet, buildContextPacket(map, target, { registry }));
  assert.equal(validateContextPacket(packet, { contextMap: map, registry }).status, 'VALID');
  assert.equal(packet.metrics.inlineBytes, 0);
  assert.equal(packet.metrics.sourceBytesMaterialized, 0);

  const changedMap = structuredClone(map);
  changedMap.validation.fingerprint = `sha256:${'b'.repeat(64)}`;
  assert.ok(validateContextPacket(packet, { contextMap: changedMap, registry }).errors.includes('PACKET_STALE'));

  const leaked = structuredClone(packet);
  leaked.scope.paths.push('wayper-site:src/foreign.js');
  assert.ok(validateContextPacket(leaked, { contextMap: map, registry }).errors.includes('packet scope repository leakage'));

  const blob = structuredClone(packet);
  blob.sourceBlob = 'forbidden';
  assert.match(validateContextPacket(blob, { contextMap: map, registry }).errors.join(';'), /unknown packet field|prohibited/);

  const falseTelemetry = structuredClone(packet);
  falseTelemetry.metrics.duplicateRefsAvoided = 1;
  assert.ok(validateContextPacket(falseTelemetry, { contextMap: map, registry }).errors.includes('invalid packet metrics'));

  const falseBudget = structuredClone(packet);
  falseBudget.contextBudget.taskClass = 'TRIVIAL';
  assert.ok(validateContextPacket(falseBudget, { contextMap: map, registry }).errors.includes('invalid packet budget'));

  const unprovenMap = structuredClone(map);
  unprovenMap.evidence.forEach((item) => { item.status = 'UNVALIDATED'; });
  const unproven = buildContextPacket(unprovenMap, target, { registry });
  assert.deepEqual(unproven.evidenceRefs, []);
  assert.ok(unproven.ambiguities.includes('MISSING_REQUIRED_EVIDENCE:quality-gates'));

  const site = buildContextPacket(map, { ...target, id: 'site', repositories: ['wayper-site'] }, { registry });
  assert.deepEqual(site.knownGoodRefs, []);
  assert.throws(() => buildContextPacket(map, { ...target, paths: ['missing.js'] }, { registry }),
    /absent from Context Map/);
  assert.equal(validateContextPacket({ schemaVersion: 1 }, { contextMap: map, registry }).status, 'INVALID');

  const changedRegistry = structuredClone(registry);
  changedRegistry.capabilities[0].description = `${changedRegistry.capabilities[0].description} changed`;
  assert.throws(() => buildContextPacket(map, target, { registry: changedRegistry }), /current Registry V2/);
  assert.ok(validateContextPacket(packet, { contextMap: map, registry: changedRegistry }).errors.includes('REGISTRY_STALE'));
});

test('CP1b a cross-repository Goal preserves native scope and mobile profile isolation', () => {
  const { registry } = loadCapabilityFiles();
  const map = contextMap(registry);
  map.capabilities.required = ['screen-ui-accessibility'];
  map.evidence = map.repositories.map((repository) => ({ id: `E-${repository}`, repository,
    path: 'owner.js', sourceBytes: 100, status: 'PROVEN', category: 'OWNER',
    claim: `Accessibility owner in ${repository}`, capabilityRefs: ['screen-ui-accessibility'] }));
  const target = { repositories: map.repositories, capabilities: map.capabilities.required,
    objective: 'Inspect accessibility across repositories' };
  const native = buildContextPacket(map, { ...target, type: 'nativeRole', id: 'explorer' }, { registry });
  const mobile = buildContextPacket(map, { ...target, type: 'agentProfile',
    id: 'wayper_accessibility_reviewer' }, { registry });
  assert.deepEqual(native.repositories, ['wayper', 'wayper-site']);
  assert.deepEqual(native.evidenceRefs, ['E-wayper', 'E-wayper-site']);
  assert.deepEqual(native.scope.paths, ['wayper-site:owner.js', 'wayper:owner.js']);
  assert.deepEqual(mobile.repositories, ['wayper']);
  assert.deepEqual(mobile.evidenceRefs, ['E-wayper']);
  assert.deepEqual(mobile.scope.paths, ['wayper:owner.js']);
  for (const packet of [native, mobile]) {
    assert.equal(validateContextPacket(packet, { contextMap: map, registry }).status, 'VALID');
  }
});

test('CP2 independent review excludes conclusions while follow-up review may reference them', () => {
  const { registry } = loadCapabilityFiles();
  const map = contextMap();
  const independent = buildContextPacket(map, { type: 'validationRole', id: 'independent-review',
    capabilities: ['quality-gates'], repositories: ['wayper'], objective: 'Independent review' }, { registry });
  const followup = buildContextPacket(map, { type: 'validationRole', id: 'followup-review',
    capabilities: ['quality-gates'], repositories: ['wayper'], objective: 'Follow-up review' }, { registry });
  assert.deepEqual(independent.evidenceRefs, ['E-owner']);
  assert.ok(independent.exclusions.includes('PRIOR_REVIEW_CONCLUSIONS'));
  assert.deepEqual(independent.knownGoodRefs, []);
  assert.deepEqual(independent.proofGapRefs, ['PG-raw']);
  assert.deepEqual(independent.validationRefs, ['raw-test']);
  assert.ok(followup.evidenceRefs.includes('E-review'));
  assert.ok(followup.proofGapRefs.includes('PG-review'));
  assert.ok(followup.validationRefs.includes('prior-verdict'));

  const dependencyMap = structuredClone(map);
  dependencyMap.dependencies.push({ id: 'D-review', from: { repository: 'wayper',
    ref: 'scripts/wayper-context-packet.test.mjs' }, to: { repository: 'wayper',
    ref: 'scripts/wayper-context-packet.mjs' }, evidenceIds: ['E-review'] });
  const scoped = buildContextPacket(dependencyMap, { type: 'validationRole', id: 'independent-review',
    capabilities: ['quality-gates'], repositories: ['wayper'], paths: ['scripts/wayper-context-packet.test.mjs'],
    objective: 'Independent dependency review' }, { registry });
  assert.deepEqual(scoped.dependencyRefs, []);
  assert.ok(scoped.ambiguities.includes('DEPENDENCY_PROOF_EXCLUDED:D-review'));
  assert.equal(validateContextPacket(scoped, { contextMap: dependencyMap, registry }).status, 'VALID');
});

test('CP2b budget trimming removes optional context before requiring an explicit escalation reason', () => {
  const { registry } = loadCapabilityFiles();
  const map = contextMap(registry);
  map.capabilities.optional = ['context-efficiency'];
  for (let index = 0; index < 12; index += 1) map.evidence.push({ id: `E-optional-${index}`,
    repository: 'wayper', path: 'scripts/wayper-context-packet.mjs', sourceBytes: 1_000,
    status: 'PROVEN', category: 'OWNER', claim: `Optional context owner ${index}`,
    capabilityRefs: ['context-efficiency'] });
  const required = buildContextPacket(map, { type: 'capabilitySet', id: 'budget', capabilities: ['quality-gates'],
    repositories: ['wayper'], objective: 'Exercise optional trimming', tokenProxyCeiling: 10_000 }, { registry });
  const target = { type: 'capabilitySet', id: 'budget', capabilities: ['quality-gates', 'context-efficiency'],
    repositories: ['wayper'], objective: 'Exercise optional trimming',
    tokenProxyCeiling: required.metrics.packetTokenProxy + 30 };
  const packet = buildContextPacket(map, target, { registry });
  assert.deepEqual(packet.capabilities.optional, []);
  assert.ok(packet.ambiguities.includes('OPTIONAL_CONTEXT_OMITTED_FOR_BUDGET'));
  assert.throws(() => buildContextPacket(map, { ...target, tokenProxyCeiling: 1 }, { registry }),
    /BUDGET_ESCALATION_REASON/);
  const escalated = buildContextPacket(map, { ...target, tokenProxyCeiling: 1, budgetReason: 'Required review context' },
    { registry });
  assert.equal(escalated.contextBudget.status, 'OVER_BUDGET');
  assert.equal(escalated.contextBudget.reason, 'Required review context');
});

test('CP3 telemetry separates references from materialization and deduplicates shared evidence', () => {
  const { registry } = loadCapabilityFiles();
  const map = contextMap();
  const packets = ['one', 'two', 'three'].map((id) => buildContextPacket(map,
    { type: 'capabilitySet', id, capabilities: ['quality-gates'], repositories: ['wayper'], objective: id }, { registry }));
  const telemetry = aggregatePacketTelemetry(map, packets, { shadowLogBytes: 0,
    providerUsage: { status: 'PARTIAL', source: 'NATIVE_GOAL_TOOL', goalTokens: 123,
      sessionTokens: 'UNKNOWN', turnTokens: 'UNKNOWN', subagentTokens: 'UNKNOWN' } });
  assert.equal(telemetry.packetsBuilt, 3);
  assert.equal(telemetry.sourceBytesMaterialized, 0);
  assert.ok(telemetry.deduplication.repeatedRefs >= 2);
  assert.ok(telemetry.duplicatedBytesAvoided > 0);
  assert.equal(telemetry.fullFileReads, 'UNKNOWN');
});
