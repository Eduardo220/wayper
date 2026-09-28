import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { createGoalExecution, baselineFor } from '../wayper-context-identity.mjs';
import { runObservedCommand, runObservedTest, recordAssertion } from '../wayper-evidence-observer.mjs';
import { receiptPath, listReceipts } from '../wayper-evidence-store.mjs';

const planner = () => import('../wayper-validation-planner.mjs');
const policy = () => import('../wayper-validation-policy.mjs');
function fixture(t, cross = false) {
  const owner = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-validation-'));
  t.after(() => fs.rmSync(owner, { recursive: true, force: true }));
  const repositories = (cross ? ['wayper', 'wayper-site'] : ['wayper']).map((id) => {
    const root = path.join(owner, id); fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, '.gitignore'), '.wayper-context/\n');
    fs.writeFileSync(path.join(root, 'owner.js'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
    return { id, root, logicalRoot: id === 'wayper' ? '.' : '../wayper-site' };
  });
  return { root: repositories[0].root, repositories,
    execution: createGoalExecution({ threadId: 'phase3-tests', repositories }) };
}
function inputs(overrides = {}, repoOverrides = {}) {
  return { operation: 'FEATURE', taskClass: 'BOUNDED', repositories: [{ repository: 'wayper',
    platforms: ['shared'], changedPaths: ['owner.js'], capabilities: ['product-rules'], risks: [],
    testTargets: { L1: [], L2: [] }, ...repoOverrides }], criteria: [], ...overrides };
}
const levels = (plan) => [...new Set(plan.requirements.filter((r) => r.applicability.status === 'APPLICABLE').map((r) => r.level))].sort();
const criterion = (claim, platform = 'android', extra = {}) => ({ id: 'behavior', repository: 'wayper', platform,
  claim, required: true, blocking: true, ...extra });
async function build(f, input) { return (await planner()).buildValidationPlan({ ...f, inputs: input }); }
async function assess(f, plan, input, extra = {}) {
  return (await planner()).evaluateValidationPlan(plan, { ...f, inputs: input, ...extra });
}
async function passed(f, requirement, repository = 'wayper') {
  const check = requirement.candidateChecks.find((c) => c.type === 'COMMAND');
  return runObservedCommand({ mutability: 'READ_ONLY', ...f, repository, target: requirement.evidencePolicy.receiptRequirement.target,
    command: check.command, args: check.args });
}

test('VP1 trivial copy stays L0', async (t) => {
  const f = fixture(t); const plan = await build(f, inputs({ operation: 'TRIVIAL', taskClass: 'TRIVIAL' }, { capabilities: ['map-ui'], risks: ['UI_UX'] }));
  assert.deepEqual(levels(plan), ['L0']);
});
test('VP2 pure logic requires L0 and L1', async (t) => {
  const plan = await build(fixture(t), inputs()); assert.deepEqual(levels(plan), ['L0', 'L1']);
});
test('VP3 durable persistence requires L0 L1 L2', async (t) => {
  const plan = await build(fixture(t), inputs({}, { capabilities: ['durable-run-save'], risks: ['OFFLINE_STORAGE'] }));
  assert.deepEqual(levels(plan), ['L0', 'L1', 'L2']);
});
test('VP4 background GPS escalates with explicit real scenario', async (t) => {
  const input = inputs({ operation: 'CRITICAL_RUNTIME', taskClass: 'CRITICAL_RUNTIME', criteria: [criterion('REAL_SCENARIO')] },
    { platforms: ['android'], capabilities: ['live-gps-ingestion'], risks: ['GPS_GEO', 'LIFECYCLE', 'NATIVE_ANDROID'] });
  assert.deepEqual(levels(await build(fixture(t), input)), ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
});
test('VP5 changed Kotlin or Gradle requires Android L4', async (t) => {
  for (const file of ['android/app/RunService.kt', 'android/app/build.gradle']) {
    const plan = await build(fixture(t), inputs({}, { platforms: ['android'], changedPaths: [file], capabilities: ['test-build'] }));
    assert.ok(plan.requirements.some((r) => r.level === 'L4' && r.platform === 'android' && r.reason.some((reason) => reason.facts.includes(`path:${file}`))));
  }
});
test('VP6 observed unit test is insufficient for physical requirement', async (t) => {
  const f = fixture(t); const input = inputs({ criteria: [criterion('PHYSICAL_DEVICE')] }, { platforms: ['android'] });
  const plan = await build(f, input); const physical = plan.requirements.find((r) => r.level === 'L5');
  const { receipt } = await runObservedTest({ mutability: 'READ_ONLY', ...f, repository: 'wayper', target: physical.evidencePolicy.receiptRequirement.target,
    command: process.execPath, args: ['-e', "require('node:assert/strict').equal(1,1)"] });
  const result = await assess(f, plan, input, { receiptIds: [receipt.receiptId] });
  assert.notEqual(result.requirements.find((r) => r.validationRequirementId === physical.validationRequirementId).status, 'SATISFIED');
});
test('VP7 stale compatible receipt is not accepted', async (t) => {
  const f = fixture(t); const input = inputs({ operation: 'DOC_ONLY' }, { changedPaths: ['README.md'], capabilities: [] });
  const old = await build(f, input); const receipt = await passed(f, old.requirements[0]);
  fs.appendFileSync(path.join(f.root, 'README.md'), '\nChanged\n');
  const result = await assess(f, await build(f, input), input, { receiptIds: [receipt.receiptId] });
  assert.equal(result.requirements[0].status, 'STALE'); assert.equal(result.status, 'INCOMPLETE');
});
test('VP8 wrong Goal receipt is rejected even if copied into store', async (t) => {
  const f = fixture(t); const other = fixture(t); const input = inputs({ operation: 'DOC_ONLY' }, { changedPaths: ['README.md'], capabilities: [] });
  const plan = await build(f, input); const receipt = await passed(other, plan.requirements[0]);
  const file = receiptPath(receipt.receiptId, f); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(receipt));
  const result = await assess(f, plan, input, { receiptIds: [receipt.receiptId] });
  assert.notEqual(result.status, 'COMPLETE'); assert.ok(result.requirements[0].reasons.includes('WRONG_GOAL'));
});
test('VP9 site receipt cannot satisfy mobile requirement', async (t) => {
  const f = fixture(t, true); const input = inputs({ operation: 'DOC_ONLY' }, { changedPaths: ['README.md'], capabilities: [] });
  const plan = await build(f, input); const receipt = await passed(f, plan.requirements[0], 'wayper-site');
  const result = await assess(f, plan, input, { receiptIds: [receipt.receiptId] });
  assert.notEqual(result.status, 'COMPLETE'); assert.ok(result.requirements[0].reasons.includes('WRONG_REPOSITORY'));
});
test('VP10 cross-repo requirements are isolated', async (t) => {
  const input = inputs(); input.repositories.push({ ...structuredClone(input.repositories[0]), repository: 'wayper-site', platforms: ['web'] });
  const plan = await build(fixture(t, true), input);
  assert.deepEqual([...new Set(plan.requirements.map((r) => r.repository))].sort(), ['wayper', 'wayper-site']);
  for (const r of plan.requirements) assert.equal(r.repository, r.evidencePolicy.receiptRequirement.repository);
});
test('VP11 mandatory physical device unavailable blocks validation closure', async (t) => {
  const f = fixture(t); const input = inputs({ criteria: [criterion('PHYSICAL_DEVICE')] }, { platforms: ['android'] });
  const plan = await build(f, input); const physical = plan.requirements.find((r) => r.level === 'L5');
  const result = await assess(f, plan, input, { availability: [{ validationRequirementId: physical.validationRequirementId, status: 'UNAVAILABLE', reason: 'NO_DEVICE' }] });
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.requirements.find((r) => r.validationRequirementId === physical.validationRequirementId).status, 'UNAVAILABLE');
});
test('VP12 N/A derives from explicit platform exclusion, never participant boolean', async (t) => {
  const f = fixture(t); const input = inputs({}, { capabilities: ['android-run-boundary'], platforms: ['ios'] });
  const plan = await build(f, input); const result = await assess(f, plan, input);
  assert.ok(result.requirements.some((r) => r.status === 'NOT_APPLICABLE' && r.reasons.includes('PLATFORM_OUT_OF_SCOPE')));
  assert.equal((await assess(f, plan, input, { availability: [{ validationRequirementId: plan.requirements[0].validationRequirementId,
    status: 'NOT_APPLICABLE', reason: 'because' }] })).status, 'REPLAN_REQUIRED');
});
test('VP13 amendment rejects previous plan', async (t) => {
  const f = fixture(t); const input = inputs(); const plan = await build(f, input);
  const next = { ...f, execution: { ...f.execution, identity: { ...f.execution.identity, revision: 2 } } };
  assert.equal((await assess(next, plan, input)).status, 'REPLAN_REQUIRED');
});
test('VP14 different baseline rejects previous plan', async (t) => {
  const f = fixture(t); const input = inputs(); const plan = await build(f, input);
  const repos = structuredClone(f.execution.baseline.repositories); repos[0].dirty = !repos[0].dirty;
  const next = { ...f, execution: { ...f.execution, baseline: baselineFor(repos) } };
  assert.equal((await assess(next, plan, input)).status, 'REPLAN_REQUIRED');
});
test('VP15 compatible current receipt is reused without executing again', async (t) => {
  const f = fixture(t); const input = inputs({ operation: 'DOC_ONLY' }, { changedPaths: ['README.md'], capabilities: [] });
  const receipt = await runObservedCommand({ mutability: 'READ_ONLY', ...f, repository: 'wayper', target: 'earlier-owner-diff',
    command: 'git', args: ['diff', '--check', 'HEAD', '--'] });
  const plan = await build(f, input);
  const result = await assess(f, plan, input);
  assert.equal(result.status, 'COMPLETE'); assert.deepEqual(result.requirements[0].acceptedReceiptIds, [receipt.receiptId]);
  assert.equal(listReceipts(f).length, 1);
  assert.equal(result.metrics.receiptsReused, 1); assert.equal(Object.hasOwn(result, 'goalDone'), false);
});

test('owner cannot relabel an arbitrary unit target as approved integration', async (t) => {
  const f = fixture(t); const input = inputs(); input.repositories[0].testTargets.L2 = ['src/utils/__tests__/runPath.test.js'];
  await assert.rejects(() => build(f, input), /PLAN_INPUT_INCOMPLETE/);
});
test('VP16 model and handoff assertions remain unverified', async (t) => {
  const f = fixture(t); const input = inputs({ operation: 'DOC_ONLY' }, { changedPaths: ['README.md'], capabilities: [] });
  const plan = await build(f, input);
  for (const origin of ['MODEL_ASSERTED', 'HANDOFF_ASSERTED']) {
    const receipt = recordAssertion({ ...f, repository: 'wayper', kind: 'COMMAND', origin,
      target: plan.requirements[0].evidencePolicy.receiptRequirement.target, summary: 'all tests passed' });
    assert.equal((await assess(f, plan, input, { receiptIds: [receipt.receiptId] })).requirements[0].status, 'UNVERIFIED');
  }
});
test('VP17 auth security requires integration; mocks do not prove remote service', async (t) => {
  const f = fixture(t); const input = inputs({ criteria: [criterion('REMOTE_SERVICE', 'shared')] },
    { capabilities: ['firestore-access'], risks: ['AUTH_SECURITY', 'FIREBASE'] });
  const plan = await build(f, input); assert.ok(levels(plan).includes('L2')); assert.ok(levels(plan).includes('L3'));
  assert.notEqual((await assess(f, plan, input)).status, 'COMPLETE');
});
test('VP18 site WebGL requires browser runtime and no Android validation', async (t) => {
  const f = fixture(t, true); const input = inputs({ criteria: [criterion('WEBGL', 'web', { repository: 'wayper-site' })] },
    { repository: 'wayper-site', platforms: ['web'], capabilities: ['motion'] });
  const plan = await build(f, input); assert.ok(levels(plan).includes('L1')); assert.ok(levels(plan).includes('L3'));
  assert.ok(plan.requirements.every((r) => r.platform !== 'android'));
});
test('VP19 documentation only is minimal', async (t) => {
  const plan = await build(fixture(t), inputs({ operation: 'DOC_ONLY' }, { changedPaths: ['README.md'], capabilities: [], risks: ['DOCUMENTATION'] }));
  assert.deepEqual(levels(plan), ['L0']); assert.equal(plan.requirements.length, 1);
});
test('VP20 missing classifications do not invent capabilities or risks', async (t) => {
  const f = fixture(t); const input = inputs(); delete input.repositories[0].risks;
  await assert.rejects(() => build(f, input), /PLAN_INPUT_INCOMPLETE/);
  input.repositories[0].risks = []; delete input.repositories[0].capabilities;
  await assert.rejects(() => build(f, input), /PLAN_INPUT_INCOMPLETE/);
  await assert.rejects(() => build(f, inputs({ operation: 'TRIVIAL' }, { risks: ['CONCURRENCY'] })), /PLAN_INPUT_INCOMPLETE/);
});

test('TEST_ONLY does not demand product runtime absent native source or real claim', async (t) => {
  const plan = await build(fixture(t), inputs({ operation: 'TEST_ONLY' }, { capabilities: ['active-run-lifecycle'],
    platforms: ['android'], risks: ['LIFECYCLE'] }));
  assert.deepEqual(levels(plan), ['L0', 'L1', 'L2']);
});

test('registry and plan schemas reject malformed, conflicting and unknown contracts', async (t) => {
  const { loadValidationRegistry, validateValidationRegistry } = await policy();
  const registry = loadValidationRegistry(); assert.equal(validateValidationRegistry(registry).status, 'VALID');
  const broken = structuredClone(registry); broken.rules.push(structuredClone(broken.rules[0]));
  assert.notEqual(validateValidationRegistry(broken).status, 'VALID');
  const f = fixture(t); const input = inputs(); const plan = await build(f, input);
  plan.requirements[0].blocking = false;
  assert.equal((await assess(f, plan, input)).status, 'REPLAN_REQUIRED');
  const { digest } = await policy();
  const { planId, fingerprint, ...content } = plan;
  const tampered = { ...content, fingerprint: digest(content), planId: `VP-${digest(content).slice(7)}` };
  assert.notEqual(tampered.planId, planId); assert.notEqual(tampered.fingerprint, fingerprint);
  assert.equal((await assess(f, tampered, input)).status, 'REPLAN_REQUIRED');
});

test('registry rejects unknown IDs, invalid levels/platforms, missing checks and impossible rules', async () => {
  const { loadValidationRegistry, validateValidationRegistry } = await policy();
  for (const mutate of [
    (r) => { r.unknown = true; }, (r) => { r.rules[0].when.capabilities = ['invented']; },
    (r) => { r.rules[0].when.risks = ['invented']; }, (r) => { r.riskFlags.push('invented'); },
    (r) => { r.checks[0].level = 'L7'; }, (r) => { r.checks[0].platform = 'physical'; },
    (r) => { r.rules[0].checks = ['missing']; }, (r) => { r.checks[0].paths = ['missing-check.js']; },
    (r) => { r.checks.find((c) => c.id === 'mobile-static').args = ['run', 'missing']; },
    (r) => { r.rules[0].repositories = ['wayper-site']; },
    (r) => { r.rules[0].when = { claims: ['WEBGL'] }; r.rules[0].repositories = ['wayper']; r.rules[0].checks = ['mobile-diff']; },
    (r) => { r.checks[0].level = 'L5'; },
  ]) {
    const registry = loadValidationRegistry(); mutate(registry);
    assert.equal(validateValidationRegistry(registry).status, 'INVALID_REGISTRY');
  }
});

test('determinism, immutable persistence and changed scope require replan', async (t) => {
  const f = fixture(t); const input = inputs(); const first = await build(f, input);
  const { persistValidationPlan, readValidationPlan, listValidationPlans } = await import('../wayper-validation-store.mjs');
  const context = { ...f, inputs: input };
  persistValidationPlan(first, context); persistValidationPlan(first, context);
  assert.deepEqual(readValidationPlan(first.planId, f), first); assert.equal(listValidationPlans(f).length, 1);
  assert.equal((await build(f, JSON.parse(JSON.stringify(input)))).planId, first.planId);
  const changed = structuredClone(input); changed.repositories[0].risks.push('CONCURRENCY');
  const next = await build(f, changed); persistValidationPlan(next, { ...f, inputs: changed });
  assert.notEqual(next.planId, first.planId); assert.equal(listValidationPlans(f).length, 2);
  assert.equal((await assess(f, first, changed)).status, 'REPLAN_REQUIRED');
  assert.deepEqual(readValidationPlan(first.planId, f), first);
});

test('optional unavailable does not block validation closure; forged approved target does', async (t) => {
  const f = fixture(t); const input = inputs({ operation: 'TRIVIAL', taskClass: 'TRIVIAL',
    criteria: [criterion('PHYSICAL_DEVICE', 'android', { required: false, blocking: false })] }, { platforms: ['android'] });
  const plan = await build(f, input); const requirement = plan.requirements.find((r) => r.level === 'L0');
  const fabricated = await runObservedCommand({ mutability: 'READ_ONLY', ...f, repository: 'wayper', target: requirement.evidencePolicy.receiptRequirement.target,
    command: process.execPath, args: ['-e', 'process.exit(0)'] });
  assert.notEqual((await assess(f, plan, input, { receiptIds: [fabricated.receiptId] })).status, 'COMPLETE');
  await passed(f, requirement);
  const assessment = await assess(f, plan, input);
  assert.equal(assessment.status, 'COMPLETE'); assert.ok(assessment.requirements.some((r) => r.status === 'UNAVAILABLE' && !r.blocking));
});

async function mapFixture(f) {
  const { refreshContextMap, integrateRouterOutput, recordContextEntry } = await import('../wayper-context-map.mjs');
  const { loadCapabilityFiles } = await import('./check-capability-routing.mjs');
  const { routeTask } = await import('../wayper-agent-router.mjs');
  const { goalReference } = await import('../wayper-context-identity.mjs');
  const { registry } = loadCapabilityFiles();
  const options = { ...f, goalId: goalReference(f.execution.identity), registry, taskClass: 'BOUNDED', tokenCeiling: 16_000 };
  let map = refreshContextMap(null, options);
  const router = routeTask({ schemaVersion: 1, goalId: options.goalId, operation: 'VALIDATION_TEST',
    repositories: f.repositories.map((r) => r.id), changedFiles: [], candidatePaths: [], riskFlags: [],
    knownCapabilities: ['territory-capture'], knownGoodCapabilities: [], capabilityAssessmentComplete: true,
    structuralUncertainty: false, signals: [] }, registry);
  map = integrateRouterOutput(map, router, options);
  map = recordContextEntry(map, 'evidence', { repository: 'wayper', path: 'owner.js', claim: 'content observed',
    provenance: 'SOURCE', status: 'PROVEN', capabilityRefs: ['territory-capture'] }, f.repositories, options);
  return { map, options, registry, router };
}

test('Map and Working Context index assessment; Packet cannot omit/downgrade/leak requirements', async (t) => {
  const f = fixture(t, true); const fixtureMap = await mapFixture(f);
  const { recordContextEntry, refreshContextMap, validateContextMap } = await import('../wayper-context-map.mjs');
  const { buildContextPacket, validateContextPacket } = await import('../wayper-context-packet.mjs');
  const { workingValidationStatus } = await import('../wayper-context.mjs');
  assert.throws(() => recordContextEntry(fixtureMap.map, 'validation-plan', { inputs: inputs() }, f.repositories, fixtureMap.options), /PLAN_INPUT_INCOMPLETE/);
  const input = inputs({}, { capabilities: ['territory-capture'] });
  assert.throws(() => recordContextEntry({ ...fixtureMap.map, risks: ['AUTH_SECURITY'] },
    'validation-plan', { inputs: input }, f.repositories, fixtureMap.options), /PLAN_INPUT_INCOMPLETE/);
  input.repositories.push({ ...structuredClone(input.repositories[0]), repository: 'wayper-site', platforms: ['web'], capabilities: ['product-rules'] });
  const map = recordContextEntry(fixtureMap.map, 'validation-plan', { inputs: input }, f.repositories, fixtureMap.options);
  assert.equal(validateContextMap(map, { repositoryDefinitions: f.repositories, registry: fixtureMap.registry }).status, 'VALID');
  assert.ok(workingValidationStatus({ contextMap: map, execution: f.execution }, f).requirements.length);
  assert.equal(workingValidationStatus({}).status, 'LEGACY_UNPLANNED');
  const packet = buildContextPacket(map, { type: 'agentProfile', id: 'wayper_geospatial_reviewer', objective: 'review',
    paths: ['wayper:owner.js'] }, { registry: fixtureMap.registry, routerOutput: fixtureMap.router });
  const context = { contextMap: map, registry: fixtureMap.registry, repositoryDefinitions: f.repositories };
  assert.ok(packet.validationPlan.requirements.every((r) => r.repository === 'wayper'));
  assert.equal(validateContextPacket(packet, context).status, 'VALID');
  const wrong = structuredClone(packet); wrong.validationPlan.requirements[0].required = false;
  assert.equal(validateContextPacket(wrong, context).status, 'INVALID');
  const omitted = structuredClone(packet); delete omitted.validationPlan;
  assert.equal(validateContextPacket(omitted, context).status, 'INVALID');
  fs.appendFileSync(path.join(f.root, 'owner.js'), '// changed\n');
  const refreshed = refreshContextMap(map, fixtureMap.options);
  assert.equal(refreshed.validationPlan.status, 'REPLAN_REQUIRED');
});

test('Handoff validation feedback is asserted and cannot change requirement policy', async (t) => {
  const f = fixture(t); const { map: initial, options, registry, router } = await mapFixture(f);
  const { recordContextEntry } = await import('../wayper-context-map.mjs');
  const { buildContextPacket } = await import('../wayper-context-packet.mjs');
  const { buildStructuredHandoff, planContextMapMerge, validateStructuredHandoff } = await import('../wayper-structured-handoff.mjs');
  const map = recordContextEntry(initial, 'validation-plan', { inputs: inputs({}, { capabilities: ['territory-capture'] }) }, f.repositories, options);
  const packet = buildContextPacket(map, { type: 'agentProfile', id: 'wayper_geospatial_reviewer', objective: 'review',
    paths: ['wayper:owner.js'] }, { registry, routerOutput: router });
  const handoff = buildStructuredHandoff({ schemaVersion: 1, goalId: map.goalId, taskId: 'review-1', agentId: packet.target.id,
    packetId: packet.packetId, status: 'NO_FINDINGS', confidence: 0.9, coverage: packet.capabilities.required,
    findings: [], evidenceRefs: [], newEvidence: [], risks: [], recommendations: [], filesRead: [], filesChanged: [], tests: [],
    proofGaps: [], ambiguities: [], blockers: [], validationFindings: [{ validationRequirementId: packet.validationPlan.requirements[0].validationRequirementId,
      summary: 'missing execution', candidateChecks: ['npm test'], existingEvidenceReceiptIds: [] }] }, { packet });
  const context = { packet, contextMap: map, registry, taskId: 'review-1', agentId: packet.target.id, repositoryDefinitions: f.repositories };
  const before = JSON.stringify(map);
  assert.equal(planContextMapMerge(handoff, context).validationFindings[0].origin, 'HANDOFF_ASSERTED');
  assert.equal(JSON.stringify(map), before);
  handoff.validationFindings[0].required = false;
  assert.equal(validateStructuredHandoff(handoff, context).status, 'INVALID_HANDOFF');
});

test('changed registry, schema, evals and planner select their quality tests', async () => {
  const { relevantQualityTests } = await import('./check-completion-backstop.mjs');
  for (const file of ['docs/ai/validation-registry.json', 'docs/ai/validation-planner-evals.json',
    'scripts/wayper-validation-policy.mjs', 'scripts/wayper-validation-planner.mjs']) {
    assert.ok(relevantQualityTests([file]).includes('scripts/quality/check-validation-planner.test.mjs'));
  }
});

test('adversarial validation evals reject false depth and reuse actual compatible evidence', async (t) => {
  const suite = JSON.parse(fs.readFileSync(new URL('../../docs/ai/validation-planner-evals.json', import.meta.url), 'utf8'));
  assert.equal(suite.schemaVersion, 1); assert.equal(suite.cases.length, 12);
  assert.equal(new Set(suite.cases.map((c) => c.id)).size, suite.cases.length);
  for (const item of suite.cases) {
    assert.deepEqual(Object.keys(item).sort(), ['attack', 'expectedSatisfied', 'id']);
    const f = fixture(t, item.attack === 'wrongRepository');
    const physical = ['unitAsPhysical', 'emulatorAsPhysical'].includes(item.attack);
    const runtime = ['buildAsRuntime', 'unitAsRemote'].includes(item.attack);
    const input = physical || runtime ? inputs({ criteria: [criterion(physical ? 'PHYSICAL_DEVICE' :
      item.attack === 'unitAsRemote' ? 'REMOTE_SERVICE' : 'RUNTIME')] }, { platforms: ['android'] }) :
      inputs({ operation: 'DOC_ONLY' }, { changedPaths: ['README.md'], capabilities: [] });
    if (item.attack === 'failedCheck') fs.appendFileSync(path.join(f.root, 'README.md'), 'trailing whitespace  \n');
    let plan = await build(f, input);
    const requirement = plan.requirements.find((r) => r.level === (physical ? 'L5' : runtime ? 'L3' : 'L0'));
    const target = requirement.evidencePolicy.receiptRequirement.target; let receiptId;
    if (item.attack === 'wrongBaseline') {
      const repositories = structuredClone(f.execution.baseline.repositories); repositories[0].dirty = true;
      const result = await assess({ ...f, execution: { ...f.execution, baseline: baselineFor(repositories) } }, plan, input);
      assert.equal(result.status, 'REPLAN_REQUIRED'); assert.equal(item.expectedSatisfied, false); continue;
    }
    if (item.attack === 'emulatorAsPhysical') receiptId = recordAssertion({ ...f, repository: 'wayper', kind: 'RUNTIME',
      origin: 'MODEL_ASSERTED', target, summary: 'all tests passed, emulator is physical', environment: 'emulator' }).receiptId;
    else if (['unitAsPhysical', 'unitAsRemote'].includes(item.attack)) receiptId = (await runObservedTest({ mutability: 'READ_ONLY', ...f,
      repository: 'wayper', target, command: process.execPath, args: ['-e', "require('node:assert/strict').equal(1,1)"] })).receipt.receiptId;
    else if (['buildAsRuntime', 'wrongCommand'].includes(item.attack)) receiptId = (await runObservedCommand({ mutability: 'READ_ONLY', ...f,
      repository: 'wayper', target, command: process.execPath, args: ['-e', 'process.exit(0)'] })).receiptId;
    else if (item.attack === 'rawText') receiptId = 'all tests passed';
    else if (item.attack === 'wrongGoal') {
      const other = { ...f, execution: createGoalExecution({ threadId: 'another-goal', repositories: f.repositories }) };
      const receipt = await passed(other, requirement); receiptId = receipt.receiptId;
      const file = receiptPath(receiptId, f); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(receipt));
    }
    else if (['reuse', 'stale', 'failedCheck', 'wrongRepository'].includes(item.attack)) {
      receiptId = (await passed(f, requirement, item.attack === 'wrongRepository' ? 'wayper-site' : 'wayper')).receiptId;
    } else assert.fail(`Unknown eval attack ${item.attack}`);
    if (item.attack === 'stale') {
      fs.appendFileSync(path.join(f.root, 'README.md'), 'new state\n'); plan = await build(f, input);
    }
    const result = await assess(f, plan, input, { receiptIds: [receiptId] });
    const row = result.requirements.find((r) => r.validationRequirementId === requirement.validationRequirementId);
    assert.equal(row.status === 'SATISFIED', item.expectedSatisfied, item.id);
    if (item.attack === 'failedCheck') assert.equal(row.status, 'BLOCKED');
  }
});
