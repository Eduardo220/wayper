import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { completionFixture, finding } from './completion-fixture.mjs';
import { amendWorkingContext } from '../wayper-context.mjs';
import { receiptPath } from '../wayper-evidence-store.mjs';
import { runBackstop, hookResponse } from './check-completion-backstop.mjs';

const boundary = () => import('../wayper-completion-boundary.mjs');
const assess = async (f) => (await boundary()).assessGoalCompletion({ root: f.root, identity: f.identity });
const ledger = (f, entry) => { f.state.contextMap.findings = [entry]; f.refresh(); };

test('CB1 clean but incomplete', async (t) => {
  const f = completionFixture(t); f.plan(); await f.validate();
  const a = await assess(f); assert.equal(a.decision, 'NOT_ADMISSIBLE');
  assert.ok(a.blockers.some((b) => b.sourceId === 'SUCCESS:criterion'));
});
test('CB2 validation incomplete', async (t) => {
  const f = completionFixture(t); await f.prove(); f.plan();
  const a = await assess(f); assert.equal(a.validationState.status, 'INCOMPLETE'); assert.equal(a.decision, 'NOT_ADMISSIBLE');
});
test('CB3 blocking unavailable', async (t) => {
  const f = completionFixture(t); await f.ready();
  f.input.criteria = [{ id: 'device', repository: 'wayper', platform: 'android', claim: 'PHYSICAL_DEVICE', required: true, blocking: true }];
  f.input.repositories[0].platforms = ['android']; f.plan(); f.refresh();
  assert.equal((await assess(f)).decision, 'BLOCKED_EXTERNAL');
});
test('CB4 validation complete is admissible, never host DONE', async (t) => {
  const f = completionFixture(t); await f.ready(); const a = await assess(f);
  assert.equal(a.validationState.status, 'COMPLETE'); assert.equal(a.decision, 'ADMISSIBLE'); assert.equal(Object.hasOwn(a, 'goalDone'), false);
});
test('CB5 stale plan', async (t) => {
  const f = completionFixture(t); await f.ready(); fs.appendFileSync(path.join(f.root, 'README.md'), 'change\n');
  assert.equal((await assess(f)).decision, 'REPLAN_REQUIRED');
});
test('CB6 stale required receipt with current plan', async (t) => {
  const f = completionFixture(t); await f.ready(); fs.appendFileSync(path.join(f.root, 'README.md'), 'change\n'); f.plan(); f.refresh();
  assert.equal((await assess(f)).decision, 'REVALIDATION_REQUIRED');
});
test('CB7 wrong Goal evidence and assessment rejected', async (t) => {
  const f = completionFixture(t); const other = completionFixture(t); await f.ready(); await other.ready();
  const a = await assess(other); const receipt = await other.prove();
  const destination = receiptPath(receipt.receiptId, f.options());
  fs.copyFileSync(receiptPath(receipt.receiptId, other.options()), destination);
  f.state.requirements[0].evidence = [receipt.receiptId]; f.save();
  assert.notEqual((await assess(f)).decision, 'ADMISSIBLE');
  assert.notEqual((await boundary()).validateCompletionAssessment(a, { root: f.root, identity: f.identity }).status, 'CURRENT');
});
test('CB8 wrong revision assessment', async (t) => {
  const f = completionFixture(t); await f.ready(); const a = await assess(f);
  assert.notEqual((await boundary()).validateCompletionAssessment(a, { root: f.root, identity: { ...f.identity, revision: 2 } }).status, 'CURRENT');
});
test('CB9 open blocking finding', async (t) => {
  const f = completionFixture(t); await f.ready(); ledger(f, finding()); assert.equal((await assess(f)).decision, 'NOT_ADMISSIBLE');
});
test('CB10 owner reviewed evidence-backed resolution', async (t) => {
  const f = completionFixture(t); await f.ready(); const receipt = await f.prove('finding:F-bug:RESOLVED');
  ledger(f, finding({ status: 'RESOLVED', receiptIds: [receipt.receiptId], resolution: {
    reviewer: 'OWNER', reason: 'Regression check passed', humanDecisionRequired: false,
    goalReference: f.identity, baselineFingerprint: f.state.execution.baseline.fingerprint } }));
  assert.equal((await assess(f)).decision, 'ADMISSIBLE');
});
test('CB11 informational finding', async (t) => {
  const f = completionFixture(t); await f.ready(); ledger(f, finding({ severity: 'INFO', materiality: 'INFORMATIONAL' }));
  const a = await assess(f); assert.equal(a.decision, 'ADMISSIBLE'); assert.ok(a.warnings.some((b) => b.kind === 'FINDING'));
});
for (const [id, materiality, expected] of [['CB12', 'BLOCKING', 'NOT_ADMISSIBLE'], ['CB13', 'NON_BLOCKING', 'ADMISSIBLE']]) {
  test(`${id} proof gap materiality`, async (t) => {
    const f = completionFixture(t); await f.ready();
    f.state.contextMap.proofGaps.push({ id: 'PG-material', claim: 'Proof missing', reason: 'Not observed', requiredEvidence: 'Observed check',
      status: 'OPEN', evidenceIds: [], repository: 'wayper', materiality, relatedRequirementIds: ['SUCCESS:criterion'] }); f.refresh();
    assert.equal((await assess(f)).decision, expected);
  });
}
test('CB14 material ambiguity', async (t) => {
  const f = completionFixture(t); await f.ready();
  f.state.contextMap.ambiguities.push({ code: 'PRODUCT_DECISION', repository: 'wayper', materiality: 'MATERIAL', status: 'OPEN',
    relatedRequirementIds: ['SUCCESS:criterion'], reason: 'Decision missing', receiptIds: [] }); f.refresh();
  assert.equal((await assess(f)).decision, 'NOT_ADMISSIBLE');
});
test('CB15 accepted nonblocking unknown', async (t) => {
  const f = completionFixture(t); await f.ready();
  f.input.criteria = [{ id: 'device', repository: 'wayper', platform: 'android', claim: 'PHYSICAL_DEVICE', required: false, blocking: false }];
  f.input.repositories[0].platforms = ['android']; f.plan(); f.refresh();
  const a = await assess(f); assert.equal(a.decision, 'ADMISSIBLE'); assert.ok(a.acceptedUnknowns.length);
});
test('CB16 fake text', async (t) => {
  const f = completionFixture(t); await f.ready(); f.state.requirements[0].evidence = ['all done']; f.save();
  assert.equal((await assess(f)).decision, 'NOT_ADMISSIBLE');
});
test('CB17 handoff DONE cannot complete a Goal', async (t) => {
  const f = completionFixture(t); f.plan(); await f.validate();
  const a = await (await boundary()).assessGoalCompletion({ root: f.root, identity: f.identity, handoff: { status: 'DONE' } });
  assert.notEqual(a.decision, 'ADMISSIBLE');
});
test('CB18 Stop clean worktree uses connected decision', async (t) => {
  const f = completionFixture(t); f.plan(); await f.validate();
  const result = runBackstop({ root: f.root, files: [], completionIdentity: f.identity });
  assert.equal(result.status, 'FAIL'); assert.equal(JSON.parse(hookResponse(result)).decision, 'block');
});
test('CB19 Stop reentrancy never repeats the block', () => {
  assert.equal(hookResponse({ status: 'FAIL', detail: 'incomplete' }, true), '');
});
test('CB20 amendment invalidates assessment', async (t) => {
  const f = completionFixture(t); await f.ready(); const a = await assess(f);
  f.state = amendWorkingContext({ ...f.options(), existing: f.state, identity: f.identity,
    changes: { requirements: { add: ['SUCCESS:amendment'] } }, reason: 'New material criterion' });
  f.identity = f.state.execution.identity; f.save();
  assert.notEqual((await boundary()).validateCompletionAssessment(a, { root: f.root, identity: f.identity }).status, 'CURRENT');
  assert.notEqual((await assess(f)).decision, 'ADMISSIBLE');
});
test('CB21 cross repo blocker does not leak', async (t) => {
  const f = completionFixture(t, true); await f.ready(); ledger(f, finding({ repository: 'wayper-site' }));
  const a = await assess(f); assert.equal(a.decision, 'NOT_ADMISSIBLE');
  assert.ok(a.blockers.some((b) => b.kind === 'FINDING' && b.repository === 'wayper-site'));
});
test('CB22 COMPLETE validation with blocking finding', async (t) => {
  const f = completionFixture(t); await f.ready(); ledger(f, finding()); const a = await assess(f);
  assert.equal(a.validationState.status, 'COMPLETE'); assert.equal(a.decision, 'NOT_ADMISSIBLE');
});
test('CB23 COMPLETE validation with unproved criterion', async (t) => {
  const f = completionFixture(t); f.plan(); await f.validate(); const a = await assess(f);
  assert.equal(a.validationState.status, 'COMPLETE'); assert.equal(a.decision, 'NOT_ADMISSIBLE');
});
test('CB24 material source change obsoletes assessment', async (t) => {
  const f = completionFixture(t); await f.ready(); const a = await assess(f);
  fs.appendFileSync(path.join(f.root, 'README.md'), 'changed\n');
  assert.equal((await boundary()).validateCompletionAssessment(a, { root: f.root, identity: f.identity }).status, 'STALE');
});
