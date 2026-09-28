import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { contextStoreFile, writeContextArtifact } from './wayper-completion-store.mjs';
import { digest, exact } from './wayper-validation-policy.mjs';

export const seal = (value) => { const { fingerprint: _old, ...body } = value; return { ...body, fingerprint: digest(body) }; };
export function checkSeal(value, keys) {
  if (!exact(value, `${keys} fingerprint`) || value.fingerprint !== seal(value).fingerprint) throw new Error('INVALID_DISPATCH_SCHEMA');
}
const empty = () => seal({ schemaVersion: 1, sequence: 0, generation: 0, plans: [], grants: [], leases: [], permits: [], completionRequests: [], events: [], metrics: {} });
const storePath = (root) => contextStoreFile(root, 'ownership', ['state.json']);
const schemas = {
  plans: 'schemaVersion planId goalReference baselineReference taskReference candidates selectedActor authorization ownershipRequirement stateFingerprint routerReference contextPacketReference reasonCodes',
  grants: 'schemaVersion grantId dispatchPlanId goalReference taskReference actorReference authorization ownershipReference stateFingerprint issuedAt expiresAt fencingToken status packetReference',
  leases: 'schemaVersion leaseId goalReference taskReference actorReference grantId repository scopes generation fencingToken acquiredAt renewedAt expiresAt state',
  permits: 'schemaVersion permitId grantId actorId leaseId fencingToken actionFingerprint mutability expectedStateFingerprint status executionClaimed result',
  completionRequests: 'schemaVersion requestId goalReference actorId requesterGrantId assessmentId repositories status',
};
export function readOwnership({ root }) {
  const file = storePath(root);
  if (!fs.existsSync(file)) return empty();
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  checkSeal(value, 'schemaVersion sequence generation plans grants leases permits completionRequests events metrics');
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.sequence) || !Number.isSafeInteger(value.generation) ||
    !['plans', 'grants', 'leases', 'permits', 'completionRequests', 'events'].every(k => Array.isArray(value[k]))) throw new Error('INVALID_OWNERSHIP_STORE');
  for (const [collection, keys] of Object.entries(schemas)) for (const item of value[collection]) checkSeal(item, keys);
  if (value.events.some(e => !exact(e, 'kind reference at') || typeof e.kind !== 'string' ||
    !Number.isSafeInteger(e.at)) || !value.metrics || Array.isArray(value.metrics) ||
    Object.values(value.metrics).some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('INVALID_OWNERSHIP_STORE');
  return value;
}
export function event(store, kind, reference = null) {
  store.metrics[kind] = (store.metrics[kind] ?? 0) + 1;
  store.events.push({ kind, reference, at: Date.now() });
  store.events = store.events.slice(-128);
}
export function observedBoundary(options, action) {
  try { return action(); }
  catch (error) {
    transact(options, store => {
      event(store, 'dispatchesDenied', error.message);
      if (error.message === 'CONFLICT') event(store, 'CONFLICT');
      if (error.message === 'STALE_FENCE') event(store, 'FENCE_REJECTED');
      if (error.message === 'STATE_CHANGED') event(store, 'EXTERNAL_CHANGE');
      if (error.message === 'STATE_CHANGED') {
        const grant = store.grants.find(g => g.grantId === options.grantId);
        if (grant?.status === 'ACTIVE') { grant.status = 'STALE'; Object.assign(grant, seal(grant)); }
      }
    });
    throw error;
  }
}
export function dispatchTelemetry(options) {
  const store = readOwnership(options); const m = store.metrics;
  return { scope: 'PROJECT_OWNED_ONLY', dispatchPlans: m.dispatchPlans ?? 0, dispatchesGranted: m.dispatchesGranted ?? 0,
    dispatchesDenied: m.dispatchesDenied ?? 0, readOnlyDispatches: m.readOnlyDispatches ?? 0, writerDispatches: m.writerDispatches ?? 0,
    leasesAcquired: m.ACQUIRED ?? 0, leaseConflicts: m.CONFLICT ?? 0, leasesExpired: m.EXPIRED ?? 0,
    leasesReclaimed: m.RECLAIMED ?? 0, fenceRejections: m.FENCE_REJECTED ?? 0, scopeViolations: m.SCOPE_VIOLATION ?? 0,
    externalChanges: (m.EXTERNAL_CHANGE ?? 0) + (m.EXTERNAL_CHANGE_DETECTED ?? 0), spawnsRequested: m.spawnsRequested ?? 0,
    spawnsGranted: m.spawnsGranted ?? 0, spawnsDenied: m.spawnsDenied ?? 0, completionRequestsGoverned: m.completionRequestsGoverned ?? 0,
    activeLeases: store.leases.filter(l => ['ACTIVE', 'EXPIRED'].includes(l.state)).length,
    hostBypassCoverage: 'PARTIAL', directHostActions: 'UNKNOWN' };
}
// ponytail: one local CAS journal; split per repository only if measured contention warrants it.
// Kernel flock is short-lived and released on process death; leases have their own TTL.
export function transact(options, change) {
  for (let n = 0; n < 32; n++) {
    const current = readOwnership(options); const next = structuredClone(current);
    const result = change(next);
    next.sequence++;
    const file = storePath(options.root);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const lock = contextStoreFile(options.root, 'ownership', ['cas.lock']);
    try {
      execFileSync('flock', ['-x', '-w', '5', lock, process.execPath, fileURLToPath(import.meta.url), '--cas', options.root], {
        input: JSON.stringify({ expected: current.fingerprint, next: seal(next) }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 2_097_152,
      });
      return result;
    } catch (error) {
      if (error.status !== 73) throw new Error(`OWNERSHIP_STORE_UNAVAILABLE: ${error.stderr?.toString().slice(0, 240) ?? error.message}`);
    }
  }
  throw new Error('CAS_MISMATCH');
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--cas') {
  const root = process.argv[3]; const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const current = readOwnership({ root });
  if (current.fingerprint !== input.expected) process.exitCode = 73;
  else {
    checkSeal(input.next, 'schemaVersion sequence generation plans grants leases permits completionRequests events metrics');
    if (input.next.sequence !== current.sequence + 1 || input.next.generation < current.generation) throw new Error('CAS_MISMATCH');
    writeContextArtifact(storePath(root), input.next, false);
  }
}
