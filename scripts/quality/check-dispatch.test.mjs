import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { writer } from './dispatch-fixture.mjs';
import { planDispatch, issueGrant } from '../wayper-dispatch.mjs';
import { prepareDispatchPacket, boundPacket } from '../wayper-dispatch-adapters.mjs';
import { issuePermit, executeAction } from '../wayper-dispatch-execution.mjs';
import { readOwnership } from '../wayper-ownership.mjs';
import { dispatchTelemetry } from '../wayper-dispatch-store.mjs';

test('DP2 DP3 DP4 DP9: deterministic native writer and read-only rejection', t => {
  const f = writer(t); assert.deepEqual(f.plan7(), f.plan7());
  assert.equal(f.plan7().ownershipRequirement, true);
  assert.throws(() => planDispatch({ ...f.options7, task: f.task, actor: { actorId: 'reviewer', kind: 'READ_ONLY_SPECIALIST', profileId: 'wayper_concurrency_reviewer' } }), /READ_ONLY_ACTOR/);
  assert.throws(() => planDispatch({ ...f.options7, task: { ...f.task, operation: 'READ', capabilities: ['fake'] },
    actor: { actorId: 'reviewer', kind: 'READ_ONLY_SPECIALIST', profileId: 'wayper_concurrency_reviewer' } }), /NO_ELIGIBLE_ACTOR/);
});
test('MU7 MU10: out-of-scope command effects survive and block continuation despite exit zero', async t => {
  const f = writer(t); const options = await f.authorize();
  const action = { kind: 'COMMAND', command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync("outside.md", "preserve")'],
    mutability: 'MUTATING', target: 'adversarial-scope' };
  const permit = issuePermit({ ...options, action });
  await assert.rejects(() => executeAction({ ...options, action, permitId: permit.permitId }), /SCOPE_VIOLATION/);
  assert.equal(fs.readFileSync(`${f.root}/outside.md`, 'utf8'), 'preserve');
  assert.equal(readOwnership(options).grants.find(g => g.grantId === options.grantId).status, 'PARTIAL');
  t.diagnostic(JSON.stringify(dispatchTelemetry(options)));
});
test('MU10: external edit during command has UNKNOWN_ORIGIN and requires owner reconciliation', async t => {
  const f = writer(t); const options = await f.authorize();
  const action = { kind: 'COMMAND', command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync(".wayper-context/started", "1"); setTimeout(() => {}, 200)'], mutability: 'MUTATING', target: 'concurrent-fixture' };
  const permit = issuePermit({ ...options, action });
  const result = executeAction({ ...options, action, permitId: permit.permitId });
  for (let n = 0; !fs.existsSync(`${f.root}/.wayper-context/started`) && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fs.existsSync(`${f.root}/.wayper-context/started`), true);
  fs.appendFileSync(`${f.root}/README.md`, 'external concurrent change');
  await assert.rejects(() => result, /RECONCILIATION_REQUIRED/);
  const observed = readOwnership(options).permits.find(p => p.permitId === permit.permitId).result;
  assert.equal(observed.origin, 'UNKNOWN_ORIGIN'); assert.match(fs.readFileSync(`${f.root}/README.md`, 'utf8'), /external concurrent change/);
});
test('DP5 DP6 DP7: wrong identity/revision and stale state do not issue grants', t => {
  const f = writer(t); const plan = f.plan7();
  assert.throws(() => issueGrant({ ...f.options7, identity: { ...f.identity, threadId: 'wrong' }, plan }), /identity mismatch/);
  assert.throws(() => issueGrant({ ...f.options7, identity: { ...f.identity, revision: 2 }, plan }), /identity mismatch/);
  fs.appendFileSync(`${f.root}/README.md`, 'external');
  assert.throws(() => issueGrant({ ...f.options7, plan }), /STATE_CHANGED/);
});
test('DP8 DP10 MU2: Packet is not authority; main still requires lease', async t => {
  const f = writer(t); const g = f.grant(); const options = { ...f.options7, grantId: g.grantId, actorId: 'main' };
  const envelope = await prepareDispatchPacket(options);
  const action = { kind: 'WRITE_FILE', file: 'README.md', content: 'governed' };
  assert.throws(() => issuePermit({ ...options, action }), /LEASE_REQUIRED/);
  assert.throws(() => boundPacket(readOwnership(options), { ...options, actorId: 'foreign', envelope }), /ACTOR_MISMATCH|PACKET_DISPATCH_MISMATCH/);
});
test('MU1 MU6 MU8: governed write observed and permit single-use', async t => {
  const f = writer(t); const options = await f.authorize();
  const action = { kind: 'WRITE_FILE', file: 'README.md', content: 'governed\n' };
  const permit = issuePermit({ ...options, action });
  const result = await executeAction({ ...options, action, permitId: permit.permitId });
  assert.equal(result.result.outcome, 'COMPLETE'); assert.equal(result.result.receiptIds.length, 1);
  assert.deepEqual(result.result.affectedPaths, ['README.md']);
  await assert.rejects(() => executeAction({ ...options, action, permitId: permit.permitId }), /PERMIT_CONSUMED/);
});
test('MU5 MU9: stale state and unknown shell mutability fail closed', async t => {
  const f = writer(t); const options = await f.authorize();
  assert.throws(() => issuePermit({ ...options, action: { kind: 'COMMAND', command: 'sh', args: ['-c', 'true'], target: 'check', mutability: 'UNKNOWN' } }), /UNKNOWN_MUTABILITY/);
  const action = { kind: 'WRITE_FILE', file: 'README.md', content: 'governed' };
  const permit = issuePermit({ ...options, action }); fs.appendFileSync(`${f.root}/README.md`, 'external');
  await assert.rejects(() => executeAction({ ...options, action, permitId: permit.permitId }), /STATE_CHANGED/);
  assert.match(fs.readFileSync(`${f.root}/README.md`, 'utf8'), /external/);
  t.diagnostic(JSON.stringify(dispatchTelemetry(options)));
});
