import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { currentGrant } from './wayper-dispatch.mjs';
import { fence } from './wayper-ownership.mjs';
import { readOwnership, transact, seal, checkSeal, event, observedBoundary } from './wayper-dispatch-store.mjs';
import { dispatchOwner, contains, overlap, fileState, changedPaths } from './wayper-dispatch-scope.mjs';
import { safeContextPath } from './wayper-graph-corpus.mjs';
import { digest, exact } from './wayper-validation-policy.mjs';
import { observeFile, runObservedCommand, runObservedTest, runObservedQualityGate } from './wayper-evidence-observer.mjs';

export function actionContract(action) {
  if (exact(action, 'kind file content') && action.kind === 'WRITE_FILE' && typeof action.content === 'string') return 'MUTATING';
  if (exact(action, `kind command args mutability target${action.evidenceKind === undefined ? '' : ' evidenceKind'}`) &&
    (action.evidenceKind === undefined || ['COMMAND', 'TEST', 'QUALITY_GATE'].includes(action.evidenceKind)) && action.kind === 'COMMAND' &&
    typeof action.command === 'string' && Array.isArray(action.args) && action.args.every(a => typeof a === 'string')) {
    if (action.mutability === 'MUTATING') return 'MUTATING';
    // Only this fixed project-owned check is classified read-only. Arbitrary shell declarations are not a sandbox.
    if (action.mutability === 'READ_ONLY') return 'READ_ONLY';
  }
  if (exact(action, 'kind file') && action.kind === 'READ_FILE') return 'READ_ONLY';
  throw new Error('UNKNOWN_MUTABILITY');
}
function guard(store, options, action, mutability) {
  const { grant, owner } = currentGrant(store, options, { active: false });
  if (mutability === 'MUTATING') {
    if (grant.taskReference.operation !== 'MUTATE' || grant.actorReference.readOnly || !grant.authorization.includes(action.kind === 'COMMAND' ? 'RUN_MUTATING_COMMAND' : 'MUTATE_FILES')) throw new Error('READ_ONLY_ACTOR');
    fence(store, grant);
  } else if (store.leases.some(l => l.repository === grant.taskReference.repository && ['ACTIVE', 'EXPIRED'].includes(l.state) &&
    overlap(l.scopes, grant.taskReference.scopes))) throw new Error('READER_DEFERRED');
  if (grant.actorReference.readOnly && action.kind === 'COMMAND' && (action.command !== 'git' ||
    digest(action.args) !== digest(['diff', '--check', 'HEAD', '--']))) throw new Error('READ_ONLY_EXECUTOR_REQUIRED');
  if (grant.status !== 'ACTIVE' || grant.expiresAt <= Date.now()) throw new Error('GRANT_NOT_ACTIVE');
  if (owner.stateFingerprint !== grant.stateFingerprint) throw new Error('STATE_CHANGED');
  if (action.file) {
    safeContextPath(owner.repo.root, action.file, { missing: action.kind === 'WRITE_FILE' });
    if (!grant.taskReference.scopes.some(s => contains(s, action.file))) throw new Error('SCOPE_DENIED');
  }
  return { grant, owner };
}
export function issuePermit(options) {
  const mutability = actionContract(options.action);
  return observedBoundary(options, () => transact(options, store => {
    const { grant } = guard(store, options, options.action, mutability);
    if (!grant.packetReference) throw new Error('BOUND_PACKET_REQUIRED');
    const permit = seal({ schemaVersion: 1, permitId: `AP-${crypto.randomUUID()}`, grantId: grant.grantId,
      actorId: grant.actorReference.actorId, leaseId: grant.ownershipReference, fencingToken: grant.fencingToken,
      actionFingerprint: digest(options.action), mutability, expectedStateFingerprint: grant.stateFingerprint,
      status: 'ISSUED', executionClaimed: false, result: null });
    store.permits.push(permit); event(store, 'PERMIT_ISSUED', permit.permitId); return permit;
  }));
}
export function beginAction(options) {
  return observedBoundary(options, () => transact(options, store => {
    const permit = store.permits.find(p => p.permitId === options.permitId);
    if (!permit) throw new Error('PERMIT_REQUIRED');
    checkSeal(permit, 'schemaVersion permitId grantId actorId leaseId fencingToken actionFingerprint mutability expectedStateFingerprint status executionClaimed result');
    if (permit.grantId !== options.grantId || permit.actorId !== options.actorId || permit.actionFingerprint !== digest(options.action)) throw new Error('PERMIT_BINDING_MISMATCH');
    if (permit.status !== 'ISSUED') throw new Error('PERMIT_CONSUMED');
    const { grant, owner } = guard(store, options, options.action, actionContract(options.action));
    if (permit.expectedStateFingerprint !== grant.stateFingerprint || permit.fencingToken !== grant.fencingToken) throw new Error('STALE_FENCE');
    const before = fileState(owner.repo, grant.taskReference.scopes);
    permit.status = 'CONSUMED'; Object.assign(permit, seal(permit));
    grant.status = 'ACTING'; Object.assign(grant, seal(grant)); event(store, 'ACTION_STARTED', permit.permitId);
    return { before, grant: structuredClone(grant), permit: structuredClone(permit) };
  }));
}
function finish(options, started, receiptIds, error) {
  return transact(options, store => {
    const { grant, owner } = currentGrant(store, options, { active: false });
    const permit = store.permits.find(p => p.permitId === options.permitId);
    if (grant.fingerprint !== started.grant.fingerprint) throw new Error('CAS_MISMATCH');
    const affectedPaths = changedPaths(started.before, fileState(owner.repo, grant.taskReference.scopes));
    const escaped = affectedPaths.filter(p => !grant.taskReference.scopes.some(s => contains(s, p)));
    let outcome = escaped.length ? 'SCOPE_VIOLATION' : ['EXTERNAL_CHANGE_DETECTED', 'STATE_CHANGED', 'READ_ONLY_CONTRACT_VIOLATION'].includes(error?.message) ?
      'EXTERNAL_CHANGE_DETECTED' : error ? 'UNKNOWN_OUTCOME' : 'COMPLETE';
    const expectedPaths = options.action.kind === 'WRITE_FILE' ? [options.action.file] : [];
    if (outcome === 'COMPLETE' && options.action.kind !== 'COMMAND' && affectedPaths.some(p => !expectedPaths.includes(p))) outcome = 'EXTERNAL_CHANGE_DETECTED';
    if (outcome === 'COMPLETE' && options.action.kind === 'WRITE_FILE' &&
      fs.readFileSync(safeContextPath(owner.repo.root, options.action.file), 'utf8') !== options.action.content) outcome = 'EXTERNAL_CHANGE_DETECTED';
    if (outcome === 'COMPLETE' && started.permit.mutability === 'READ_ONLY' && owner.stateFingerprint !== grant.stateFingerprint) outcome = 'EXTERNAL_CHANGE_DETECTED';
    // Shell effects cannot be attributed exclusively to a process from before/after snapshots.
    const origin = options.action.kind === 'COMMAND' && started.permit.mutability === 'MUTATING' ? 'UNKNOWN_ORIGIN' : 'PROJECT_ADAPTER_OBSERVED';
    if (origin === 'UNKNOWN_ORIGIN' && outcome === 'COMPLETE') outcome = 'RECONCILIATION_REQUIRED';
    permit.result = { outcome, origin, affectedPaths, escaped, receiptIds, resultingStateFingerprint: owner.stateFingerprint,
      error: error ? String(error.message).slice(0, 160) : null };
    Object.assign(permit, seal(permit));
    grant.status = outcome === 'COMPLETE' ? 'ACTIVE' : outcome === 'UNKNOWN_OUTCOME' ? 'UNKNOWN_OUTCOME' : 'PARTIAL';
    if (outcome === 'COMPLETE') grant.stateFingerprint = owner.stateFingerprint;
    Object.assign(grant, seal(grant)); event(store, outcome, permit.permitId); return permit;
  });
}
function immediateObservation(options, started) {
    // Recheck after reservation, immediately before the side effect. Never reclaim ACTING blindly.
    const store = readOwnership(options); const { grant, owner } = currentGrant(store, options, { active: false });
    if (grant.fingerprint !== started.grant.fingerprint || owner.stateFingerprint !== grant.stateFingerprint) throw new Error('EXTERNAL_CHANGE_DETECTED');
    if (started.permit.mutability === 'MUTATING') fence(store, grant);
    return { root: options.root, execution: owner.state.execution, repositories: owner.repositories,
      repository: owner.repo.id, metadata: { taskId: grant.taskReference.taskId, ...(options.metadata ?? {}) } };
}
function complete(options, started, receiptIds, error) {
  const permit = finish(options, started, receiptIds, error);
  if (permit.result.outcome !== 'COMPLETE') { const e = new Error(permit.result.outcome); e.result = permit.result; throw e; }
  return permit;
}
export function executeFileAction(options) {
  if (!['WRITE_FILE', 'READ_FILE'].includes(options.action?.kind)) throw new Error('INVALID_FILE_ACTION');
  const started = beginAction(options); const receiptIds = []; let error;
  try {
    const observation = immediateObservation(options, started); const action = options.action;
    const owner = dispatchOwner(options, observation.repository);
    if (action.kind === 'WRITE_FILE') {
      const target = safeContextPath(owner.repo.root, action.file, { missing: true });
      const temporary = `${target}.${started.permit.permitId}.tmp`;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { fs.writeFileSync(temporary, action.content, { flag: 'wx', mode: fs.statSync(target, { throwIfNoEntry: false })?.mode ?? 0o644 }); fs.renameSync(temporary, target); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      receiptIds.push(observeFile({ ...observation, path: action.file }).receiptId);
    } else if (action.kind === 'READ_FILE') receiptIds.push(observeFile({ ...observation, path: action.file }).receiptId);
  } catch (e) { error = e; if (e.receipt) receiptIds.push(e.receipt.receiptId); }
  return complete(options, started, receiptIds, error);
}
export async function executeAction(options) {
  if (options.action?.kind !== 'COMMAND') return executeFileAction(options);
  const started = beginAction(options); const receiptIds = []; let error;
  try {
    const observation = immediateObservation(options, started); const action = options.action;
    const producer = { COMMAND: runObservedCommand, TEST: runObservedTest, QUALITY_GATE: runObservedQualityGate }[action.evidenceKind ?? 'COMMAND'];
    const result = await producer({ ...observation, command: action.command, args: action.args, target: action.target,
      mutability: action.mutability, dispatchAuthorization: { grantId: options.grantId, actorId: options.actorId, permitId: options.permitId, action } });
    receiptIds.push(...(result.receipt ? [result.commandReceipt.receiptId, result.receipt.receiptId] : [result.receiptId]));
  } catch (e) { error = e; if (e.receipt) receiptIds.push(e.receipt.receiptId); }
  return complete(options, started, receiptIds, error);
}
export function claimObservedCommand(input) {
  const authorization = input.dispatchAuthorization;
  if (!authorization) throw new Error('MUTATION_GRANT_REQUIRED');
  const options = { root: input.root, identity: input.execution.identity, ...authorization };
  return transact(options, store => {
    const { grant, owner } = currentGrant(store, options, { active: false });
    const permit = store.permits.find(p => p.permitId === options.permitId);
    if (grant.status !== 'ACTING' || grant.actorReference.readOnly || !permit || permit.grantId !== grant.grantId ||
      permit.mutability !== 'MUTATING' || permit.status !== 'CONSUMED' || permit.executionClaimed ||
      permit.actionFingerprint !== digest(options.action) || input.repository !== grant.taskReference.repository ||
      digest([input.command, input.args ?? [], input.target]) !== digest([options.action.command, options.action.args, options.action.target])) throw new Error('MUTATION_PERMIT_REQUIRED');
    if (owner.stateFingerprint !== grant.stateFingerprint) throw new Error('STATE_CHANGED');
    fence(store, grant); permit.executionClaimed = true; Object.assign(permit, seal(permit)); return permit;
  });
}
