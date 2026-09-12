import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { completionFixture, finding } from './completion-fixture.mjs';
import { assessGoalCompletion } from '../wayper-completion-boundary.mjs';
import { readWorkingContext, amendWorkingContext } from '../wayper-context.mjs';
import { readReceipt } from '../wayper-evidence-store.mjs';

const api = () => import('../wayper-feedback.mjs');
const policy = () => import('../wayper-feedback-policy.mjs');
const options = (f, extra = {}) => ({ root: f.root, identity: f.identity, ...extra });
const reload = (f) => { f.state = readWorkingContext(f.root, { 'thread-id': f.identity.threadId,
  'goal-run-id': f.identity.goalRunId, revision: f.identity.revision }); };
async function fixture(t, extra = {}, cross = false) {
  const f = completionFixture(t, cross); await f.ready();
  f.state.contextMap.findings = [finding(extra)]; f.refresh(); return f;
}
const diagnosis = (hypothesis = 'Fix the observed defect', kind = 'EDIT') => ({ failure, evidenceRefs }) => ({
  failureIds: [failure.failureId], causeClass: failure.failureClass, summary: 'Observed blocker remains',
  hypothesis, confidence: 0.8, affectedScope: { repository: failure.repository, paths: ['README.md'] },
  proposedActionKind: kind, validationRequirementIds: [], evidenceRefs });
async function resolve(ctx, id = 'F-bug') {
  const proof = await ctx.observeQualityGate({ repository: ctx.failure.repository, target: `finding:${id}:RESOLVED`,
    command: 'node', args: ['-e', 'require("node:assert/strict").ok(require("node:fs").existsSync("README.md"))'] });
  ctx.record('finding', finding({ id, repository: ctx.failure.repository, status: 'RESOLVED', receiptIds: [proof.receiptId], resolution: {
    reviewer: 'OWNER', reason: 'Observed regression verification', humanDecisionRequired: false,
    goalReference: ctx.identity, baselineFingerprint: ctx.execution.baseline.fingerprint } }));
}
async function start(f, extra) { return (await api()).startFeedbackSession(options(f, extra)); }
async function step(f, session, extra = {}) { return (await api()).runFeedbackIteration(options(f, {
  feedbackId: session.feedbackId, diagnose: diagnosis(), act: async () => {}, ...extra })); }
const assessment = (f) => assessGoalCompletion(options(f));

test('FL1 simple fixable produces evidence and succeeds only through Completion', async (t) => {
  const f = await fixture(t); const s = await step(f, await start(f), { act: resolve });
  assert.equal(s.outcome, 'SUCCEEDED'); assert.equal(assessment(f).decision, 'ADMISSIBLE');
  assert.equal(s.attempts.length, 1); assert.ok(s.attempts[0].receiptIds.length);
});
test('FL2 same failure is not progress', async (t) => {
  const f = await fixture(t); const s = await step(f, await start(f));
  assert.equal(s.progressState.relation, 'SAME'); assert.equal(s.progressState.materialProgress, false);
  assert.equal(s.state, 'REASSESS_CAUSE');
});
test('FL3 reduced failure set is material progress', async (t) => {
  const f = await fixture(t); f.state.contextMap.findings.push(finding({ id: 'F-second' })); f.refresh();
  const s = await step(f, await start(f), { act: resolve });
  assert.equal(s.progressState.relation, 'REDUCED'); assert.equal(s.progressState.materialProgress, true);
  assert.notEqual(s.outcome, 'SUCCEEDED');
});
test('FL4 new failure is not success', async (t) => {
  const f = await fixture(t); const s = await step(f, await start(f), { act: async (ctx) => {
    await resolve(ctx); ctx.record('finding', finding({ id: 'F-new' }));
  } });
  assert.equal(s.progressState.relation, 'CHANGED'); assert.notEqual(s.outcome, 'SUCCEEDED');
});
test('FL5 failure expansion is regression', async (t) => {
  const f = await fixture(t); const s = await step(f, await start(f), { act: async (ctx) => {
    ctx.record('finding', finding({ id: 'F-two' })); ctx.record('finding', finding({ id: 'F-three' }));
  } });
  assert.equal(s.progressState.relation, 'EXPANDED'); assert.equal(s.progressState.regression, true);
});
test('FL6 no progress stops after two comparable attempts', async (t) => {
  const f = await fixture(t); let s = await step(f, await start(f));
  s = await step(f, s, { diagnose: diagnosis('A different observable cause') });
  assert.equal(s.outcome, 'NO_PROGRESS'); assert.equal(s.attempts.length, 2);
});
test('FL7 executable budget stops even when more actions are offered', async (t) => {
  const f = await fixture(t); let calls = 0; const s = await step(f, await start(f, { attemptBudget: 1 }), { act: async () => { calls++; } });
  const again = await step(f, s, { act: async () => { calls++; } });
  assert.equal(again.outcome, 'EXHAUSTED'); assert.equal(calls, 1);
});
test('FL8 new hypothesis required after no progress', async (t) => {
  const f = await fixture(t); const s = await step(f, await start(f)); let calls = 0;
  const again = await step(f, s, { act: async () => { calls++; } });
  assert.equal(again.outcome, 'NO_PROGRESS'); assert.match(again.reasonCode, /NEW_HYPOTHESIS_REQUIRED|DUPLICATE_ACTION/); assert.equal(calls, 0);
});
test('FL9 stale evidence follows revalidation without an edit callback', async (t) => {
  const f = completionFixture(t); await f.ready(); fs.appendFileSync(path.join(f.root, 'README.md'), 'changed\n'); f.plan(); f.refresh();
  let edits = 0; const s = await step(f, await start(f), { diagnose: diagnosis('Refresh observed proof', 'REVALIDATE'), act: async () => { edits++; },
    validate: async (ctx) => { const p = await ctx.observeQualityGate({ repository: 'wayper', target: 'criterion', command: 'node', args: ['-e', 'process.exit(0)'] }); ctx.prove('SUCCESS:criterion', p.receiptId); } });
  assert.equal(edits, 0); assert.equal(s.outcome, 'SUCCEEDED');
});
test('FL10 replan uses existing Planner and reassesses', async (t) => {
  const f = completionFixture(t); await f.ready(); fs.appendFileSync(path.join(f.root, 'README.md'), 'change\n'); await f.prove();
  const s = await step(f, await start(f), { diagnose: diagnosis('Inputs require a fresh plan', 'REPLAN') });
  assert.equal(s.outcome, 'SUCCEEDED'); assert.equal(assessment(f).validationState.status, 'COMPLETE');
});
test('FL11 external unavailable has zero automatic attempts', async (t) => {
  const f = completionFixture(t); await f.ready(); f.input.repositories[0].platforms = ['android'];
  f.input.criteria = [{ id: 'device', repository: 'wayper', platform: 'android', claim: 'PHYSICAL_DEVICE', required: true, blocking: true }]; f.plan(); f.refresh();
  const s = await start(f); assert.equal(s.outcome, 'BLOCKED_EXTERNAL'); assert.equal(s.attempts.length, 0);
});
test('FL12 material ambiguity requests human decision without fabricating one', async (t) => {
  const f = completionFixture(t); await f.ready(); f.state.contextMap.ambiguities.push({ code: 'PRODUCT', repository: 'wayper', materiality: 'MATERIAL',
    status: 'OPEN', reason: 'Conflicting product constraints', relatedRequirementIds: [], receiptIds: [] }); f.refresh();
  const s = await start(f); assert.equal(s.outcome, 'HUMAN_REQUIRED'); assert.ok(s.decisionRequest.decisionId); assert.equal(s.attempts.length, 0);
});
test('FL13 invalid owner state stops safely', async (t) => {
  const f = completionFixture(t); await f.ready(); f.state.requirements[0].blocking = false; f.save();
  const s = await start(f); assert.equal(s.outcome, 'INVALID_STATE');
});
test('FL14 incorporated review rejection becomes a fixable failure', async (t) => {
  const f = await fixture(t); const s = await start(f);
  assert.ok(s.currentFailureSet.some((x) => x.failureClass === 'FIXABLE' && x.relatedFindingIds.includes('F-bug')));
  assert.notEqual(s.outcome, 'SUCCEEDED');
});
test('FL15 resume keeps finished attempt and never repeats its action', async (t) => {
  const f = await fixture(t); let calls = 0; const s = await step(f, await start(f), { act: async (ctx) => { calls++; await resolve(ctx); } });
  const resumed = (await api()).resumeFeedbackSession(options(f, { feedbackId: s.feedbackId }));
  assert.equal(resumed.status, 'CURRENT'); assert.equal(resumed.session.attempts.length, 1);
  await step(f, resumed.session, { act: async () => { calls++; } }); assert.equal(calls, 1);
  fs.appendFileSync(path.join(f.root, 'README.md'), 'external change after success\n');
  const stale = await (await api()).runFeedbackLoop(options(f, { feedbackId: s.feedbackId }));
  assert.equal(stale.outcome, 'REPLAN_REQUIRED'); assert.equal(calls, 1);
});
async function amendment(f) {
  reload(f); f.state = amendWorkingContext({ ...f.options(), existing: f.state, identity: f.identity,
    changes: { requirements: { add: ['SUCCESS:additional'] } }, reason: 'Material change' }); f.identity = f.state.execution.identity; f.save();
}
test('FL16 amendment makes session stale', async (t) => {
  const f = await fixture(t); const s = await start(f); await amendment(f);
  const a = await api();
  assert.throws(() => a.resumeFeedbackSession(options(f, { feedbackId: s.feedbackId })), /STALE|WRONG|missing/i);
});
test('FL17 wrong Goal cannot consume session', async (t) => {
  const f = await fixture(t); const other = await fixture(t); const s = await start(f); const a = await api();
  assert.throws(() => a.resumeFeedbackSession(options(other, { feedbackId: s.feedbackId })), /STALE|WRONG|missing/i);
});
test('FL18 wrong revision is rejected', async (t) => {
  const f = await fixture(t); const s = await start(f); const a = await api();
  assert.throws(() => a.resumeFeedbackSession(options(f, { identity: { ...f.identity, revision: 2 }, feedbackId: s.feedbackId })), /revision|STALE|WRONG|missing/i);
});
test('FL19 external change before mutation is preserved', async (t) => {
  const f = await fixture(t); let calls = 0; const s = await step(f, await start(f), { diagnose: (input) => {
    fs.appendFileSync(path.join(f.root, 'README.md'), 'External WIP\n'); return diagnosis()(input);
  }, act: async () => { calls++; } });
  assert.equal(s.reasonCode, 'CONCURRENT_CHANGE'); assert.equal(calls, 0);
  assert.match(fs.readFileSync(path.join(f.root, 'README.md'), 'utf8'), /External WIP/);
});
test('FL20 failed action records observed FAIL, never fix', async (t) => {
  const f = await fixture(t); const s = await step(f, await start(f), { act: async (ctx) => {
    await ctx.observeCommand({ repository: 'wayper', target: 'failed-action', command: 'node', args: ['-e', 'process.exit(1)'] });
  } });
  const receipts = s.attempts[0].receiptIds.map((id) => readReceipt(id, f.options()));
  assert.ok(receipts.some((r) => r.result === 'FAIL')); assert.notEqual(s.outcome, 'SUCCEEDED');
});
test('FL21 green test cannot bypass open finding', async (t) => {
  const f = await fixture(t); const s = await step(f, await start(f), { act: async (ctx) => {
    await ctx.observeTest({ repository: 'wayper', target: 'unrelated', command: 'node', args: ['-e',
      'require("node:test")("green",()=>require("node:assert/strict").ok(require("node:fs").existsSync("README.md")))'] });
  } });
  assert.notEqual(s.outcome, 'SUCCEEDED');
});
test('FL22 new critical finding prevents success', async (t) => {
  const f = await fixture(t); const s = await step(f, await start(f), { act: async (ctx) => {
    await resolve(ctx); ctx.record('finding', finding({ id: 'F-critical', severity: 'CRITICAL' }));
  } });
  assert.notEqual(s.outcome, 'SUCCEEDED'); assert.equal(s.progressState.regression, true);
});
test('FL23 repeated same action/hypothesis is not executed blindly', async (t) => {
  const f = await fixture(t); let calls = 0;
  const callbacks = { act: async () => { calls++; } }; let s = await step(f, await start(f), callbacks); s = await step(f, s, callbacks);
  assert.equal(calls, 1); assert.equal(s.outcome, 'NO_PROGRESS');
});
test('FL24 repository ownership remains in failure identity', async (t) => {
  const f = await fixture(t, { repository: 'wayper-site' }, true); const s = await start(f);
  assert.equal(s.currentFailureSet[0].repository, 'wayper-site');
  assert.notEqual((await policy()).failureIdentity({ ...s.currentFailureSet[0], repository: 'wayper' }), s.currentFailureSet[0].failureId);
});
test('FL25 diagnosis packet contains bounded relevant history', async (t) => {
  const f = await fixture(t); const s = await step(f, await start(f)); let context;
  await step(f, s, { diagnose: (c) => { context = c; return diagnosis('New hypothesis')(c); } });
  assert.ok(context.failedHypotheses.length <= 2); assert.equal(Object.hasOwn(context, 'attempts'), false); assert.equal(Object.hasOwn(context, 'transcript'), false);
});
test('FL26 receipt attempt/failure metadata is owned by runtime', async (t) => {
  const f = await fixture(t); const s = await step(f, await start(f), { act: resolve }); const attempt = s.attempts[0];
  for (const id of attempt.receiptIds) {
    const receipt = readReceipt(id, f.options()); assert.equal(receipt.metadata.attemptId, attempt.attemptId);
    assert.equal(receipt.metadata.failureId, attempt.failureId);
  }
});
test('FL27 callback assertion cannot override Completion authority', async (t) => {
  const f = await fixture(t); const s = await step(f, await start(f), { act: async () => ({ outcome: 'SUCCEEDED', completion: 'ADMISSIBLE' }), reassess: () => ({ decision: 'ADMISSIBLE' }) });
  assert.notEqual(s.outcome, 'SUCCEEDED'); assert.notEqual(assessment(f).decision, 'ADMISSIBLE');
});
test('FL28 informational warning never becomes a failure', async (t) => {
  const f = await fixture(t, { severity: 'INFO', materiality: 'INFORMATIONAL' }); const s = await start(f);
  assert.equal(s.currentFailureSet.length, 0); assert.equal(s.outcome, 'SUCCEEDED'); assert.equal(s.attempts.length, 0);
});
