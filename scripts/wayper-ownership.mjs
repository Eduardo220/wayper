import crypto from 'node:crypto';
import { currentGrant } from './wayper-dispatch.mjs';
import { dispatchOwner, overlap } from './wayper-dispatch-scope.mjs';
import { readOwnership, seal, checkSeal, transact, event, observedBoundary } from './wayper-dispatch-store.mjs';
import { assertSameIdentity } from './wayper-context-identity.mjs';
export { readOwnership };
const uncertain = g => ['ACTING', 'UNKNOWN_OUTCOME', 'PARTIAL'].includes(g?.status);
const ttl = o => { const n = o.ttlMs ?? 60_000; if (!Number.isSafeInteger(n) || n < 10 || n > 300_000) throw new Error('INVALID_TTL'); return n; };
export function checkedLease(store, options) {
  const lease = store.leases.find(l => l.leaseId === options.leaseId);
  if (!lease) throw new Error('LEASE_REQUIRED');
  checkSeal(lease, 'schemaVersion leaseId goalReference taskReference actorReference grantId repository scopes generation fencingToken acquiredAt renewedAt expiresAt state');
  assertSameIdentity(lease.goalReference, options.identity);
  dispatchOwner(options, lease.repository, lease.scopes);
  if (lease.actorReference.actorId !== options.actorId) throw new Error('ACTOR_MISMATCH');
  if (lease.generation !== options.expectedGeneration) throw new Error('CAS_MISMATCH');
  if (lease.fingerprint !== options.expectedFingerprint) throw new Error('CAS_MISMATCH');
  if (lease.fencingToken !== options.fencingToken || lease.state === 'RECLAIMED') throw new Error('STALE_FENCE');
  return lease;
}
function expectedLease(store, options) {
  const lease = store.leases.find(l => l.leaseId === options.leaseId);
  if (!lease) throw new Error('LEASE_REQUIRED');
  checkSeal(lease, 'schemaVersion leaseId goalReference taskReference actorReference grantId repository scopes generation fencingToken acquiredAt renewedAt expiresAt state');
  assertSameIdentity(lease.goalReference, options.identity);
  if (lease.generation !== options.expectedGeneration || lease.fingerprint !== options.expectedFingerprint) throw new Error('CAS_MISMATCH');
  if (lease.fencingToken !== options.fencingToken || lease.state === 'RECLAIMED') throw new Error('STALE_FENCE');
  return lease;
}
function mainRequester(store, options) {
  const { grant } = currentGrant(store, { ...options, grantId: options.requesterGrantId, actorId: options.requesterActorId });
  if (grant.actorReference.kind !== 'MAIN_OWNER') throw new Error('RECLAIM_REQUESTER_DENIED');
  return grant;
}
export function fence(store, grant) {
  const lease = store.leases.find(l => l.leaseId === grant.ownershipReference);
  if (!lease) throw new Error('LEASE_REQUIRED');
  if (lease.fencingToken !== grant.fencingToken || lease.state === 'RECLAIMED' || store.leases.some(l =>
    l.repository === lease.repository && l.generation > lease.generation && overlap(l.scopes, lease.scopes))) throw new Error('STALE_FENCE');
  if (lease.state !== 'ACTIVE' || lease.expiresAt <= Date.now()) throw new Error('LEASE_EXPIRED');
  return lease;
}
export function acquireLease(options) {
  const duration = ttl(options);
  return observedBoundary(options, () => transact(options, store => {
    const { grant, owner } = currentGrant(store, options);
    if (grant.actorReference.readOnly || !grant.authorization.includes('MUTATE_FILES') || grant.taskReference.operation !== 'MUTATE') throw new Error('READ_ONLY_ACTOR');
    if (grant.ownershipReference) throw new Error('LEASE_ALREADY_ACQUIRED');
    if (owner.stateFingerprint !== grant.stateFingerprint) throw new Error('STATE_CHANGED');
    const task = grant.taskReference;
    if (store.completionRequests.some(r => ['REQUESTING', 'UNKNOWN_OUTCOME', 'REQUESTED'].includes(r.status) && r.repositories.includes(task.repository))) throw new Error('COMPLETION_IN_FLIGHT');
    for (const lease of store.leases.filter(l => l.repository === task.repository && overlap(l.scopes, task.scopes))) {
      if (['RELEASED', 'RECLAIMED'].includes(lease.state)) continue;
      if (lease.expiresAt > Date.now()) throw new Error('CONFLICT');
      if (uncertain(store.grants.find(g => g.grantId === lease.grantId))) throw new Error('RECONCILIATION_REQUIRED');
      throw new Error('EXPIRED_LEASE_RECLAIM_REQUIRED');
    }
    if (store.grants.some(g => g.taskReference.operation === 'READ' && ['ACTIVE', 'ACTING'].includes(g.status) &&
      (g.expiresAt > Date.now() || g.status === 'ACTING') && g.taskReference.repository === task.repository && overlap(g.taskReference.scopes, task.scopes))) throw new Error('READER_ACTIVE');
    const generation = ++store.generation;
    const lease = seal({ schemaVersion: 1, leaseId: `OL-${crypto.randomUUID()}`, goalReference: grant.goalReference,
      taskReference: task, actorReference: grant.actorReference, grantId: grant.grantId, repository: task.repository, scopes: task.scopes,
      generation, fencingToken: generation, acquiredAt: Date.now(), renewedAt: Date.now(), expiresAt: Date.now() + duration, state: 'ACTIVE' });
    grant.ownershipReference = lease.leaseId; grant.fencingToken = generation; Object.assign(grant, seal(grant));
    store.leases.push(lease); event(store, 'ACQUIRED', lease.leaseId); return lease;
  }));
}
export function renewLease(options) {
  return transact(options, store => {
    const lease = checkedLease(store, options);
    if (lease.state !== 'ACTIVE' || lease.expiresAt <= Date.now()) throw new Error('LEASE_EXPIRED');
    lease.renewedAt = Date.now(); lease.expiresAt = Date.now() + ttl(options);
    Object.assign(lease, seal(lease)); event(store, 'RENEWED', lease.leaseId); return lease;
  });
}
export function releaseLease(options) {
  return transact(options, store => {
    const lease = checkedLease(store, options); const grant = store.grants.find(g => g.grantId === lease.grantId);
    if (uncertain(grant)) throw new Error('RECONCILIATION_REQUIRED');
    lease.state = 'RELEASED'; Object.assign(lease, seal(lease));
    grant.status = 'CLOSED'; Object.assign(grant, seal(grant));
    event(store, 'RELEASED', lease.leaseId); return lease;
  });
}
export function reclaimLease(options) {
  return transact(options, store => {
    mainRequester(store, options);
    const lease = expectedLease(store, options); const grant = store.grants.find(g => g.grantId === lease.grantId);
    if (lease.expiresAt > Date.now() || !['ACTIVE', 'EXPIRED'].includes(lease.state)) throw new Error('LEASE_NOT_EXPIRED');
    if (uncertain(grant)) throw new Error('RECONCILIATION_REQUIRED');
    const owner = dispatchOwner(options, lease.repository, lease.scopes);
    if (owner.stateFingerprint !== grant.stateFingerprint) throw new Error('EXTERNAL_CHANGE_DETECTED');
    const wasActive = lease.state === 'ACTIVE';
    lease.state = 'RECLAIMED'; Object.assign(lease, seal(lease));
    grant.status = 'REVOKED'; Object.assign(grant, seal(grant));
    if (wasActive) event(store, 'EXPIRED', lease.leaseId);
    event(store, 'RECLAIMED', lease.leaseId); return lease;
  });
}
export function expireLease(options) {
  return transact(options, store => {
    const lease = checkedLease(store, options);
    if (lease.expiresAt > Date.now() || lease.state !== 'ACTIVE') throw new Error('LEASE_NOT_EXPIRED');
    lease.state = 'EXPIRED'; Object.assign(lease, seal(lease)); event(store, 'EXPIRED', lease.leaseId); return lease;
  });
}
// Explicit owner reconciliation never repeats an action. A stopped executor is a required human/host fact.
export function reconcileGrant(options) {
  return transact(options, store => {
    mainRequester(store, options);
    const grant = store.grants.find(g => g.grantId === options.grantId);
    if (!grant) throw new Error('GRANT_REQUIRED');
    checkSeal(grant, 'schemaVersion grantId dispatchPlanId goalReference taskReference actorReference authorization ownershipReference stateFingerprint issuedAt expiresAt fencingToken status packetReference');
    assertSameIdentity(grant.goalReference, options.identity);
    const lease = store.leases.find(l => l.leaseId === grant.ownershipReference);
    if (!lease || lease.fingerprint !== options.expectedLeaseFingerprint) throw new Error('CAS_MISMATCH');
    const owner = dispatchOwner(options, grant.taskReference.repository, grant.taskReference.scopes);
    if (!options.executorStopped || !options.reason?.trim() || options.expectedStateFingerprint !== owner.stateFingerprint ||
      options.expectedGrantFingerprint !== grant.fingerprint) throw new Error('RECONCILIATION_REQUIRED');
    grant.status = 'RECONCILED'; grant.stateFingerprint = owner.stateFingerprint; Object.assign(grant, seal(grant));
    event(store, 'RECONCILED', grant.grantId); return grant;
  });
}
export function ownershipProblemsInStore(store, identity) {
  return [...store.grants.filter(g => g.goalReference.goalRunId === identity.goalRunId &&
    (uncertain(g) || g.taskReference.operation === 'MUTATE' && ['ACTIVE', 'HANDED_OFF'].includes(g.status))).map(g => ({
    reference: g.grantId, repository: g.taskReference.repository,
    reasonCode: ['ACTIVE', 'HANDED_OFF', 'ACTING'].includes(g.status) ? 'OWNERSHIP_IN_FLIGHT' : 'OWNERSHIP_RECONCILIATION_REQUIRED' })),
    ...store.leases.filter(l => l.goalReference.goalRunId === identity.goalRunId && ['ACTIVE', 'EXPIRED'].includes(l.state)).map(l => ({
      reference: l.leaseId, repository: l.repository, reasonCode: l.expiresAt <= Date.now() ? 'OWNERSHIP_LEASE_EXPIRED' : 'OWNERSHIP_LEASE_OPEN' }))];
}
export function ownershipSnapshot(options) {
  const store = readOwnership(options);
  const problems = ownershipProblemsInStore(store, options.identity);
  return { fingerprint: store.fingerprint, problems };
}
export const ownershipProblems = options => ownershipSnapshot(options).problems;
export const ownershipBlockers = options => ownershipProblems(options).map(p => p.reference);
export function interruptGrant(options) {
  return transact(options, store => {
    const { grant } = currentGrant(store, options, { active: false });
    if (grant.status !== 'ACTING' || grant.fingerprint !== options.expectedGrantFingerprint) throw new Error('CAS_MISMATCH');
    grant.status = 'UNKNOWN_OUTCOME'; Object.assign(grant, seal(grant)); event(store, 'INTERRUPTED', grant.grantId); return grant;
  });
}
export function revokeGrant(options) {
  return transact(options, store => {
    const { grant } = currentGrant(store, options, { active: false });
    if (uncertain(grant)) throw new Error('RECONCILIATION_REQUIRED');
    if (grant.fingerprint !== options.expectedGrantFingerprint) throw new Error('CAS_MISMATCH');
    const lease = store.leases.find(l => l.leaseId === grant.ownershipReference);
    if (lease) { lease.state = 'RELEASED'; Object.assign(lease, seal(lease)); }
    grant.status = 'REVOKED'; Object.assign(grant, seal(grant)); event(store, 'REVOKED', grant.grantId); return grant;
  });
}
export function reconcileStaleOwnership(options) {
  return transact(options, store => {
    mainRequester(store, options);
    const grant = store.grants.find(g => g.grantId === options.grantId);
    const lease = store.leases.find(l => l.leaseId === grant?.ownershipReference);
    if (!grant || !lease || grant.fingerprint !== options.expectedGrantFingerprint || lease.fingerprint !== options.expectedFingerprint ||
      grant.goalReference.goalRunId !== options.identity.goalRunId || grant.goalReference.threadId !== options.identity.threadId ||
      grant.goalReference.revision >= options.identity.revision ||
      !options.executorStopped || !options.reason?.trim()) throw new Error('RECONCILIATION_REQUIRED');
    const owner = dispatchOwner(options, lease.repository, lease.scopes);
    if (owner.stateFingerprint !== options.expectedStateFingerprint) throw new Error('STATE_CHANGED');
    grant.status = 'RECONCILED'; Object.assign(grant, seal(grant));
    lease.state = 'RELEASED'; Object.assign(lease, seal(lease));
    event(store, 'STALE_REVISION_RECONCILED', lease.leaseId); return lease;
  });
}
