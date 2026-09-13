import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { proveFixture, observedGate } from './evidence-fixture.mjs';

import {
  ROOT,
  contextDecision,
  evaluateBenchmarks,
  fingerprintArtifact,
  parseWorkingContext,
  proveWorkingContext,
  refreshWorkingContext,
  startWorkingContext,
  renderWorkingContext,
} from '../wayper-context.mjs';
import {
  finalizeContextMap,
  integrateRouterOutput,
  recordContextEntry,
  refreshContextMap,
  sourceFingerprint,
  validateContextMap,
} from '../wayper-context-map.mjs';
import { evaluateContextMapCases } from './evaluate-context-map-cases.mjs';
import { routeTask } from '../wayper-agent-router.mjs';
import { loadCapabilityFiles } from './check-capability-routing.mjs';
import { writeVerifiedGraphFixture } from './verified-graph-fixture.mjs';
import { createGoalExecution, goalReference } from '../wayper-context-identity.mjs';

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-context-'));
  fs.writeFileSync(path.join(root, '.gitignore'), '.wayper-context/\n');
  fs.writeFileSync(path.join(root, 'a.md'), 'stable owner\nunrelated tail\n');
  fs.writeFileSync(path.join(root, 'b.md'), 'mutable dependency\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Wayper', '-c', 'user.email=wayper@example.test', 'commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

function gitFixture(name = 'wayper') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-context-map-`));
  fs.writeFileSync(path.join(root, 'owner.js'), 'export const owner = true;\n');
  fs.writeFileSync(path.join(root, 'owner.test.js'), 'owner is covered\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'graphify-out/\n.wayper-context/\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Wayper', '-c', 'user.email=wayper@example.test',
    'commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

function graphFixture(root, repository = 'wayper') {
  const graph = { nodes: [{ id: 'owner' }, { id: 'owner_test' }],
    edges: [{ source: 'owner', target: 'owner_test', relation: 'tests' }] };
  return writeVerifiedGraphFixture(root, repository, graph);
}

const repo = (id, root) => ({ id, root, logicalRoot: id === 'wayper' ? '.' : '../wayper-site' });
const mapOptions = (threadId, repositories, extra = {}) => {
  const execution = createGoalExecution({ threadId, repositories });
  return { execution, goalId: goalReference(execution.identity), taskClass: 'ARCHITECTURAL', tokenCeiling: 16_000, repositories,
    risks: ['BUILD_TOOLING'], validations: ['quality:context'], workingArtifacts: [], ...extra };
};
const workingFixture = (options) => options.existing
  ? refreshWorkingContext({ ...options, identity: options.existing.execution.identity })
  : startWorkingContext({ ...options, threadId: options.goalId, objective: options.goalId });

test('CE1 Working Context round-trips and stops only after proof', () => {
  const root = fixtureRoot();
  let state = workingFixture({
    root,
    goalId: 'goal-1',
    taskClass: 'BOUNDED',
    specs: ['a.md#L1-L1', 'b.md'],
    requirements: ['SUCCESS:owner-proven'],
    riskFlags: ['BUILD_TOOLING'],
    invariants: ['MASTER_ONLY'],
    validations: ['context-efficiency'],
  });

  assert.deepEqual(state.artifacts.map((item) => item.status), ['READ_REQUIRED', 'READ_REQUIRED']);
  assert.deepEqual(state.riskFlags, ['BUILD_TOOLING']);
  assert.equal(state.contextDecision, 'CONTINUE_CONTEXT');
  state = workingFixture({
    root,
    existing: state,
    goalId: 'goal-1',
    taskClass: 'BOUNDED',
    specs: ['a.md#L1-L1', 'b.md'],
  });
  assert.deepEqual(state.artifacts.map((item) => item.status), ['REUSE_BEFORE_READ', 'REUSE_BEFORE_READ']);
  assert.throws(() => proveWorkingContext(state, { artifact: 'a.md#L1-L1', evidence: 'trust me' }),
    /Evidence Receipt/);
  state = proveFixture(state, { artifact: 'a.md#L1-L1' }, { root });
  state = proveFixture(state, { artifact: 'b.md' }, { root });
  state = proveFixture(state, { requirement: 'SUCCESS:owner-proven' }, { root });
  assert.equal(state.contextDecision, 'STOP_WHEN_PROVEN');
  assert.throws(
    () => proveWorkingContext(state, { artifact: 'b.md', requirement: 'SUCCESS:owner-proven', evidence: 'x' }),
    /exactly one/
  );

  const restored = parseWorkingContext(renderWorkingContext(state));
  assert.deepEqual(restored, state);
});

test('CE2 fingerprints invalidate only changed context and preserve unchanged ranges', () => {
  const root = fixtureRoot();
  let state = workingFixture({
    root,
    goalId: 'goal-2',
    taskClass: 'INVESTIGATION',
    specs: ['a.md#L1-L1', 'b.md'],
    requirements: ['RISK:covered'],
  });
  state = proveFixture(state, { artifact: 'a.md#L1-L1' }, { root });
  state = proveFixture(state, { artifact: 'b.md' }, { root });

  fs.writeFileSync(path.join(root, 'a.md'), 'stable owner\nchanged outside tracked range\n');
  fs.writeFileSync(path.join(root, 'b.md'), 'changed dependency\n');
  state = workingFixture({
    root,
    existing: state,
    goalId: 'goal-2',
    taskClass: 'INVESTIGATION',
    specs: ['a.md#L1-L1', 'b.md'],
  });

  assert.equal(state.artifacts.find((item) => item.spec === 'a.md#L1-L1').status, 'KNOWN_GOOD_UNCHANGED');
  const changed = state.artifacts.find((item) => item.spec === 'b.md');
  assert.equal(changed.status, 'DIFF_BEFORE_FILE');
  assert.deepEqual(changed.evidence, []);
  assert.match(changed.invalidatedEvidence[0], /^ER-[a-f0-9]{64}$/);

  state = workingFixture({
    root,
    existing: state,
    goalId: 'goal-2',
    taskClass: 'INVESTIGATION',
    specs: ['b.md'],
  });
  assert.equal(state.artifacts.find((item) => item.spec === 'b.md').status, 'DIFF_BEFORE_FILE');
});

test('CE3 artifact paths and ranges cannot escape or overrun the repository', () => {
  const root = fixtureRoot();
  assert.throws(() => fingerprintArtifact(root, '../outside.md'), /escapes repository/);
  assert.throws(() => fingerprintArtifact(root, 'a.md#L1-L99'), /range exceeds/);
  assert.throws(() => sourceFingerprint(root, 'a.md', 'L1-L99'), /range exceeds/);
  const site = fixtureRoot();
  let state = workingFixture({ root, repositories: [repo('wayper', root), repo('wayper-site', site)],
    goalId: 'cross-repo-working-context', taskClass: 'BOUNDED', specs: ['wayper-site:a.md#L1-L1'],
    requirements: ['SUCCESS:site'] });
  assert.equal(state.artifacts[0].repository, 'wayper-site');
  assert.equal(state.artifacts[0].spec, 'wayper-site:a.md#L1-L1');
  state = proveFixture(state, { artifact: 'wayper-site:a.md#L1-L1' }, { root, repositories: [repo('wayper', root), repo('wayper-site', site)] });
  assert.equal(state.artifacts[0].status, 'PROVEN');
});

test('CE4 benchmarks reduce context without dropping declared quality', () => {
  const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/ai/context-efficiency-evals.json'), 'utf8'));
  const results = evaluateBenchmarks(suite, ROOT);
  assert.equal(results.length, 3);
  for (const result of results) {
    assert.equal(result.pass, true, `${result.id}: ${JSON.stringify(result.checks)}`);
    assert.ok(result.reduction > 0, result.id);
  }
});

test('CM1 map stays Goal-scoped inside Working Context with deterministic repository state', () => {
  const root = gitFixture();
  const repositories = [repo('wayper', root)];
  const state = workingFixture({ root, goalId: 'map-goal-1', taskClass: 'ARCHITECTURAL',
    specs: ['owner.js'], requirements: ['SUCCESS:map'] });
  const options = mapOptions('map-goal-1', repositories, { execution: state.execution, goalId: state.goalId });
  const map = refreshContextMap(null, options);
  const restored = parseWorkingContext(renderWorkingContext({ ...state, contextMap: map }));

  assert.equal(restored.contextMap.schemaVersion, 2);
  assert.deepEqual(restored.contextMap.repositories, ['wayper']);
  assert.match(restored.contextMap.repositoryState.wayper.dirtyFingerprint, /^sha256:/);
  assert.equal(validateContextMap(map, { repositoryDefinitions: repositories }).status, 'VALID');
  assert.equal(JSON.stringify(refreshContextMap(map, options)), JSON.stringify(map));
});

test('CM2 evidence deduplicates normalized claims and becomes STALE after source change', () => {
  const root = gitFixture();
  const repositories = [repo('wayper', root)];
  const options = mapOptions('map-goal-2', repositories);
  let map = refreshContextMap(null, options);
  const entry = { repository: 'wayper', path: 'owner.js', range: 'L1-L1', category: 'OWNER',
    claim: 'Owner is stable.', provenance: 'SOURCE', status: 'PROVEN' };
  map = recordContextEntry(map, 'evidence', entry, repositories, options);
  map = recordContextEntry(map, 'evidence', { ...entry, category: 'owner', claim: 'owner is stable!' }, repositories, options);
  assert.equal(map.evidence.length, 1);
  const evidenceId = map.evidence[0].id;
  map = recordContextEntry(map, 'dependency', { from: { repository: 'wayper', ref: 'owner.test.js' },
    to: { repository: 'wayper', ref: 'owner.js' }, relation: 'TESTS', provenance: 'TEST',
    evidenceIds: [evidenceId] }, repositories, options);
  map = recordContextEntry(map, 'proof-gap', { claim: 'Owner contract proven', reason: 'Source evidence required',
    requiredEvidence: 'Current owner source', status: 'RESOLVED', evidenceIds: [evidenceId] }, repositories, options);
  map = recordContextEntry(map, 'known-good', { repository: 'wayper', artifact: 'owner.js',
    proofRefs: [evidenceId] }, repositories, options);
  const duplicated = structuredClone(map);
  duplicated.evidence.push(structuredClone(duplicated.evidence[0]));
  assert.match(validateContextMap(duplicated, { repositoryDefinitions: repositories }).errors.join(), /duplicate evidence/);

  fs.writeFileSync(path.join(root, 'owner.js'), 'export const owner = false;\n');
  assert.match(validateContextMap(map, { repositoryDefinitions: repositories }).errors.join(), /stale evidence/);
  map = refreshContextMap(map, options);
  assert.equal(map.evidence[0].status, 'STALE');
  assert.equal(map.evidence[0].invalidationReason, 'SOURCE_HASH_CHANGED');
  assert.equal(map.dependencies.length, 0);
  assert.equal(map.proofGaps[0].status, 'OPEN');
  assert.equal(map.knownGood[0].status, 'STALE');
  assert.equal(validateContextMap(map, { repositoryDefinitions: repositories }).status, 'VALID');
  map = recordContextEntry(map, 'evidence', entry, repositories, options);
  assert.equal(map.evidence.length, 1);
  assert.equal(map.evidence[0].status, 'PROVEN');
});

test('CM2b STOP_WHEN_PROVEN remains evidence-gated by the Context Map', () => {
  const root = gitFixture();
  const repositories = [repo('wayper', root)];
  const options = mapOptions('map-stop', repositories, { validations: ['quality:context'] });
  let state = workingFixture({ root, goalId: 'map-stop', taskClass: 'ARCHITECTURAL',
    specs: ['owner.js'], requirements: ['SUCCESS:map'], riskFlags: ['BUILD_TOOLING'],
    invariants: ['ONE_WRITER'], validations: ['quality:context'] });
  options.execution = state.execution; options.goalId = state.goalId;
  state = proveFixture(state, { artifact: 'owner.js' }, { root });
  state = proveFixture(state, { requirement: 'SUCCESS:map' }, { root });
  let map = refreshContextMap(null, options);
  map = recordContextEntry(map, 'evidence', { repository: 'wayper', path: 'owner.js', claim: 'Owner is current',
    provenance: 'SOURCE', status: 'PROVEN' }, repositories, options);
  map = recordContextEntry(map, 'proof-gap', { claim: 'Gate result required', reason: 'Validation not recorded',
    requiredEvidence: 'quality:context PASS' }, repositories, options);
  state.contextMap = map;
  assert.equal(contextDecision(state, { root }), 'CONTINUE_CONTEXT');
  map = recordContextEntry(map, 'validation', { id: 'quality:context', status: 'PASS',
    evidence: observedGate({ root, repositories, execution: state.execution }, 'quality:context').receiptId }, repositories, options);
  map = recordContextEntry(map, 'proof-gap', { claim: 'Gate result required', reason: 'Validation not recorded',
    requiredEvidence: 'quality:context PASS', status: 'RESOLVED', evidenceIds: ['quality:context'],
    receiptIds: [map.validation.checks.find((item) => item.id === 'quality:context').evidence],
    receiptRequirement: { kinds: ['QUALITY_GATE'], repository: 'wayper', target: 'quality:context', result: 'PASS' } }, repositories, options);
  state.contextMap = map;
  assert.equal(contextDecision(state, { root }), 'CONTINUE_CONTEXT');
  map = recordContextEntry(map, 'validation', { id: 'risk:BUILD_TOOLING', status: 'PASS',
    evidence: observedGate({ root, repositories, execution: state.execution }, 'risk:BUILD_TOOLING').receiptId }, repositories, options);
  map = recordContextEntry(map, 'validation', { id: 'invariant:ONE_WRITER', status: 'PASS',
    evidence: observedGate({ root, repositories, execution: state.execution }, 'invariant:ONE_WRITER').receiptId }, repositories, options);
  state.contextMap = map;
  assert.equal(contextDecision(state, { root }), 'STOP_WHEN_PROVEN');
  const graphRequired = structuredClone(state);
  graphRequired.contextMap.graphify.wayper.decision = 'REQUIRED_BY_STRUCTURAL_UNCERTAINTY';
  graphRequired.contextMap.graphify.wayper.status = 'NOT_USED';
  assert.equal(contextDecision(graphRequired, { root }), 'CONTINUE_CONTEXT');
  map = recordContextEntry(map, 'validation', { id: 'quality:context', status: 'FAIL',
    evidence: 'quality:context FAIL' }, repositories, options);
  state.contextMap = map;
  assert.equal(map.proofGaps[0].status, 'OPEN');
  assert.equal(contextDecision(state, { root }), 'CONTINUE_CONTEXT');
  map = recordContextEntry(map, 'validation', { id: 'quality:context', status: 'PASS',
    evidence: observedGate({ root, repositories, execution: state.execution }, 'quality:context').receiptId }, repositories, options);
  map = recordContextEntry(map, 'proof-gap', { claim: 'Gate result required', reason: 'Validation not recorded',
    requiredEvidence: 'quality:context PASS', status: 'RESOLVED', evidenceIds: ['quality:context'],
    receiptIds: [map.validation.checks.find((item) => item.id === 'quality:context').evidence],
    receiptRequirement: { kinds: ['QUALITY_GATE'], repository: 'wayper', target: 'quality:context', result: 'PASS' } }, repositories, options);
  fs.writeFileSync(path.join(root, 'owner.js'), 'export const owner = false;\n');
  state.contextMap = refreshContextMap(map, options);
  assert.equal(contextDecision(state, { root }), 'CONTINUE_CONTEXT');
});

test('CM2c a source shortened past an evidence range invalidates instead of aborting refresh', () => {
  const root = gitFixture();
  fs.writeFileSync(path.join(root, 'range.js'), 'first\nsecond');
  const repositories = [repo('wayper', root)];
  const options = mapOptions('map-range-shortened', repositories);
  let map = refreshContextMap(null, options);
  map = recordContextEntry(map, 'evidence', { repository: 'wayper', path: 'range.js', range: 'L2-L2',
    claim: 'Second line owns behavior', provenance: 'SOURCE', status: 'PROVEN' }, repositories, options);
  fs.writeFileSync(path.join(root, 'range.js'), 'first');
  map = refreshContextMap(map, options);
  assert.equal(map.evidence[0].status, 'STALE');
  assert.equal(map.evidence[0].invalidationReason, 'RANGE_INVALIDATED');
  assert.equal(validateContextMap(map, { repositoryDefinitions: repositories }).status, 'VALID');
});

test('CM3 router receipts stay capability-valid and Graphify remains repository-scoped', () => {
  const mobile = gitFixture('wayper');
  const site = gitFixture('wayper-site');
  const repositories = [repo('wayper', mobile), repo('wayper-site', site)];
  const { registry } = loadCapabilityFiles();
  const options = mapOptions('map-goal-3', repositories, { registry });
  let map = refreshContextMap(null, options);
  const output = routeTask({ schemaVersion: 1, goalId: options.goalId, operation: 'CONTEXT_MAP',
    repositories: ['wayper', 'wayper-site'], changedFiles: [], candidatePaths: [],
    riskFlags: ['BUILD_TOOLING'], knownCapabilities: ['context-efficiency'],
    knownGoodCapabilities: [], capabilityAssessmentComplete: true, structuralUncertainty: false,
    signals: [] }, registry);
  map = integrateRouterOutput(map, output, options);
  assert.equal(map.router.mode, 'SELECTIVE');
  assert.equal(map.router.selectionReceipt.decision, 'BEHAVIORAL_FALLBACK');
  assert.equal(map.router.graphifyDecision, 'TARGETED_RECOMMENDED');

  assert.throws(() => recordContextEntry(map, 'graphify', { repository: 'wayper', version: 'fake',
    scopeFingerprint: sourceFingerprint(mobile, 'owner.js').hash,
    graphFingerprint: sourceFingerprint(mobile, 'owner.js').hash, purpose: 'Fake owner',
    nodeRefs: ['wayper:fake'], edgeRefs: [] }, repositories, options), /Missing repository file/);
  const graph = graphFixture(mobile);
  map = recordContextEntry(map, 'graphify', { repository: 'wayper', version: graph.graphifyVersion,
    scopeFingerprint: graph.sourceFingerprint, graphFingerprint: graph.graphSha256, purpose: 'Locate owner',
    nodeRefs: ['wayper:owner'], edgeRefs: ['wayper:owner->owner_test'] }, repositories, options);
  assert.equal(map.graphify.wayper.status, 'CURRENT');
  const validation = validateContextMap(map, { repositoryDefinitions: repositories, registry });
  assert.equal(validation.status, 'VALID', validation.errors.join('; '));
  const changedRegistry = structuredClone(registry);
  changedRegistry.agentProfiles[0].reviewProbe = 'changed';
  assert.match(validateContextMap(map, { repositoryDefinitions: repositories, registry: changedRegistry })
    .errors.join(), /stale capability registry fingerprint/);
  const registryInvalidated = refreshContextMap(map, { ...options, registry: changedRegistry });
  assert.equal(registryInvalidated.router, null);
  assert.throws(() => recordContextEntry(map, 'graphify', { repository: 'wayper', version: graph.graphifyVersion,
    scopeFingerprint: graph.sourceFingerprint, graphFingerprint: graph.graphSha256, purpose: 'Fake node',
    nodeRefs: ['wayper:fake'], edgeRefs: [] }, repositories, options), /Invalid Graphify/);
  map = recordContextEntry(map, 'graphify', { repository: 'wayper', version: graph.graphifyVersion,
    scopeFingerprint: graph.sourceFingerprint, graphFingerprint: graph.graphSha256, purpose: 'Explain owner tests',
    nodeRefs: ['wayper:owner_test'], edgeRefs: [] }, repositories, options);
  assert.deepEqual(map.graphify.wayper.queries.map((item) => item.queryFingerprint),
    [...map.graphify.wayper.queries.map((item) => item.queryFingerprint)].sort());
  const mixed = structuredClone(map);
  mixed.graphify.wayper.queries[0].edgeRefs = ['wayper-site:foreign->node'];
  assert.match(validateContextMap(mixed, { repositoryDefinitions: repositories, registry }).errors.join(), /mixed Graphify/);
  fs.writeFileSync(path.join(mobile, 'owner.js'), 'export const owner = false;\n');
  assert.match(validateContextMap(map, { repositoryDefinitions: repositories, registry }).errors.join(), /Graphify|repository state/);
  map = refreshContextMap(map, options);
  assert.equal(map.graphify.wayper.status, 'STALE');
});

test('CM4 dependency refs, known-good reuse and explicit questioning fail closed', () => {
  const root = gitFixture();
  const repositories = [repo('wayper', root)];
  const fingerprint = sourceFingerprint(root, 'owner.js', 'L1-L1').hash;
  const artifact = { spec: 'owner.js#L1-L1', status: 'KNOWN_GOOD_UNCHANGED', fingerprint,
    evidence: ['owner.js:1'] };
  const options = mapOptions('map-goal-4', repositories, { workingArtifacts: [artifact] });
  let map = refreshContextMap(null, options);
  map = recordContextEntry(map, 'evidence', { repository: 'wayper', path: 'owner.js',
    claim: 'Owner exports the contract', provenance: 'SOURCE', status: 'PROVEN' }, repositories, options);
  map = recordContextEntry(map, 'dependency', { from: { repository: 'wayper', ref: 'owner.test.js' },
    to: { repository: 'wayper', ref: 'owner.js#owner' }, relation: 'TESTS', provenance: 'TEST',
    evidenceIds: [map.evidence[0].id] }, repositories, options);
  assert.equal(map.knownGood[0].status, 'KNOWN_GOOD_UNCHANGED');
  const invalid = structuredClone(map);
  invalid.dependencies[0].evidenceIds = ['E-missing'];
  assert.match(validateContextMap(invalid, { repositoryDefinitions: repositories }).errors.join(), /dependency refs/);
  assert.throws(() => recordContextEntry(map, 'dependency', {
    from: { repository: 'wayper', ref: 'ghost.js' }, to: { repository: 'wayper', ref: 'missing.js' },
    relation: 'CALLS', provenance: 'SOURCE', evidenceIds: [map.evidence[0].id],
  }, repositories, options), /Missing repository file/);
  assert.throws(() => recordContextEntry(map, 'dependency', {
    from: { repository: 'wayper', ref: 'owner.test.js' }, to: { repository: 'wayper', ref: 'owner.js' },
    relation: 'TESTS', provenance: 'TEST', evidenceIds: [],
  }, repositories, options), /reusable evidence/);
  assert.throws(() => recordContextEntry(map, 'dependency', {
    from: { repository: 'wayper', ref: 'owner.test.js' }, to: { repository: 'wayper', ref: '.gitignore' },
    relation: 'TESTS', provenance: 'TEST', evidenceIds: [map.evidence[0].id],
  }, repositories, options), /unrelated/);

  map = refreshContextMap(map, { ...options, questions: ['owner.js#L1-L1'] });
  assert.equal(map.knownGood[0].status, 'QUESTIONED');
  assert.equal(map.knownGood[0].invalidationReason, 'EXPLICITLY_QUESTIONED');
  map = refreshContextMap(map, options);
  assert.equal(map.knownGood[0].status, 'QUESTIONED');
  fs.renameSync(path.join(root, 'owner.js'), path.join(root, 'owner.gone.js'));
  map = refreshContextMap(map, options);
  assert.equal(map.knownGood[0].status, 'STALE');
  assert.equal(map.knownGood[0].invalidationReason, 'SOURCE_MISSING');
  fs.writeFileSync(path.join(root, 'owner.js'), 'export const owner = false;\n');
  const freshProof = { spec: 'owner.js#L1-L1', status: 'PROVEN',
    fingerprint: sourceFingerprint(root, 'owner.js', 'L1-L1').hash, evidence: ['owner.js:1'] };
  map = refreshContextMap(map, { ...options, workingArtifacts: [freshProof] });
  assert.equal(map.knownGood.length, 0);
});

test('CM4b Working Context known-good entries keep their repository boundary', () => {
  const mobile = gitFixture('wayper');
  const site = gitFixture('wayper-site');
  const repositories = [repo('wayper', mobile), repo('wayper-site', site)];
  const artifact = { repository: 'wayper-site', spec: 'owner.js', status: 'KNOWN_GOOD_UNCHANGED',
    fingerprint: sourceFingerprint(site, 'owner.js').hash, evidence: ['owner.js:1'] };
  const options = mapOptions('map-cross-known-good', repositories, { workingArtifacts: [artifact] });
  const map = refreshContextMap(null, options);
  assert.equal(map.knownGood[0].repository, 'wayper-site');
  assert.equal(map.repositoryState['wayper-site'].relevantRefs.includes('owner.js'), true);
  assert.equal(map.repositoryState.wayper.relevantRefs.includes('owner.js'), false);
});

test('CM4c capability known-good is fingerprinted against Registry V2', () => {
  const root = gitFixture();
  const repositories = [repo('wayper', root)];
  const { registry } = loadCapabilityFiles();
  const options = mapOptions('map-capability-known-good', repositories, { registry });
  let map = refreshContextMap(null, options);
  map = recordContextEntry(map, 'evidence', { repository: 'wayper', path: 'owner.js',
    claim: 'Context capability owner is current', provenance: 'SOURCE', status: 'PROVEN' }, repositories, options);
  map = recordContextEntry(map, 'validation', { id: 'quality:capabilities', status: 'PASS',
    evidence: 'quality:capabilities PASS' }, repositories, options);
  map = recordContextEntry(map, 'known-good', { repository: 'wayper', capability: 'context-efficiency',
    proofRefs: ['quality:capabilities'] }, repositories, { ...options, registry });
  assert.equal(validateContextMap(map, { repositoryDefinitions: repositories, registry }).status, 'VALID');
  map = refreshContextMap(map, { ...options, registry });
  assert.equal(map.knownGood[0].status, 'KNOWN_GOOD_UNCHANGED');
  const changedRegistry = structuredClone(registry);
  changedRegistry.capabilities.find((item) => item.id === 'context-efficiency').reviewProbe = 'changed';
  const changed = refreshContextMap(map, { ...options, registry: changedRegistry });
  assert.equal(changed.knownGood[0].status, 'STALE');
  assert.equal(changed.knownGood[0].invalidationReason, 'CAPABILITY_CHANGED');
  assert.equal(validateContextMap(changed,
    { repositoryDefinitions: repositories, registry: changedRegistry }).status, 'VALID');
  const missingRegistry = structuredClone(registry);
  missingRegistry.capabilities = missingRegistry.capabilities.filter((item) => item.id !== 'context-efficiency');
  const missing = refreshContextMap(map, { ...options, registry: missingRegistry });
  assert.equal(missing.knownGood[0].invalidationReason, 'CAPABILITY_MISSING');
  assert.throws(() => recordContextEntry(map, 'known-good', { repository: 'wayper', capability: 'missing-capability',
    proofRefs: ['quality:capabilities'] }, repositories, { ...options, registry }), /Invalid known-good capability/);
});

test('CM5 proof gaps, compactness guard and explicit OVER_BUDGET reason are enforced', () => {
  const root = gitFixture();
  const repositories = [repo('wayper', root)];
  const tiny = mapOptions('map-goal-5', repositories, { tokenCeiling: 1 });
  let map = refreshContextMap(null, tiny);
  map = recordContextEntry(map, 'proof-gap', { claim: 'Physical runtime remains unobserved',
    reason: 'No device evidence in this Goal', requiredEvidence: 'Observed physical run' }, repositories, tiny);
  assert.equal(map.proofGaps.length, 1);
  assert.match(validateContextMap(map, { repositoryDefinitions: repositories }).errors.join(), /OVER_BUDGET/);
  map = finalizeContextMap(map, { tokenCeiling: 1, budgetReason: 'Required evidence exceeds tiny fixture budget' });
  assert.equal(validateContextMap(map, { repositoryDefinitions: repositories }).status, 'VALID');
  const bloated = structuredClone(map);
  bloated.sourceBlob = 'x'.repeat(600);
  assert.match(validateContextMap(bloated, { repositoryDefinitions: repositories }).errors.join(), /prohibited/);
  const smuggled = structuredClone(map);
  smuggled.notes = Array.from({ length: 5_000 }, () => 'x');
  assert.match(validateContextMap(smuggled, { repositoryDefinitions: repositories }).errors.join(), /unknown Context Map field/);
  const structuralBloat = structuredClone(map);
  structuralBloat.learningDelta[0].added = Array.from({ length: 5_000 }, (_, index) => `E-${index}`);
  const justifiedBloat = finalizeContextMap(structuralBloat,
    { tokenCeiling: 1, budgetReason: 'Arbitrary reason cannot bypass structural limits' });
  assert.match(validateContextMap(justifiedBloat, { repositoryDefinitions: repositories }).errors.join(),
    /too many learning delta refs/);
  const riskBloat = structuredClone(map);
  riskBloat.risks = Array.from({ length: 5_000 }, (_, index) => `RISK_${index}`);
  const justifiedRiskBloat = finalizeContextMap(riskBloat,
    { tokenCeiling: 1, budgetReason: 'Arbitrary reason cannot bypass risk caps' });
  assert.match(validateContextMap(justifiedRiskBloat, { repositoryDefinitions: repositories }).errors.join(),
    /too many risks/);
});

test('CM5b the CLI rejects a competing Working Context state path', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/wayper-context.mjs'), 'refresh',
    '--state', 'alternate.md', '--goal-id', 'map-goal-cli', '--class', 'BOUNDED'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--state is unsupported/);
  assert.equal(fs.existsSync(path.join(ROOT, 'alternate.md')), false);
});

test('CM5c the canonical CLI fingerprints a repository-qualified site artifact', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/wayper-context.mjs'), 'start',
    '--thread-id', `map-cross-cli-${process.pid}`, '--objective', 'Cross repo CLI', '--class', 'BOUNDED', '--repository', 'wayper=.',
    '--repository', 'wayper-site=../wayper-site', '--track', 'wayper-site:package.json'], { encoding: 'utf8' });
  const goalRunId = result.stdout.match(/GOAL_RUN_ID (\S+)/)?.[1];
  const stateFile = path.join(ROOT, '.wayper-context', `${goalRunId}.md`);
  try {
    assert.equal(result.status, 0, result.stderr);
    const state = parseWorkingContext(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(state.artifacts[0].repository, 'wayper-site');
    assert.equal(state.artifacts[0].path, 'package.json');
  } finally {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  }
});

test('CM6 all 15 Context Map evals are represented and drastically smaller than materialized source', () => {
  const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/ai/context-efficiency-evals.json'), 'utf8'));
  const results = evaluateContextMapCases(suite, ROOT);
  assert.equal(results.length, 15);
  assert.equal(new Set(suite.contextMapCases.flatMap((item) => item.features)).has('EVIDENCE_STALENESS'), true);
  assert.equal(new Set(suite.contextMapCases.flatMap((item) => item.features)).has('KNOWN_GOOD_QUESTIONED'), true);
  for (const result of results) {
    assert.equal(result.pass, true, `${result.id}: ${JSON.stringify(result.assertions)}`);
    assert.ok(result.reduction >= 0.5, result.id);
  }
});
