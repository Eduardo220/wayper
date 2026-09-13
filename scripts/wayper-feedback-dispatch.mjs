import { planDispatch, issueGrant } from './wayper-dispatch.mjs';
import { acquireLease, releaseLease } from './wayper-ownership.mjs';
import { bindResolvedDispatchPacket } from './wayper-dispatch-adapters.mjs';
import { issuePermit, executeFileAction, executeAction, actionContract } from './wayper-dispatch-execution.mjs';
import { transact, seal } from './wayper-dispatch-store.mjs';

// The existing Feedback owner approves action/scope; this adapter grants each actual edit separately.
export function executeFeedbackEdit({ current, session, attempt, repository, file, content }) {
  const options = { root: current.root, identity: current.identity, actorId: 'main' };
  const capabilities = [...current.state.contextMap.capabilities.required, ...current.state.contextMap.capabilities.optional];
  if (!capabilities.length) throw new Error('PLAN_INPUT_REVIEW_REQUIRED');
  const task = { taskId: attempt.attemptId, goalReference: current.identity, repository, operation: 'MUTATE',
    scopes: [{ kind: 'FILE', path: file }], capabilities, risks: current.state.riskFlags, taskClass: current.state.taskClass };
  const plan = planDispatch({ ...options, task, actor: { actorId: 'main', kind: 'MAIN_OWNER' } });
  const grant = issueGrant({ ...options, plan }); options.grantId = grant.grantId;
  const lease = acquireLease(options);
  bindResolvedDispatchPacket(options);
  const action = { kind: 'WRITE_FILE', file, content };
  const permit = issuePermit({ ...options, action });
  const result = executeFileAction({ ...options, action, permitId: permit.permitId,
    metadata: { taskId: session.feedbackId, attemptId: attempt.attemptId, failureId: attempt.failureId } });
  releaseLease({ ...options, leaseId: lease.leaseId, expectedGeneration: lease.generation, expectedFingerprint: lease.fingerprint, fencingToken: lease.fencingToken });
  return result;
}
export async function executeFeedbackCommand({ current, session, attempt, input, evidenceKind }) {
  const action = { kind: 'COMMAND', command: input.command, args: input.args ?? [], target: input.target,
    mutability: input.mutability, evidenceKind };
  const mutability = actionContract(action);
  const options = { root: current.root, identity: current.identity, actorId: 'main' };
  const task = { taskId: attempt.attemptId, goalReference: current.identity, repository: input.repository,
    operation: mutability === 'MUTATING' ? 'MUTATE' : 'READ', scopes: [{ kind: 'REPOSITORY', path: '.' }],
    capabilities: [...current.state.contextMap.capabilities.required, ...current.state.contextMap.capabilities.optional],
    risks: current.state.riskFlags, taskClass: current.state.taskClass };
  if (!task.capabilities.length) throw new Error('PLAN_INPUT_REVIEW_REQUIRED');
  const grant = issueGrant({ ...options, plan: planDispatch({ ...options, task, actor: { actorId: 'main', kind: 'MAIN_OWNER' } }) });
  options.grantId = grant.grantId;
  if (mutability === 'MUTATING') acquireLease(options);
  bindResolvedDispatchPacket(options);
  const permit = issuePermit({ ...options, action });
  const result = await executeAction({ ...options, action, permitId: permit.permitId,
    metadata: { taskId: session.feedbackId, attemptId: attempt.attemptId, failureId: attempt.failureId } });
  // A mutating shell always requires explicit reconciliation, so only read-only checks reach here.
  transact(options, store => { const g = store.grants.find(g => g.grantId === grant.grantId); g.status = 'CLOSED'; Object.assign(g, seal(g)); });
  return result.result.receiptIds;
}
