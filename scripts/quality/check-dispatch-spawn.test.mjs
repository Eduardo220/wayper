import test from 'node:test';
import assert from 'node:assert/strict';
import { reader } from './dispatch-fixture.mjs';
import { dispatchSpawn, consumeDispatchHandoff } from '../wayper-dispatch-adapters.mjs';
import { issuePermit, executeAction } from '../wayper-dispatch-execution.mjs';
import { acquireLease, readOwnership } from '../wayper-ownership.mjs';
import { buildStructuredHandoff } from '../wayper-structured-handoff.mjs';
import { planDispatch, issueGrant } from '../wayper-dispatch.mjs';
import { dispatchTelemetry } from '../wayper-dispatch-store.mjs';

test('DP1 SP1 SP2 SP3 SP4 SP6 OW6: eligible specialist, depth/slots/Packet gates and no mutation', async t => {
  const f = reader(t); const options = await f.readerOptions(); let calls = 0;
  const spawn = async request => { calls++; assert.equal(request.depth, 1); assert.equal(request.descendants, 0); assert.equal(request.readOnly, true); return { id: 'fixture-actor' }; };
  const args = { ...options, depth: 0, slotLimit: 4, hostActiveSlots: 1, spawn };
  assert.equal((await dispatchSpawn({ ...args, depth: 1 })).status, 'DENIED_MAX_DEPTH');
  assert.equal((await dispatchSpawn({ ...args, parentGrantId: options.grantId, parentActorId: options.actorId })).status, 'DENIED_MAX_DEPTH');
  assert.equal((await dispatchSpawn({ ...args, hostActiveSlots: 4 })).status, 'SLOT_EXHAUSTED');
  assert.equal((await dispatchSpawn({ ...args, envelope: { ...options.envelope, actorId: 'wrong' } })).status, 'SPAWN_DENIED');
  assert.equal((await dispatchSpawn({ ...args, spawn: undefined })).status, 'SPAWN_UNAVAILABLE');
  assert.equal(readOwnership(options).grants.find(g => g.grantId === options.grantId).status, 'ACTIVE');
  assert.throws(() => acquireLease(options), /READ_ONLY_ACTOR/);
  assert.throws(() => issuePermit({ ...options, action: { kind: 'WRITE_FILE', file: 'README.md', content: 'trusted specialist' } }), /READ_ONLY_ACTOR/);
  assert.throws(() => issuePermit({ ...options, action: { kind: 'COMMAND', command: 'sh', args: ['-c', 'true'],
    mutability: 'READ_ONLY', target: 'trusted specialist shell' } }), /READ_ONLY_EXECUTOR_REQUIRED/);
  assert.equal((await dispatchSpawn(args)).status, 'SPAWNED'); assert.equal(calls, 1);
  assert.equal(readOwnership(options).leases.length, 0);
  t.diagnostic(JSON.stringify(dispatchTelemetry(options)));
});
test('MULTI ACTOR: two governed readers coexist and defer overlapping writer', async t => {
  const f = reader(t); const first = await f.readerOptions();
  f.actor.actorId = 'specialist-two'; const second = await f.readerOptions();
  assert.notEqual(first.grantId, second.grantId);
  const task = { ...f.task, operation: 'MUTATE' };
  const plan = planDispatch({ ...f.options7, task, actor: { actorId: 'main', kind: 'MAIN_OWNER' } });
  const grant = issueGrant({ ...f.options7, plan });
  assert.throws(() => acquireLease({ ...f.options7, grantId: grant.grantId }), /READER_ACTIVE/);
  const args = { depth: 0, slotLimit: 4, hostActiveSlots: 1, spawn: async () => ({ fixture: true }) };
  assert.equal((await dispatchSpawn({ ...args, ...first })).status, 'SPAWNED');
  assert.equal((await dispatchSpawn({ ...args, ...second })).status, 'SPAWNED');
});
test('SP7 SP8 read-only circuit: action receipt, Structured Handoff, owner merge; unrelated dispatch denied', async t => {
  const f = reader(t); const options = await f.readerOptions(); const packet = options.envelope.packet;
  const action = { kind: 'READ_FILE', file: 'README.md' }; const permit = issuePermit({ ...options, action });
  const result = await executeAction({ ...options, action, permitId: permit.permitId });
  assert.equal(result.result.outcome, 'COMPLETE');
  const draft = { schemaVersion: 1, goalId: packet.goalId, taskId: f.task.taskId, agentId: packet.target.id,
    packetId: packet.packetId, status: 'NO_FINDINGS', confidence: 0.8, coverage: ['route-geometry'], findings: [], evidenceRefs: [],
    newEvidence: [], risks: ['GPS_GEO'], recommendations: [], filesRead: [], filesChanged: [], tests: [], proofGaps: [], ambiguities: [], blockers: [], metrics: {} };
  const handoff = { schemaVersion: 1, taskId: f.task.taskId, grantId: options.grantId, actorId: options.actorId,
    packetId: packet.packetId, descendants: 0, authority: 'NONE', result: buildStructuredHandoff(draft, { packet }) };
  assert.throws(() => consumeDispatchHandoff({ ...options, handoff: { ...handoff, grantId: 'other' } }), /HANDOFF_DISPATCH_MISMATCH/);
  assert.throws(() => consumeDispatchHandoff({ ...options, handoff: { ...handoff, descendants: 1 } }), /HANDOFF_DISPATCH_MISMATCH/);
  const accepted = consumeDispatchHandoff({ ...options, handoff });
  assert.equal(accepted.status, 'ACCEPTED'); assert.equal(accepted.merge.ownerAction, 'CONTEXT_MAP_OWNER_REVIEW_REQUIRED');
});
