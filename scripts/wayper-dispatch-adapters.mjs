import { currentGrant } from './wayper-dispatch.mjs';
import { seal, checkSeal, readOwnership, transact, event } from './wayper-dispatch-store.mjs';
import { overlap } from './wayper-dispatch-scope.mjs';
import { resolveContext, contextOwner } from './wayper-context-economy.mjs';
import { loadCapabilityFiles } from './quality/check-capability-routing.mjs';
import { selectSpecialistExecutionPolicy, validateStructuredHandoff, planContextMapMerge } from './wayper-structured-handoff.mjs';
import { buildContextPacket, validateContextPacket } from './wayper-context-packet.mjs';
import { digest, exact } from './wayper-validation-policy.mjs';
import { assessGoalCompletion } from './wayper-completion-boundary.mjs';
import { ownershipBlockers, ownershipProblemsInStore } from './wayper-ownership.mjs';
import crypto from 'node:crypto';

function completionRequester(store, options) {
  const { grant } = currentGrant(store, { ...options, grantId: options.requesterGrantId, actorId: options.requester?.actorId }, { active: false });
  if (grant.actorReference.kind !== 'MAIN_OWNER' || !grant.authorization.includes('REQUEST_COMPLETION') ||
    grant.expiresAt <= Date.now() || !['ACTIVE', 'HANDED_OFF', 'CLOSED'].includes(grant.status)) throw new Error('COMPLETION_REQUESTER_DENIED');
  return grant;
}

export async function prepareDispatchPacket(options) {
  const { grant, owner } = currentGrant(readOwnership(options), options);
  if (owner.stateFingerprint !== grant.stateFingerprint) throw new Error('STATE_CHANGED');
  for (const scope of grant.taskReference.scopes.filter(s => s.kind === 'FILE')) {
    // New files have no prior source to resolve. Existing sources go through Context Economy.
    const fs = await import('node:fs');
    if (fs.existsSync(`${owner.repo.root}/${scope.path}`)) await resolveContext({ ...options,
      request: { kind: 'SOURCE_SLICE', repository: owner.repo.id, path: scope.path, range: null } });
  }
  return bindResolvedDispatchPacket(options);
}
export function bindResolvedDispatchPacket(options) {
  const { grant, owner } = currentGrant(readOwnership(options), options);
  const { registry } = loadCapabilityFiles();
  const target = { type: grant.actorReference.readOnly ? 'agentProfile' : 'nativeRole',
    id: grant.actorReference.profileId ?? grant.actorReference.nativeRole, repositories: [owner.repo.id],
    capabilities: grant.taskReference.capabilities, paths: grant.taskReference.scopes.filter(s => s.kind === 'FILE').map(s => `${owner.repo.id}:${s.path}`),
    objective: `Execute task ${grant.taskReference.taskId}` };
  // Packet emission consumes the existing Context Map/artifacts; it must not invalidate owner proofs as a side effect.
  const packet = buildContextPacket(owner.state.contextMap, target, { registry, repositoryDefinitions: owner.repositories });
  if (validateContextPacket(packet, { contextMap: owner.state.contextMap, registry, repositoryDefinitions: owner.repositories }).status !== 'VALID') throw new Error('INVALID_CONTEXT_PACKET');
  return transact(options, store => {
    const { grant: current, owner: now } = currentGrant(store, options);
    if (now.stateFingerprint !== grant.stateFingerprint || current.packetReference) throw new Error('STATE_CHANGED_OR_PACKET_BOUND');
    const envelope = seal({ schemaVersion: 1, taskId: current.taskReference.taskId, dispatchPlanId: current.dispatchPlanId,
      grantId: current.grantId, actorId: current.actorReference.actorId, goalReference: current.goalReference,
      scopes: current.taskReference.scopes, packet, authority: 'NONE' });
    current.packetReference = envelope; Object.assign(current, seal(current)); return envelope;
  });
}
export function boundPacket(store, options) {
  const { grant, owner } = currentGrant(store, options, { active: false });
  const envelope = options.envelope;
  checkSeal(envelope, 'schemaVersion taskId dispatchPlanId grantId actorId goalReference scopes packet authority');
  if (digest(envelope) !== digest(grant.packetReference) || envelope.actorId !== options.actorId || envelope.grantId !== options.grantId) throw new Error('PACKET_DISPATCH_MISMATCH');
  return { grant, owner, packet: envelope.packet };
}
export async function dispatchSpawn(options) {
  transact(options, store => event(store, 'spawnsRequested', options.grantId ?? null));
  const deny = (status, reasonCode = status) => {
    transact(options, s => event(s, 'spawnsDenied', reasonCode)); return { status, reasonCode };
  };
  if (options.depth !== 0) return deny('DENIED_MAX_DEPTH');
  if (!Number.isSafeInteger(options.slotLimit) || options.slotLimit < 1 || !Number.isSafeInteger(options.hostActiveSlots) || options.hostActiveSlots < 0) return deny('SPAWN_UNAVAILABLE');
  if (typeof options.spawn !== 'function') return deny('SPAWN_UNAVAILABLE');
  let reserved;
  try {
    reserved = transact(options, store => {
      const { grant: parent } = currentGrant(store, { ...options, grantId: options.parentGrantId, actorId: options.parentActorId });
      if (parent.actorReference.kind !== 'MAIN_OWNER' || !parent.authorization.includes('SPAWN_SPECIALIST')) throw new Error('DENIED_MAX_DEPTH');
      const { grant, owner, packet } = boundPacket(store, options);
      if (grant.status !== 'ACTIVE' || grant.expiresAt <= Date.now() || !grant.actorReference.readOnly) throw new Error('SPAWN_DENIED');
      if (owner.stateFingerprint !== grant.stateFingerprint) throw new Error('STATE_CHANGED');
      if (store.leases.some(l => ['ACTIVE', 'EXPIRED'].includes(l.state) && l.repository === owner.repo.id && overlap(l.scopes, grant.taskReference.scopes))) throw new Error('READER_DEFERRED');
      const used = store.grants.filter(g => g.actorReference.readOnly && g.status === 'ACTING').length;
      if (Math.max(used + 1, options.hostActiveSlots) >= options.slotLimit) throw new Error('SLOT_EXHAUSTED');
      const { registry } = loadCapabilityFiles();
      if (validateContextPacket(packet, { contextMap: owner.state.contextMap, registry, repositoryDefinitions: owner.repositories }).status !== 'VALID') throw new Error('SPAWN_DENIED');
      const policy = selectSpecialistExecutionPolicy(packet);
      grant.status = 'ACTING'; Object.assign(grant, seal(grant));
      return { policy, packet, actor: grant.actorReference };
    });
  } catch (error) {
    const status = ['DENIED_MAX_DEPTH', 'SLOT_EXHAUSTED', 'NO_ELIGIBLE_ACTOR', 'SPAWN_UNAVAILABLE'].includes(error.message) ? error.message : 'SPAWN_DENIED';
    return deny(status, error.message);
  }
  try {
    const result = await options.spawn({ packet: reserved.packet, actor: reserved.actor, forkTurns: 'none', depth: 1,
      descendants: 0, readOnly: true, model: reserved.policy.model, reasoningEffort: reserved.policy.reasoningEffort });
    transact(options, store => event(store, 'spawnsGranted', options.grantId));
    return { status: 'SPAWNED', result, policy: reserved.policy };
  } catch {
    // A rejected host callback may already have spawned. Do not free this slot blindly.
    transact(options, store => { const g = store.grants.find(g => g.grantId === options.grantId);
      g.status = 'UNKNOWN_OUTCOME'; Object.assign(g, seal(g)); event(store, 'spawnsDenied', g.grantId); });
    return { status: 'SPAWN_UNAVAILABLE', reconciliationRequired: true };
  }
}
export function consumeDispatchHandoff(options) {
  return transact(options, store => {
    const { grant, owner, packet } = boundPacket(store, options);
    const h = options.handoff;
    if (!exact(h, 'schemaVersion taskId grantId actorId packetId descendants authority result') || h.schemaVersion !== 1 ||
      h.taskId !== grant.taskReference.taskId || h.grantId !== grant.grantId || h.actorId !== grant.actorReference.actorId ||
      h.packetId !== packet.packetId || h.descendants !== 0 || h.authority !== 'NONE') throw new Error('HANDOFF_DISPATCH_MISMATCH');
    if (!['ACTIVE', 'ACTING'].includes(grant.status) || grant.expiresAt <= Date.now()) throw new Error('GRANT_NOT_ACTIVE');
    if (owner.stateFingerprint !== grant.stateFingerprint) throw new Error('STATE_CHANGED');
    let merge = null;
    if (grant.actorReference.readOnly) {
      const validation = { packet, contextMap: owner.state.contextMap, registry: loadCapabilityFiles().registry, repositoryDefinitions: owner.repositories };
      if (h.result.taskId !== h.taskId || validateStructuredHandoff(h.result, validation).status !== 'VALID') throw new Error('INVALID_HANDOFF');
      merge = planContextMapMerge(h.result, validation);
    } else {
      if (!exact(h.result, 'affectedPaths actionPermits resultingStateFingerprint checks unresolvedIssues') ||
        !Array.isArray(h.result.affectedPaths) || !h.result.affectedPaths.every(p => typeof p === 'string') ||
        !Array.isArray(h.result.actionPermits) || !h.result.actionPermits.length || !h.result.actionPermits.every(p => typeof p === 'string') ||
        !Array.isArray(h.result.checks) || !Array.isArray(h.result.unresolvedIssues) ||
        h.result.resultingStateFingerprint !== grant.stateFingerprint) throw new Error('INVALID_WRITER_HANDOFF');
      const permits = store.permits.filter(p => p.grantId === grant.grantId && p.result);
      if (digest(h.result.actionPermits.slice().sort()) !== digest(permits.map(p => p.permitId).sort()) ||
        permits.some(p => p.result.outcome !== 'COMPLETE') ||
        digest(h.result.affectedPaths.slice().sort()) !== digest([...new Set(permits.flatMap(p => p.result.affectedPaths))].sort())) throw new Error('INVALID_WRITER_HANDOFF');
    }
    grant.status = 'HANDED_OFF'; Object.assign(grant, seal(grant)); event(store, 'HANDOFF_ACCEPTED', grant.grantId);
    return { status: 'ACCEPTED', authority: 'NONE', merge };
  });
}
export async function requestGoalCompletion(options) {
  if (options.requester?.kind !== 'MAIN_OWNER' || !options.requester.actorId) throw new Error('COMPLETION_REQUESTER_DENIED');
  completionRequester(readOwnership(options), options);
  // Reuse the Completion owner, including ownership blockers; no parallel DONE state.
  const assessment = assessGoalCompletion(options);
  if (assessment.decision !== 'ADMISSIBLE') throw new Error(`COMPLETION_${assessment.decision}`);
  if (ownershipBlockers(options).length) throw new Error('OWNERSHIP_IN_FLIGHT');
  if (typeof options.requestHostDone !== 'function') return { status: 'HOST_UNAVAILABLE', assessment };
  const request = transact(options, store => {
    completionRequester(store, options);
    if (ownershipProblemsInStore(store, options.identity).length ||
      store.completionRequests.some(r => ['REQUESTING', 'UNKNOWN_OUTCOME', 'REQUESTED'].includes(r.status))) throw new Error('OWNERSHIP_IN_FLIGHT');
    const request = seal({ schemaVersion: 1, requestId: `CR-${crypto.randomUUID()}`, goalReference: options.identity,
      actorId: options.requester.actorId, requesterGrantId: options.requesterGrantId, assessmentId: assessment.assessmentId,
      repositories: contextOwner(options).repositories.map(r => r.id), status: 'REQUESTING' });
    store.completionRequests.push(request); event(store, 'completionRequestsGoverned', assessment.assessmentId); return request;
  });
  let hostCalled = false;
  try {
    if (assessGoalCompletion(options).assessmentId !== assessment.assessmentId) throw new Error('STATE_CHANGED');
    hostCalled = true;
    const hostResult = await options.requestHostDone(assessment);
    reconcileCompletionRequest({ ...options, requestId: request.requestId, expectedFingerprint: request.fingerprint, outcome: 'REQUESTED' });
    return { status: 'REQUESTED', assessment, hostResult };
  } catch (error) {
    reconcileCompletionRequest({ ...options, requestId: request.requestId, expectedFingerprint: request.fingerprint, outcome: hostCalled ? 'UNKNOWN_OUTCOME' : 'CANCELLED' });
    throw error;
  }
}
export function reconcileCompletionRequest(options) {
  return transact(options, store => {
    const request = store.completionRequests.find(r => r.requestId === options.requestId);
    if (!request || request.fingerprint !== options.expectedFingerprint || digest(request.goalReference) !== digest(options.identity) ||
      options.requester?.kind !== 'MAIN_OWNER' || options.requester.actorId !== request.actorId || options.requesterGrantId !== request.requesterGrantId ||
      !['REQUESTED', 'UNKNOWN_OUTCOME', 'CANCELLED'].includes(options.outcome) ||
      request.status === 'UNKNOWN_OUTCOME' && (!options.hostStopped || !options.reason?.trim())) throw new Error('RECONCILIATION_REQUIRED');
    request.status = options.outcome; Object.assign(request, seal(request)); return request;
  });
}
