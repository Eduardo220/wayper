import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { writer } from './dispatch-fixture.mjs';
import { acquireLease, renewLease, releaseLease, readOwnership } from '../wayper-ownership.mjs';
import { planDispatch } from '../wayper-dispatch.mjs';
import { overlap } from '../wayper-dispatch-scope.mjs';
import { seal } from '../wayper-dispatch-store.mjs';

test('OW1 OW2 OW5: free acquisition and conflicting repository scope', (t) => {
  const f = writer(t); const a = f.grant(); const lease = acquireLease({ ...f.options7, grantId: a.grantId });
  assert.equal(lease.state, 'ACTIVE');
  const b = f.grant();
  assert.throws(() => acquireLease({ ...f.options7, grantId: b.grantId }), /CONFLICT/);
});
test('OW3 OW4 OW5: parent-child/repository overlap; disjoint leases allowed but no automatic write parallelism', t => {
  assert.equal(overlap([{ kind: 'PATH_PREFIX', path: 'docs' }], [{ kind: 'FILE', path: 'docs/a.md' }]), true);
  assert.equal(overlap([{ kind: 'FILE', path: 'a' }], [{ kind: 'FILE', path: 'ab' }]), false);
  const f = writer(t); acquireLease({ ...f.options7, grantId: f.grant().grantId });
  f.task.scopes = [{ kind: 'FILE', path: 'other.md' }]; assert.equal(acquireLease({ ...f.options7, grantId: f.grant().grantId }).state, 'ACTIVE');
  f.task.scopes = [{ kind: 'REPOSITORY', path: '.' }]; assert.throws(() => acquireLease({ ...f.options7, grantId: f.grant().grantId }), /CONFLICT/);
});
test('OW14 OW15: wrong repository and revision deny lease authority', t => {
  const f = writer(t); const g = f.grant();
  assert.throws(() => acquireLease({ ...f.options7, identity: { ...f.identity, revision: 2 }, grantId: g.grantId }), /identity mismatch/);
  assert.throws(() => planDispatch({ ...f.options7, task: { ...f.task, repository: 'wayper-site' }, actor: { actorId: 'main', kind: 'MAIN_OWNER' } }), /WRONG_REPOSITORY/);
});
test('OW7 OW8 OW9: renew CAS and release actor binding', (t) => {
  const f = writer(t); const g = f.grant(); const lease = acquireLease({ ...f.options7, grantId: g.grantId });
  const input = { ...f.options7, leaseId: lease.leaseId, actorId: 'main', expectedGeneration: lease.generation, expectedFingerprint: lease.fingerprint, fencingToken: lease.fencingToken };
  assert.throws(() => renewLease({ ...input, expectedGeneration: 0 }), /CAS_MISMATCH/);
  assert.throws(() => releaseLease({ ...input, actorId: 'other' }), /ACTOR_MISMATCH/);
  const renewed = renewLease(input); assert.equal(renewed.state, 'ACTIVE');
  assert.throws(() => renewLease(input), /CAS_MISMATCH/);
  assert.equal(releaseLease({ ...input, expectedFingerprint: renewed.fingerprint }).state, 'RELEASED');
  assert.equal(readOwnership(f.options7).leases.filter(l => l.state === 'ACTIVE').length, 0);
});
test('OW13: path escape and symlink rejected', (t) => {
  const f = writer(t); f.task.scopes[0].path = '../foreign'; assert.throws(f.plan7, /UNSAFE/);
  fs.symlinkSync('/tmp', `${f.root}/link`); f.task.scopes[0].path = 'link/file'; assert.throws(f.plan7, /UNSAFE/);
});
test('CROSS REPO: ownerships compose by repository without pretending atomic commit', t => {
  const f = writer(t, {}, true);
  const mobile = acquireLease({ ...f.options7, grantId: f.grant().grantId });
  f.task = { ...f.task, taskId: 'task-site', repository: 'wayper-site' };
  const site = acquireLease({ ...f.options7, grantId: f.grant().grantId });
  assert.equal(mobile.repository, 'wayper');
  assert.equal(site.repository, 'wayper-site');
  assert.notEqual(mobile.leaseId, site.leaseId);
});
test('SITE WIP: pre-existing dirty site denies writer dispatch without cleanup', t => {
  const f = writer(t, {}, true);
  f.task = { ...f.task, taskId: 'task-site-dirty', repository: 'wayper-site' };
  fs.appendFileSync(`${f.repositories[1].root}/README.md`, 'external work\n');
  assert.throws(f.plan7, /EXTERNAL_CHANGE_PRESENT/);
  assert.match(fs.readFileSync(`${f.repositories[1].root}/README.md`, 'utf8'), /external work/);
});
test('OWNERSHIP STORE: nested closed schemas reject tampering even with a resealed journal', t => {
  const f = writer(t); f.grant();
  const file = `${f.root}/.wayper-context/ownership/state.json`;
  const store = JSON.parse(fs.readFileSync(file, 'utf8'));
  store.grants[0].actorReference.actorId = 'intruder';
  fs.writeFileSync(file, JSON.stringify(seal(store)));
  assert.throws(() => readOwnership(f.options7), /INVALID_DISPATCH_SCHEMA/);
});
