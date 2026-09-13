import test from 'node:test';
import assert from 'node:assert/strict';
import { writer } from './dispatch-fixture.mjs';
import { issuePermit, executeAction, beginAction } from '../wayper-dispatch-execution.mjs';
import { consumeDispatchHandoff, requestGoalCompletion } from '../wayper-dispatch-adapters.mjs';
import { releaseLease, readOwnership, interruptGrant } from '../wayper-ownership.mjs';
import { assessGoalCompletion } from '../wayper-completion-boundary.mjs';
import { readWorkingContext } from '../wayper-context.mjs';
import { planDispatch, issueGrant } from '../wayper-dispatch.mjs';

test('FULL CIRCUIT DC1: task -> grant -> lease -> Packet -> permit -> write -> Evidence -> Handoff -> Validation -> Completion', async t => {
  const f = writer(t); const options = await f.authorize();
  const action = { kind: 'WRITE_FILE', file: 'README.md', content: '# Governed fixture\n' };
  const permit = issuePermit({ ...options, action }); const result = await executeAction({ ...options, action, permitId: permit.permitId });
  const handoff = { schemaVersion: 1, taskId: f.task.taskId, grantId: options.grantId, actorId: options.actorId,
    packetId: options.envelope.packet.packetId, descendants: 0, authority: 'NONE', result: {
      affectedPaths: result.result.affectedPaths, actionPermits: [permit.permitId], resultingStateFingerprint: result.result.resultingStateFingerprint,
      checks: [], unresolvedIssues: [] } };
  assert.equal(consumeDispatchHandoff({ ...options, handoff }).status, 'ACCEPTED');
  releaseLease({ ...options, leaseId: options.lease.leaseId, expectedGeneration: options.lease.generation, expectedFingerprint: options.lease.fingerprint, fencingToken: options.lease.fencingToken });
  f.state = readWorkingContext(f.root, { 'thread-id': f.identity.threadId, 'goal-run-id': f.identity.goalRunId, revision: 1 });
  await f.ready(); let hostCalls = 0;
  const requested = await requestGoalCompletion({ ...f.options7, requesterGrantId: options.grantId,
    requester: { actorId: 'main', kind: 'MAIN_OWNER' }, requestHostDone: async () => { hostCalls++; return 'fixture-host-ack'; } });
  assert.equal(requested.status, 'REQUESTED'); assert.equal(hostCalls, 1);
  assert.equal(readOwnership(options).leases.filter(l => l.state === 'ACTIVE').length, 0);
  t.diagnostic(JSON.stringify(readOwnership(options).metrics));
});
test('DC2 DC3 DC4 DC5 DC6: Completion rejects ACTING/unknown, stale Goal and Handoff authority', async t => {
  const f = writer(t); await f.ready(); assert.equal(assessGoalCompletion(f.options7).decision, 'ADMISSIBLE');
  await assert.rejects(() => requestGoalCompletion({ ...f.options7,
    requester: { actorId: 'main', kind: 'MAIN_OWNER' } }), /GRANT_REQUIRED/);
  const requester = f.grant();
  assert.notEqual(assessGoalCompletion(f.options7).decision, 'ADMISSIBLE');
  const options = await f.authorize(); const action = { kind: 'WRITE_FILE', file: 'README.md', content: 'pending' };
  const permit = issuePermit({ ...options, action }); beginAction({ ...options, action, permitId: permit.permitId });
  assert.notEqual(assessGoalCompletion(options).decision, 'ADMISSIBLE');
  await assert.rejects(() => requestGoalCompletion({ ...options, requesterGrantId: requester.grantId,
    requester: { actorId: 'main', kind: 'MAIN_OWNER' } }), /COMPLETION_NOT_ADMISSIBLE/);
  const current = readOwnership(options).grants.find(g => g.grantId === options.grantId);
  assert.equal(interruptGrant({ ...options, expectedGrantFingerprint: current.fingerprint }).status, 'UNKNOWN_OUTCOME');
  await assert.rejects(() => requestGoalCompletion({ ...options, requesterGrantId: requester.grantId,
    requester: { actorId: 'main', kind: 'MAIN_OWNER' } }), /COMPLETION_NOT_ADMISSIBLE/);
  await assert.rejects(() => requestGoalCompletion({ ...options, identity: { ...f.identity, revision: 2 }, requesterGrantId: requester.grantId,
    requester: { actorId: 'main', kind: 'MAIN_OWNER' } }), /identity mismatch/);
  await assert.rejects(() => requestGoalCompletion({ ...options, requester: { actorId: 'specialist', kind: 'READ_ONLY_SPECIALIST' }, handoff: 'DONE' }), /REQUESTER_DENIED/);
});
test('DC completion reservation prevents a writer acquiring between assessment and host callback', async t => {
  const f = writer(t); await f.ready();
  const requesterTask = { ...f.task, taskId: 'completion-requester', operation: 'READ' };
  const requester = issueGrant({ ...f.options7, plan: planDispatch({ ...f.options7, task: requesterTask,
    actor: { actorId: 'main', kind: 'MAIN_OWNER' } }) });
  const result = await requestGoalCompletion({ ...f.options7, requesterGrantId: requester.grantId,
    requester: { actorId: 'main', kind: 'MAIN_OWNER' }, requestHostDone: async () => {
    assert.throws(f.grant, /COMPLETION_IN_FLIGHT/);
    return 'observed fixture callback';
  } });
  assert.equal(result.status, 'REQUESTED');
});
