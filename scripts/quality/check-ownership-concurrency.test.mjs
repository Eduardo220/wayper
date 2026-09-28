import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writer } from './dispatch-fixture.mjs';
import { acquireLease, reclaimLease, reconcileGrant, readOwnership } from '../wayper-ownership.mjs';
import { prepareDispatchPacket } from '../wayper-dispatch-adapters.mjs';
import { issuePermit, executeAction } from '../wayper-dispatch-execution.mjs';
import { dispatchOwner } from '../wayper-dispatch-scope.mjs';
import { planDispatch, issueGrant } from '../wayper-dispatch.mjs';
import { dispatchTelemetry } from '../wayper-dispatch-store.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const leaseInput = (f, l, requester) => ({ ...f.options7, leaseId: l.leaseId, expectedGeneration: l.generation,
  expectedFingerprint: l.fingerprint, fencingToken: l.fencingToken, requesterGrantId: requester.grantId, requesterActorId: 'main' });
test('OW12: six real processes race; exactly one owner and five conflicts', async t => {
  const f = writer(t); const grants = Array.from({ length: 6 }, () => f.grant());
  const module = new URL('../wayper-ownership.mjs', import.meta.url).href;
  const children = grants.map(g => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs'; import {acquireLease} from ${JSON.stringify(module)};
      const o=JSON.parse(fs.readFileSync(0,'utf8')); try { process.stdout.write(JSON.stringify({status:'ACQUIRED',lease:acquireLease(o)})); }
      catch(e) { process.stdout.write(JSON.stringify({status:e.message})); }`], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let error = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => error += c);
    const result = new Promise((resolve, reject) => child.on('close', code => code ? reject(new Error(error)) : resolve(JSON.parse(output))));
    return { child, result, g };
  });
  for (const { child, g } of children) child.stdin.end(JSON.stringify({ ...f.options7, grantId: g.grantId }));
  const results = await Promise.all(children.map(c => c.result));
  assert.equal(results.filter(r => r.status === 'ACQUIRED').length, 1); assert.equal(results.filter(r => r.status === 'CONFLICT').length, 5);
  assert.equal(readOwnership(f.options7).leases.length, 1);
  t.diagnostic(JSON.stringify({ contenders: 6, winners: 1, conflicts: 5,
    generation: results.find(r => r.lease).lease.generation, telemetry: dispatchTelemetry(f.options7) }));
});
test('OW10 OW11 MU3 MU4: expired reclaim increases generation and fences zombie', async t => {
  const f = writer(t); const a = f.grant();
  const envelope = await prepareDispatchPacket({ ...f.options7, grantId: a.grantId });
  const l = acquireLease({ ...f.options7, grantId: a.grantId, ttlMs: 400 });
  const options = { ...f.options7, grantId: a.grantId, actorId: 'main', envelope };
  const action = { kind: 'WRITE_FILE', file: 'README.md', content: 'zombie' };
  const permit = issuePermit({ ...options, action });
  await sleep(420);
  assert.throws(() => issuePermit({ ...options, action }), /LEASE_EXPIRED/);
  const b = f.grant(); reclaimLease(leaseInput(f, l, b)); const next = acquireLease({ ...f.options7, grantId: b.grantId });
  assert.ok(next.generation > l.generation);
  assert.throws(() => issuePermit({ ...options, action }), /STALE_FENCE/);
  await assert.rejects(() => executeAction({ ...options, action, permitId: permit.permitId }), /STALE_FENCE/);
  t.diagnostic(`zombie ${l.generation} -> owner ${next.generation}: STALE_FENCE`);
  t.diagnostic(JSON.stringify(dispatchTelemetry(options)));
});
test('CRASH DF3 DF4: MAIN_OWNER reconciles crashed NATIVE_WRITER before reclaim', async t => {
  const f = writer(t); const actor = { actorId: 'writer-a', kind: 'NATIVE_WRITER' };
  const a = issueGrant({ ...f.options7, plan: planDispatch({ ...f.options7, task: f.task, actor }) });
  const writerOptions = { ...f.options7, actorId: actor.actorId, grantId: a.grantId };
  const envelope = await prepareDispatchPacket(writerOptions);
  const lease = acquireLease({ ...writerOptions, ttlMs: 500 });
  const options = { ...writerOptions, envelope, lease };
  const action = { kind: 'WRITE_FILE', file: 'README.md', content: 'interrupted' };
  const permit = issuePermit({ ...options, action });
  const module = new URL('../wayper-dispatch-execution.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs'; import {beginAction} from ${JSON.stringify(module)};
    beginAction(JSON.parse(fs.readFileSync(0,'utf8'))); process.kill(process.pid, 'SIGKILL');`], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(JSON.stringify({ ...options, action, permitId: permit.permitId }));
  await new Promise(resolve => child.on('close', resolve));
  const g = readOwnership(options).grants.find(g => g.grantId === options.grantId);
  assert.equal(g.status, 'ACTING');
  await sleep(Math.max(1, lease.expiresAt - Date.now() + 20));
  const b = f.grant();
  assert.throws(() => acquireLease({ ...f.options7, grantId: b.grantId }), /RECONCILIATION_REQUIRED/);
  assert.throws(() => reconcileGrant({ ...options, requesterGrantId: b.grantId, requesterActorId: 'main',
    expectedGrantFingerprint: g.fingerprint, expectedLeaseFingerprint: lease.fingerprint }), /RECONCILIATION_REQUIRED/);
  await assert.rejects(() => executeAction({ ...options, action, permitId: permit.permitId }), /PERMIT_CONSUMED/);
  const snapshot = dispatchOwner(options, 'wayper', g.taskReference.scopes);
  assert.equal(reconcileGrant({ ...options, requesterGrantId: b.grantId, requesterActorId: 'main',
    expectedGrantFingerprint: g.fingerprint, expectedLeaseFingerprint: lease.fingerprint, expectedStateFingerprint: snapshot.stateFingerprint,
    executorStopped: true, reason: 'Observed child SIGKILL; inspected current files; no retry' }).status, 'RECONCILED');
  reclaimLease(leaseInput(f, lease, b));
  assert.ok(acquireLease({ ...f.options7, grantId: b.grantId }).generation > lease.generation);
});
