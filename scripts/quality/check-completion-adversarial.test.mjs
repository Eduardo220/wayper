import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import test from 'node:test';
import { completionFixture, finding } from './completion-fixture.mjs';
import { assessGoalCompletion, assertGoalCompletionAdmissible, validateCompletionAssessment } from '../wayper-completion-boundary.mjs';
import { sealCompletionAssessment, validateCompletionAssessmentSchema, completionIndex } from '../wayper-completion-policy.mjs';
import { completionAssessmentPath, persistCompletionAssessment, readCompletionAssessment, recordCompletionAttempt,
  completionTelemetry, bindCompletionStop, completionStopBinding } from '../wayper-completion-store.mjs';
import { buildContextPacket, validateContextPacket } from '../wayper-context-packet.mjs';
import { buildStructuredHandoff, validateStructuredHandoff, planContextMapMerge } from '../wayper-structured-handoff.mjs';
import { recordContextEntry, validateContextMap } from '../wayper-context-map.mjs';
import { evaluateCompletion, evaluateBudgetControl } from './check-meta-goal-completion.mjs';
import { relevantQualityTests } from './check-completion-backstop.mjs';
import { ROOT } from '../wayper-context.mjs';
import { digest } from '../wayper-validation-policy.mjs';

const options = (f) => ({ root: f.root, identity: f.identity });
const assess = (f) => assessGoalCompletion(options(f));
const suite = JSON.parse(fs.readFileSync(new URL('../../docs/ai/completion-boundary-evals.json', import.meta.url)));
assert.equal(suite.schemaVersion, 1);
for (const c of suite.cases) test(`${c.id} ${c.claim}`, async (t) => {
  const f = completionFixture(t); f.plan(); await f.validate();
  let decision;
  if (c.scenario === 'TEXT_TESTS') { f.state.requirements[0].status = 'SATISFIED'; f.state.requirements[0].evidence = ['all tests passed']; f.save(); }
  if (c.scenario === 'CRITICAL_FINDING') { await f.prove(); f.state.contextMap.findings = [finding({ severity: 'CRITICAL' })]; f.refresh(); }
  if (['BLOCKING_DEVICE', 'ALLOWED_UNKNOWN'].includes(c.scenario)) {
    await f.prove(); const blocking = c.scenario === 'BLOCKING_DEVICE';
    f.input.criteria = [{ id: 'device', repository: 'wayper', platform: 'android', claim: 'PHYSICAL_DEVICE', required: blocking, blocking }];
    f.input.repositories[0].platforms = ['android']; f.plan(); f.refresh();
  }
  if (c.scenario === 'PRIOR_REVISION') { await f.prove(); const a = assess(f);
    decision = validateCompletionAssessment(a, { ...options(f), identity: { ...f.identity, revision: 2 } }).status; }
  assert.equal(decision ?? assessGoalCompletion({ ...options(f), handoff: { status: 'DONE' } }).decision, c.expected);
});

test('assessment schema, determinism, immutable store and obsolete proof', async (t) => {
  const f = completionFixture(t); await f.ready(); const a = assess(f);
  assert.equal(validateCompletionAssessmentSchema(a), true);
  assert.deepEqual(assess(f), a);
  persistCompletionAssessment(a, options(f)); persistCompletionAssessment(a, options(f));
  assert.deepEqual(readCompletionAssessment(a.assessmentId, options(f)), a);
  const forged = { ...a, unknown: 'extra' }; assert.equal(validateCompletionAssessmentSchema(forged), false);
  const { assessmentId: _id, fingerprint: _fp, ...content } = a;
  const bypass = sealCompletionAssessment({ ...content, requirementState: [] });
  assert.equal(validateCompletionAssessment(bypass, options(f)).status, 'STALE');
  assert.throws(() => persistCompletionAssessment(bypass, options(f)), /stale or invalid/);
  fs.appendFileSync(path.join(f.root, 'README.md'), 'change\n');
  assert.throws(() => persistCompletionAssessment(a, options(f)), /stale or invalid/);
  assert.deepEqual(readCompletionAssessment(a.assessmentId, options(f)), a);
  assert.throws(() => assertGoalCompletionAdmissible(options(f)), (e) => e.assessment.blockers.length > 0);
});

test('assessment store rejects symlink traversal', async (t) => {
  const f = completionFixture(t); await f.ready();
  fs.symlinkSync(f.root, path.join(f.root, '.wayper-context', 'completion'));
  assert.throws(() => completionAssessmentPath(assess(f).assessmentId, options(f)), /Unsafe/);
});

test('owner definition cannot silently remove a criterion or downgrade policy', async (t) => {
  const f = completionFixture(t); await f.ready();
  f.state.requirements[0].blocking = false; f.save();
  assert.equal(assess(f).decision, 'INVALID_STATE');
});

test('specialist resolution and fake human risk acceptance cannot close critical finding', async (t) => {
  const f = completionFixture(t); await f.ready();
  for (const reviewer of ['SPECIALIST', 'OWNER']) {
    f.state.contextMap.findings = [finding({ severity: 'CRITICAL', status: 'ACCEPTED_RISK', resolution: {
      reviewer, reason: 'I accept the risk', humanDecisionRequired: false, goalReference: f.identity,
      baselineFingerprint: f.state.execution.baseline.fingerprint } })]; f.save();
    assert.notEqual(assess(f).decision, 'ADMISSIBLE');
  }
});

test('bounded completion index invalidates after finding, packets reject leakage and omitted blockers', async (t) => {
  const f = completionFixture(t, true); await f.ready();
  f.state.contextMap.capabilities.optional = ['test-build']; f.plan(); f.refresh(); const a = assess(f);
  const mapOptions = { registry: f.registry, repositoryDefinitions: f.repositories };
  const unbacked = structuredClone(f.state.contextMap); unbacked.completion = completionIndex(a, unbacked);
  assert.equal(validateContextMap(unbacked, mapOptions).status, 'INVALID');
  persistCompletionAssessment(a, options(f));
  f.state.contextMap.completion = completionIndex(a, f.state.contextMap); f.refresh();
  assert.equal(validateContextMap(f.state.contextMap, mapOptions).status, 'VALID');
  f.state.contextMap.findings = [finding({ repository: 'wayper-site' })]; f.refresh();
  assert.equal(f.state.contextMap.completion.stale, true);
  const target = { type: 'validationRole', id: 'followup-review', repositories: ['wayper'], paths: [], capabilities: ['test-build'], objective: 'Review completion' };
  const p = buildContextPacket(f.state.contextMap, target, { registry: f.registry, repositoryDefinitions: f.repositories });
  assert.deepEqual(p.completion.openFindings, []);
  p.completion.openFindings = [{ id: 'F-bug', repository: 'wayper-site' }];
  assert.equal(validateContextPacket(p, { contextMap: f.state.contextMap, registry: f.registry, repositoryDefinitions: f.repositories }).status, 'INVALID');
});

test('real Handoff DONE produces open owner proposals and cannot resolve its own finding', async (t) => {
  const f = completionFixture(t); await f.ready();
  f.state.contextMap.capabilities.optional = ['test-build']; f.plan(); f.refresh();
  const p = buildContextPacket(f.state.contextMap, { type: 'validationRole', id: 'followup-review', repositories: ['wayper'],
    capabilities: ['test-build'], paths: [], objective: 'Review completion' }, { registry: f.registry, repositoryDefinitions: f.repositories });
  const draft = { schemaVersion: 1, goalId: p.goalId, taskId: 'completion', agentId: p.target.id, packetId: p.packetId,
    status: 'DONE', confidence: 0.9, coverage: ['test-build'], findings: [], evidenceRefs: [], newEvidence: [], risks: [], recommendations: ['optional improvement'],
    filesRead: [], filesChanged: [], tests: [], proofGaps: [], ambiguities: [], blockers: [] };
  const o = { packet: p, contextMap: f.state.contextMap, registry: f.registry, repositoryDefinitions: f.repositories };
  let h = buildStructuredHandoff(draft, { packet: p });
  assert.equal(validateStructuredHandoff(h, o).status, 'VALID');
  assert.equal(planContextMapMerge(h, o).completionAuthority, 'NONE'); assert.deepEqual(planContextMapMerge(h, o).findings, []);
  draft.proofGaps = [{ id: 'PGP-bug', claim: 'Bug needs proof', reason: 'Missing regression', requiredEvidence: 'Regression check', evidenceRefs: [], capabilityRefs: [] }];
  draft.findings = [{ id: 'F-review', severity: 'HIGH', category: 'CORRECTNESS', claim: 'A real bug', scenario: 'Specific input',
    impact: 'Incorrect behavior', safeguard: 'Not covered', confidence: 0.9, evidenceRefs: [], proofGapRefs: ['PGP-bug'], affectedCapabilities: [] }];
  h = buildStructuredHandoff(draft, { packet: p }); const merge = planContextMapMerge(h, o);
  assert.equal(merge.findings[0].status, 'OPEN');
  f.state.contextMap = recordContextEntry(f.state.contextMap, 'finding', merge.findings[0], f.repositories, f.options()); f.save();
  assert.equal(assess(f).decision, 'NOT_ADMISSIBLE');
  draft.findings[0].status = 'RESOLVED';
  assert.equal(validateStructuredHandoff(buildStructuredHandoff(draft, { packet: p }), o).status, 'INVALID_HANDOFF');
});

test('Meta connected evaluator delegates; legacy cannot grant eligibility', async (t) => {
  const f = completionFixture(t); await f.ready();
  assert.equal(evaluateCompletion({}, options(f)).result, 'COMPLETION_ADMISSIBLE');
  assert.equal(evaluateBudgetControl({ completionEligible: true }, options(f)).goalResult, 'COMPLETION_ADMISSIBLE');
  assert.notEqual(evaluateBudgetControl({ completionEligible: true }).goalResult, 'GOAL_SATISFIED');
  f.state.contextMap.findings = [finding()]; f.refresh();
  const r = evaluateCompletion({ completionEligible: true }, options(f));
  assert.equal(r.eligible, false); assert.deepEqual(r.assessment, assess(f));
  assert.equal(evaluateCompletion({ completionEligible: true }).eligible, false);
});

test('actual Stop process rejects clean incomplete bound Goal and exits on reentrancy', async (t) => {
  const f = completionFixture(t); f.plan(); await f.validate();
  bindCompletionStop({ ...options(f), turnId: 'stop-test' });
  const payload = { cwd: f.root, session_id: f.identity.threadId, turn_id: 'stop-test', hook_event_name: 'Stop' };
  assert.equal(completionStopBinding(f.root, { ...payload, turn_id: 'other' }).coverage, 'UNBOUND_TURN');
  const script = new URL('./check-completion-backstop.mjs', import.meta.url).pathname;
  const run = (input) => execFileSync(process.execPath, [script, '--hook'], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(JSON.parse(run(payload)).decision, 'block');
  assert.equal(run({ ...payload, stop_hook_active: true }), '');
});

test('telemetry records attempts without timestamps in deterministic assessment', async (t) => {
  const f = completionFixture(t); f.plan(); await f.validate(); const rejected = assess(f);
  const events = [recordCompletionAttempt(rejected, options(f))];
  await f.prove(); const accepted = assess(f); events.push(recordCompletionAttempt(accepted, options(f)));
  assert.equal(completionTelemetry(events).completionAttempts, 2); assert.equal(completionTelemetry(events).rejected, 1);
  assert.equal(completionTelemetry(events).admissible, 1); assert.deepEqual(assess(f), accepted);
});

test('completion schema, evals, finding and backstop consumers select the canonical suite', () => {
  for (const file of ['scripts/wayper-completion-policy.mjs', 'scripts/wayper-completion-boundary.mjs',
    'scripts/wayper-completion-store.mjs', 'scripts/wayper-context-map.mjs', 'scripts/wayper-structured-handoff.mjs',
    'scripts/quality/check-completion-backstop.mjs', 'docs/ai/completion-boundary-evals.json']) {
    assert.ok(relevantQualityTests([file]).includes('scripts/quality/check-completion-boundary.test.mjs'));
    assert.ok(relevantQualityTests([file]).includes('scripts/quality/check-completion-adversarial.test.mjs'));
  }
});

test('completion CLI persists refusal and registers exact Stop identity without import deadlock', (t) => {
  const threadId = `completion-cli-${crypto.randomUUID()}`;
  const script = path.join(ROOT, 'scripts/wayper-context.mjs');
  const run = (command, args) => spawnSync(process.execPath, [script, command, ...args], { encoding: 'utf8', timeout: 10000 });
  const start = run('start', ['--thread-id', threadId, '--objective', 'CLI completion proof', '--class', 'BOUNDED', '--requirement', 'SUCCESS:missing']);
  assert.equal(start.status, 0, start.stderr);
  const goalRunId = start.stdout.match(/GOAL_RUN_ID (\S+)/)[1];
  t.after(() => {
    fs.rmSync(path.join(ROOT, '.wayper-context', `${goalRunId}.md`), { force: true });
    fs.rmSync(path.join(ROOT, '.wayper-context', 'completion', goalRunId), { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, '.wayper-context', 'completion', 'stop', `${digest(threadId).slice(7)}.json`), { force: true });
  });
  const selector = ['--thread-id', threadId, '--goal-run-id', goalRunId, '--revision', '1'];
  for (const command of ['completion', 'completion-request']) {
    const result = run(command, selector); assert.equal(result.status, 1, result.stderr);
    const a = JSON.parse(result.stdout); assert.equal(a.decision, 'NOT_ADMISSIBLE');
    assert.equal(validateCompletionAssessmentSchema(a), true);
    assert.deepEqual(readCompletionAssessment(a.assessmentId, { root: ROOT, identity: a.goalReference }), a);
  }
  assert.equal(completionStopBinding(ROOT, { session_id: threadId }).identity.goalRunId, goalRunId);
});

test('receipt sets are order independent and rejected narrative is never a receipt ID', async (t) => {
  const f = completionFixture(t); await f.ready(); const one = f.state.requirements[0].evidence[0];
  const two = (await f.prove()).receiptId;
  f.state.requirements[0].evidence = [one, two]; f.save(); const a = assess(f);
  f.state.requirements[0].evidence.reverse(); f.save(); assert.deepEqual(assess(f), a);
  f.state.requirements[0].evidence = ['all done']; f.save();
  assert.equal(JSON.stringify(assess(f)).includes('all done'), false);
});

test('dirty allowed state and unused Graphify do not block', async (t) => {
  const f = completionFixture(t); await f.ready();
  fs.appendFileSync(path.join(f.root, 'README.md'), 'Intended working change\n');
  await f.prove(); f.plan(); await f.validate();
  f.state.contextMap.graphify.wayper.status = 'STALE'; f.save();
  assert.equal(assess(f).decision, 'ADMISSIBLE');
});

test('a rehashed assessment with another baseline is stale', async (t) => {
  const f = completionFixture(t); await f.ready(); const { assessmentId: _id, fingerprint: _fp, ...content } = assess(f);
  const a = sealCompletionAssessment({ ...content, baselineReference: { fingerprint: `sha256:${'f'.repeat(64)}` } });
  assert.equal(validateCompletionAssessment(a, options(f)).status, 'STALE');
});
