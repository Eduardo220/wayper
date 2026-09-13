import crypto from 'node:crypto';
import { assertSameIdentity } from './wayper-context-identity.mjs';
import { digest, exact } from './wayper-validation-policy.mjs';
import { loadCapabilityFiles } from './quality/check-capability-routing.mjs';
import { validateRouterSelectionReceipt } from './wayper-agent-router.mjs';
import { dispatchOwner, scopesFor, bindingFingerprint, overlap } from './wayper-dispatch-scope.mjs';
import { seal, checkSeal, transact, event } from './wayper-dispatch-store.mjs';

const READ = ['READ_CONTEXT', 'READ_SOURCE', 'QUERY_GRAPH', 'RUN_READ_ONLY_CHECK', 'SUBMIT_HANDOFF'];
export function actorFor(actor, registry = loadCapabilityFiles().registry) {
  if (!exact(actor, `actorId kind${actor.profileId === undefined ? '' : ' profileId'}`) || !/^[\w.-]{1,120}$/.test(actor.actorId)) throw new Error('INVALID_ACTOR');
  const profile = registry.agentProfiles.find(p => p.id === actor.profileId);
  const native = ['MAIN_OWNER', 'NATIVE_WRITER'].includes(actor.kind);
  if (!native && (!['READ_ONLY_SPECIALIST', 'REVIEWER', 'VALIDATOR'].includes(actor.kind) || !profile ||
    profile.writePermission !== 'none' || profile.sandbox !== 'read-only')) throw new Error('NO_ELIGIBLE_ACTOR');
  if (native && actor.profileId) throw new Error('READ_ONLY_ACTOR');
  return { actorId: actor.actorId, kind: actor.kind, profileId: profile?.id ?? null,
    nativeRole: profile?.nativeRole ?? (actor.kind === 'NATIVE_WRITER' ? 'worker' : 'default'), readOnly: !native,
    capabilities: profile?.capabilities ?? [], modelRouting: profile?.modelPolicy ?? 'HOST_NATIVE' };
}
export function planDispatch(options) {
  const { task } = options;
  if (!exact(task, 'taskId goalReference repository operation scopes capabilities risks taskClass') ||
    !/^[\w.-]{1,120}$/.test(task.taskId) || !['READ', 'MUTATE'].includes(task.operation) ||
    ![task.capabilities, task.risks].every(a => Array.isArray(a) && a.every(s => typeof s === 'string' && s.length > 0))) throw new Error('INVALID_TASK');
  assertSameIdentity(task.goalReference, options.identity);
  const owner = dispatchOwner(options, task.repository);
  const registry = loadCapabilityFiles().registry;
  const available = options.availableActors ?? [options.actor];
  if (!Array.isArray(available) || !available.length || available.length > 16) throw new Error('NO_ELIGIBLE_ACTOR');
  const candidates = available.map(a => actorFor(a, registry)).sort((a,b) => a.actorId.localeCompare(b.actorId));
  if (new Set(candidates.map(a => a.actorId)).size !== candidates.length) throw new Error('INVALID_ACTOR');
  const router = options.routerAssessment ?? owner.state.contextMap.router?.selectionReceipt;
  const eligible = candidates.filter(a => !a.readOnly || task.operation === 'READ' &&
    task.capabilities.every(c => a.capabilities.includes(c)) && router?.decision === 'ROUTER_SELECTED' && router.profileIds.includes(a.profileId));
  const actor = options.actor ? candidates.find(a => digest(a) === digest(actorFor(options.actor, registry))) :
    eligible.find(a => task.operation === 'MUTATE' ? a.kind === 'MAIN_OWNER' : a.readOnly) ?? eligible[0];
  if (!actor) throw new Error('NO_ELIGIBLE_ACTOR');
  const scopes = scopesFor(owner.repo, task.scopes);
  if (actor.readOnly && task.operation === 'MUTATE') throw new Error('READ_ONLY_ACTOR');
  if (actor.readOnly && task.capabilities.some(c => !actor.capabilities.includes(c))) throw new Error('NO_ELIGIBLE_ACTOR');
  if (actor.readOnly) {
    const receipt = options.routerAssessment ?? owner.state.contextMap.router?.selectionReceipt;
    if (validateRouterSelectionReceipt(receipt, { registry, agentId: actor.profileId }).status !== 'VALID' ||
      receipt.decision !== 'ROUTER_SELECTED' || !receipt.repositories.includes(task.repository) ||
      owner.state.contextMap.router?.selectionReceipt?.receiptId !== receipt?.receiptId) throw new Error('ROUTER_ASSESSMENT_REQUIRED');
  }
  // Dirty site ownership always requires a separately scoped clean/reconciled baseline in V1.
  if (task.repository === 'wayper-site' && task.operation === 'MUTATE' && owner.snapshot.dirty) throw new Error('EXTERNAL_CHANGE_PRESENT');
  const taskBody = { ...task, scopes, capabilities: [...task.capabilities].sort(), risks: [...task.risks].sort() };
  const value = { schemaVersion: 1, goalReference: options.identity, baselineReference: owner.state.execution.baseline.fingerprint,
    taskReference: { ...taskBody, fingerprint: digest(taskBody) },
    candidates, selectedActor: actor, authorization: actor.readOnly ? READ : [...READ,
      ...(task.operation === 'MUTATE' ? ['MUTATE_FILES', 'RUN_MUTATING_COMMAND'] : []),
      ...(actor.kind === 'MAIN_OWNER' ? ['SPAWN_SPECIALIST', 'REQUEST_COMPLETION'] : [])],
    ownershipRequirement: task.operation === 'MUTATE', stateFingerprint: bindingFingerprint(owner, scopes),
    routerReference: actor.readOnly ? (options.routerAssessment ?? owner.state.contextMap.router?.selectionReceipt).receiptId : null,
    contextPacketReference: null, reasonCodes: [actor.readOnly ? 'ROUTER_ELIGIBLE' : 'NATIVE_OWNER'] };
  return seal({ ...value, planId: `DP-${digest(value).slice(7)}` });
}
export function validatePlan(plan, options) {
  checkSeal(plan, 'schemaVersion planId goalReference baselineReference taskReference candidates selectedActor authorization ownershipRequirement stateFingerprint routerReference contextPacketReference reasonCodes');
  const actor = plan.selectedActor;
  const { fingerprint, ...task } = plan.taskReference;
  if (fingerprint !== digest(task)) throw new Error('INVALID_TASK_BINDING');
  const current = planDispatch({ ...options, task,
    availableActors: plan.candidates.map(a => ({ actorId: a.actorId, kind: a.kind, ...(a.profileId ? { profileId: a.profileId } : {}) })),
    actor: { actorId: actor.actorId, kind: actor.kind, ...(actor.profileId ? { profileId: actor.profileId } : {}) } });
  if (current.stateFingerprint !== plan.stateFingerprint) throw new Error('STATE_CHANGED');
  if (current.fingerprint !== plan.fingerprint) throw new Error('STALE_DISPATCH_PLAN');
  return current;
}
export function issueGrant(options) {
  const plan = validatePlan(options.plan, options);
  const ttlMs = options.ttlMs ?? 60_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 10 || ttlMs > 300_000) throw new Error('INVALID_TTL');
  return transact(options, store => {
    validatePlan(plan, options);
    if (plan.ownershipRequirement && store.completionRequests.some(r =>
      ['REQUESTING', 'UNKNOWN_OUTCOME', 'REQUESTED'].includes(r.status) && r.repositories.includes(plan.taskReference.repository))) {
      throw new Error('COMPLETION_IN_FLIGHT');
    }
    if (plan.taskReference.operation === 'READ' && store.leases.some(l => ['ACTIVE', 'EXPIRED'].includes(l.state) &&
      l.repository === plan.taskReference.repository && overlap(l.scopes, plan.taskReference.scopes))) throw new Error('READER_DEFERRED');
    const grant = seal({ schemaVersion: 1, grantId: `EG-${crypto.randomUUID()}`, dispatchPlanId: plan.planId,
      goalReference: plan.goalReference, taskReference: plan.taskReference, actorReference: plan.selectedActor,
      authorization: plan.authorization, ownershipReference: null, stateFingerprint: plan.stateFingerprint,
      issuedAt: Date.now(), expiresAt: Date.now() + ttlMs, fencingToken: null, status: 'ACTIVE', packetReference: null });
    if (!store.plans.some(p => p.planId === plan.planId)) { store.plans.push(plan); event(store, 'dispatchPlans', plan.planId); }
    store.grants.push(grant); event(store, 'dispatchesGranted', grant.grantId);
    event(store, plan.ownershipRequirement ? 'writerDispatches' : 'readOnlyDispatches', grant.grantId);
    return grant;
  });
}
export function currentGrant(store, options, { active = true } = {}) {
  const grant = store.grants.find(g => g.grantId === options.grantId);
  if (!grant) throw new Error('GRANT_REQUIRED');
  checkSeal(grant, 'schemaVersion grantId dispatchPlanId goalReference taskReference actorReference authorization ownershipReference stateFingerprint issuedAt expiresAt fencingToken status packetReference');
  assertSameIdentity(grant.goalReference, options.identity);
  const owner = dispatchOwner(options, grant.taskReference.repository, grant.taskReference.scopes);
  const plan = store.plans.find(p => p.planId === grant.dispatchPlanId);
  if (!plan || plan.baselineReference !== owner.state.execution.baseline.fingerprint ||
    digest(plan.taskReference) !== digest(grant.taskReference) || digest(plan.selectedActor) !== digest(grant.actorReference) ||
    digest(plan.authorization) !== digest(grant.authorization)) throw new Error('INVALID_GRANT_BINDING');
  if (options.actorId !== grant.actorReference.actorId) throw new Error('ACTOR_MISMATCH');
  if (active && (grant.status !== 'ACTIVE' || grant.expiresAt <= Date.now())) throw new Error('GRANT_NOT_ACTIVE');
  scopesFor(owner.repo, grant.taskReference.scopes);
  return { grant, owner };
}
