import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { digest } from './wayper-validation-policy.mjs';
import { FEEDBACK_ID, feedbackBudget, selectFeedbackFailure, failureSetFingerprint, compareFeedbackProgress, failureLineage,
  hypothesisFingerprint, feedbackDecisionRequest, normalizeActionCommand, operationalActionFingerprint, actionFingerprint } from './wayper-feedback-policy.mjs';
import { sealFeedback, validateFeedbackDiagnosis, attemptIndex } from './wayper-feedback-schema.mjs';
import { readFeedbackSession, appendFeedbackCheckpoint, persistFeedbackAttempt } from './wayper-feedback-store.mjs';
import { readCompletionAssessment } from './wayper-completion-store.mjs';
import { feedbackFacts, feedbackState, publishFeedbackContext, storeFeedbackAssessment, feedbackDiagnosisContext, feedbackExecutor,
  validationSummary, feedbackActionScope, recordFeedbackContextReuse } from './wayper-feedback-context.mjs';
import { ownershipBlockers } from './wayper-ownership.mjs';

const initialProgress = () => ({ relation: 'SAME', materialProgress: false, regression: false, removedFailureIds: [],
  addedFailureIds: [], satisfiedRequirementIds: [], beforeVector: { completionRank: 0, blockingFailures: 0, criticalHighFailures: 0, maxSeverity: 0, missingValidation: 0, staleEvidence: 0, materialFindings: 0 },
  afterVector: { completionRank: 0, blockingFailures: 0, criticalHighFailures: 0, maxSeverity: 0, missingValidation: 0, staleEvidence: 0, materialFindings: 0 }, consecutiveNoProgress: 0 });
function save(value, options, previous = null) {
  const next = appendFeedbackCheckpoint(value, options, previous);
  // An amendment/concurrent owner is never overwritten just to update a cache index.
  try {
    const current = feedbackState(options);
    if (current.state.execution.baseline.fingerprint === next.baselineReference.fingerprint) publishFeedbackContext(next, options);
  } catch (error) { if (next.state !== 'STALE') throw error; }
  return next;
}
function disposition(s, facts) {
  const f = selectFeedbackFailure(facts.failures);
  if (facts.assessment.decision === 'ADMISSIBLE') return { ...s, state: 'FINISHED', outcome: 'SUCCEEDED',
    reasonCode: 'COMPLETION_ADMISSIBLE', finalAssessmentId: facts.assessment.assessmentId };
  const outcome = f?.failureClass === 'INVALID_STATE' || !f ? 'INVALID_STATE' : f.failureClass === 'EXTERNAL' ? 'BLOCKED_EXTERNAL' :
    f.failureClass === 'HUMAN_DECISION' ? 'HUMAN_REQUIRED' : null;
  if (outcome) return { ...s, state: 'FINISHED', outcome, reasonCode: f?.reasonCode ?? 'DEPENDENCY_CYCLE',
    decisionRequest: outcome === 'HUMAN_REQUIRED' ? feedbackDecisionRequest(s, f) : null };
  if (s.attempts.length >= s.attemptBudget.total || s.attempts.filter((a) => a.failureId === f.failureId).length >= s.attemptBudget.byClass[f.failureClass]) {
    return { ...s, state: 'FINISHED', outcome: 'EXHAUSTED', reasonCode: 'ATTEMPT_BUDGET_EXHAUSTED' };
  }
  return s;
}

export function startFeedbackSession(options) {
  const facts = feedbackFacts(options); storeFeedbackAssessment(facts);
  const baselineReference = facts.assessment.baselineReference ?? { fingerprint: facts.state.execution.baseline.fingerprint };
  const feedbackId = `FB-${digest([options.identity, baselineReference, facts.assessment.assessmentId]).slice(7)}`;
  try { return readFeedbackSession(feedbackId, options); } catch (error) {
    if (!error.message.includes('missing session')) throw error;
  }
  const s = { schemaVersion: 1, feedbackId, goalReference: options.identity, baselineReference,
    initialAssessmentId: facts.assessment.assessmentId, currentAssessmentId: facts.assessment.assessmentId, finalAssessmentId: null,
    targetBlockerIds: facts.assessment.blockers.map((b) => b.blockerId), state: 'READY', attemptBudget: feedbackBudget(facts.state, options.attemptBudget),
    attempts: [], activeAttempt: null, currentFailureSet: facts.failures, failureSetFingerprint: failureSetFingerprint(facts.failures),
    currentStateFingerprint: facts.fingerprint, progressState: initialProgress(), outcome: null, reasonCode: 'INITIAL_REJECTION',
    decisionRequest: null, sequence: 1, previousFingerprint: null };
  return save(disposition(s, facts), options);
}

export function resumeFeedbackSession(options) {
  const session = readFeedbackSession(options.feedbackId, options);
  let current;
  try { current = feedbackState(options); } catch { return { status: 'STALE', reasonCode: 'GOAL_OR_REVISION_CHANGED', session, receiptIds: [] }; }
  const receiptIds = current.receipts.filter((r) => r.metadata.attemptId === session.activeAttempt?.attemptId).map((r) => r.receiptId);
  if (current.state.execution.baseline.fingerprint !== session.baselineReference.fingerprint || current.fingerprint !== session.currentStateFingerprint) {
    return { status: 'STALE', reasonCode: 'STALE_SESSION', session, receiptIds };
  }
  if (session.activeAttempt) return { status: 'INTERRUPTED_UNKNOWN_OUTCOME', reasonCode: 'IN_FLIGHT_ATTEMPT_REQUIRES_RECONCILIATION', session, receiptIds };
  return { status: 'CURRENT', reasonCode: 'CURRENT', session, receiptIds };
}

// Read-only reconciliation never assigns a changed file to the owner without
// a matching observed receipt. Unknown and partial outcomes are intentionally terminal for automatic recovery.
export function reconcileFeedbackSession(options) {
  const session = readFeedbackSession(options.feedbackId, options);
  if (!session.activeAttempt) return { status: 'NOT_INTERRUPTED', session, receiptIds: [], changedPaths: [] };
  const current = feedbackFacts(options); const attempt = session.activeAttempt;
  const receipts = current.receipts.filter((r) => r.metadata.attemptId === attempt.attemptId && r.metadata.failureId === attempt.failureId);
  const scope = feedbackActionScope(current, attempt.action);
  const changedPaths = scope.paths.filter((p, i) => p.fingerprint !== attempt.scopeBefore.paths[i]?.fingerprint).map((p) => p.path);
  const stateChanged = current.fingerprint !== attempt.stateBefore;
  const outcome = (['ACTION_COMPLETE', 'VALIDATING'].includes(session.state) && current.fingerprint === session.currentStateFingerprint) || receipts.length ? 'ACTION_APPLIED' :
    !stateChanged && session.reasonCode === 'ATTEMPT_RESERVED' ? 'ACTION_NOT_APPLIED' :
      changedPaths.length && changedPaths.length < attempt.scopeBefore.paths.length ? 'ACTION_PARTIALLY_APPLIED' :
        stateChanged && !changedPaths.length ? 'EXTERNAL_CHANGE_DETECTED' : 'ACTION_OUTCOME_UNKNOWN';
  return { status: 'INTERRUPTED_UNKNOWN_OUTCOME', outcome, session, receiptIds: receipts.map((r) => r.receiptId), changedPaths,
    stateFingerprint: current.fingerprint, validation: validationSummary(current), completionAssessmentId: current.assessment.assessmentId };
}

export function cancelFeedbackSession(options) {
  const s = readFeedbackSession(options.feedbackId, options);
  if (s.outcome) return s;
  return save({ ...s, state: 'FINISHED', outcome: 'CANCELLED', reasonCode: 'OWNER_CANCELLED' }, options, s);
}

function refused(session, reasonCode, options, outcome = 'REPLAN_REQUIRED') {
  return save({ ...session, state: outcome === 'REPLAN_REQUIRED' ? 'STALE' : 'FINISHED', outcome, reasonCode }, options, session);
}

export async function runFeedbackIteration(options) {
  const resumed = resumeFeedbackSession(options); let session = resumed.session;
  if (session.state === 'STALE') return session;
  if (session.activeAttempt) throw new Error('FEEDBACK_BUSY: explicit owner recovery required');
  if (resumed.status !== 'CURRENT') return refused(session, resumed.reasonCode, options);
  if (session.outcome) return session;
  if (options.signal?.aborted) return cancelFeedbackSession(options);
  const before = feedbackFacts(options); const failure = selectFeedbackFailure(before.failures);
  if (before.assessment.assessmentId !== session.currentAssessmentId) return refused(session, 'ASSESSMENT_CHANGED_OUTSIDE_SESSION', options);
  const next = disposition(session, before);
  if (next.outcome) return save(next, options, session);
  const input = feedbackDiagnosisContext(session, before, failure);
  recordFeedbackContextReuse(before, input.contextArtifactRefs?.length ?? 0);
  let diagnosis;
  try { diagnosis = await options.diagnose?.(structuredClone(input)); } catch { return refused(session, 'DIAGNOSIS_FAILED', options, 'INVALID_STATE'); }
  if (!validateFeedbackDiagnosis(diagnosis, input)) return refused(session, 'INVALID_DIAGNOSIS_OR_ACTION', options, 'INVALID_STATE');
  diagnosis = structuredClone(diagnosis);
  const current = feedbackState(options);
  if (current.fingerprint !== before.fingerprint) return refused(session, 'CONCURRENT_CHANGE', options);
  if (readFeedbackSession(session.feedbackId, options).fingerprint !== session.fingerprint) throw new Error('FEEDBACK_BUSY');
  const hypothesis = hypothesisFingerprint(diagnosis.hypothesis);
  const action = { kind: diagnosis.proposedActionKind, repository: diagnosis.affectedScope.repository,
    paths: [...diagnosis.affectedScope.paths].sort(), validationRequirementIds: [...diagnosis.validationRequirementIds].sort(), command: normalizeActionCommand(diagnosis.actionCommand) };
  const semanticActionFingerprint = operationalActionFingerprint(action); const fingerprint = actionFingerprint(action, failure.failureId, before.fingerprint);
  const previous = session.attempts.filter((a) => a.failureId === failure.failureId && !a.progress.materialProgress);
  // An attempt's own receipts change the raw state fingerprint. Its recorded
  // post-state is still the same relevant state for duplicate-action policy.
  if (previous.some((a) => a.actionSemanticFingerprint === semanticActionFingerprint && a.hypothesisFingerprint === hypothesis &&
    [a.stateBefore, a.stateAfter].includes(before.fingerprint))) {
    return refused(session, 'REJECT_DUPLICATE_ACTION', options, 'NO_PROGRESS');
  }
  if (previous.some((a) => a.hypothesisFingerprint === hypothesis && a.actionSemanticFingerprint !== semanticActionFingerprint)) return refused(session, 'NEW_HYPOTHESIS_REQUIRED', options, 'NO_PROGRESS');
  if (['EDIT', 'REVIEW', 'INSPECT'].includes(action.kind) && typeof options.act !== 'function') return refused(session, 'OWNER_EXECUTOR_REQUIRED', options);
  const number = session.attempts.length + 1;
  let attempt = sealFeedback({ schemaVersion: 1, attemptId: `AT-${digest([session.feedbackId, number]).slice(7)}`, feedbackId: session.feedbackId,
    attemptNumber: number, goalReference: session.goalReference, baselineReference: session.baselineReference,
    failureId: failure.failureId, failureClass: failure.failureClass, repository: failure.repository, diagnosis,
    hypothesis: diagnosis.hypothesis, hypothesisFingerprint: hypothesis, action, actionSemanticFingerprint: semanticActionFingerprint, actionFingerprint: fingerprint,
    selectionReason: previous.some((a) => a.hypothesisFingerprint === hypothesis) ? `${input.selectionReason}:STATE_CHANGED_RECONSIDERATION` : input.selectionReason, dependencyStatus: failure.dependencyStatus,
    stateBefore: before.fingerprint, stateAfter: null, scopeBefore: feedbackActionScope(before, action), scopeAfter: null, changedFiles: [], validationBefore: validationSummary(before), validationAfter: null,
    completionBefore: before.assessment.assessmentId, completionAfter: null, executionRefs: [], receiptIds: [], progress: initialProgress(), outcome: null,
    lineage: [], contextMetrics: { bytes: Buffer.byteLength(JSON.stringify(input)), tokenProxy: Math.ceil(Buffer.byteLength(JSON.stringify(input)) / 4) } });
  session = save({ ...session, state: 'ACTING', activeAttempt: attempt, reasonCode: 'ATTEMPT_RESERVED' }, options, session);
  const executor = feedbackExecutor(session, before, attempt, options);
  let errorCode = null;
  try {
    executor.guard();
    session = save({ ...session, state: 'ACTING', activeAttempt: attempt, reasonCode: 'ACTION_EXECUTING' }, options, session); executor.setCheckpoint(session);
    if (action.kind === 'REPLAN') executor.context.replan();
    else if (['EDIT', 'REVIEW', 'INSPECT'].includes(action.kind)) await options.act(executor.context);
    const afterAction = executor.guard();
    attempt = sealFeedback({ ...attempt, ...executor.result(), stateAfter: afterAction.fingerprint });
    session = save({ ...session, state: 'ACTION_COMPLETE', activeAttempt: attempt, currentStateFingerprint: afterAction.fingerprint }, options, session);
    executor.setCheckpoint(session);
    session = save({ ...session, state: 'VALIDATING' }, options, session); executor.setCheckpoint(session);
    await options.validate?.(executor.context);
    await executor.context.validate();
    executor.guard();
  } catch (error) {
    errorCode = ['STATE_CHANGED', 'EXTERNAL_CHANGE_DETECTED', 'READ_ONLY_CONTRACT_VIOLATION'].includes(error.message) ? 'CONCURRENT_CHANGE' :
      ['CONCURRENT_CHANGE', 'FEEDBACK_BUSY', 'CANCELLED', 'PLAN_INPUT_REVIEW_REQUIRED'].includes(error.message) ? error.message : 'EXECUTOR_FAILED';
    if (errorCode === 'FEEDBACK_BUSY') throw error;
  }
  return finishAttempt(session, before, attempt, executor, options, errorCode);
}

function finishAttempt(session, before, attempt, executor, options, errorCode = null) {
  let after;
  try { after = feedbackFacts(options); storeFeedbackAssessment(after); }
  catch { return refused(session, 'GOAL_OR_REVISION_CHANGED', options); }
  const progress = compareFeedbackProgress(before, after, { previousNoProgress: session.progressState.consecutiveNoProgress,
    validationBefore: before.validation, validationAfter: after.validation });
  const execution = executor.result();
  const failed = errorCode || after.receipts.some((r) => execution.receiptIds.includes(r.receiptId) && r.result === 'FAIL');
  attempt = sealFeedback({ ...attempt, ...execution, stateAfter: after.fingerprint, scopeAfter: execution.scopeAfter, validationAfter: validationSummary(after),
    completionAfter: after.assessment.assessmentId, progress, outcome: errorCode === 'CONCURRENT_CHANGE' ? 'INTERRUPTED' :
      after.assessment.decision === 'ADMISSIBLE' ? 'SUCCEEDED' : failed ? 'ACTION_FAILED' : progress.regression ? 'REGRESSION' : progress.materialProgress ? 'PROGRESS' : 'SAME',
    lineage: failureLineage(before, after, { ...attempt, ...execution }) });
  persistFeedbackAttempt(attempt, after);
  let completed = { ...session, activeAttempt: null, attempts: [...session.attempts, attemptIndex(attempt)],
    currentAssessmentId: after.assessment.assessmentId, currentStateFingerprint: after.fingerprint, currentFailureSet: after.failures,
    failureSetFingerprint: failureSetFingerprint(after.failures), progressState: progress, reasonCode: errorCode ?? attempt.outcome,
    state: progress.materialProgress ? 'READY' : 'REASSESS_CAUSE' };
  if (['CONCURRENT_CHANGE', 'PLAN_INPUT_REVIEW_REQUIRED'].includes(errorCode)) completed = { ...completed, state: 'STALE', outcome: 'REPLAN_REQUIRED' };
  else if (errorCode === 'CANCELLED') completed = { ...completed, state: 'FINISHED', outcome: 'CANCELLED' };
  else if (after.assessment.decision !== 'ADMISSIBLE' && progress.consecutiveNoProgress >= session.attemptBudget.noProgressLimit) {
    completed = { ...completed, state: 'FINISHED', outcome: 'NO_PROGRESS', reasonCode: 'NO_MATERIAL_PROGRESS' };
  } else completed = disposition(completed, after);
  return save(completed, options, session);
}

// Recovery is explicit: the owner must confirm that the previous executor has stopped.
// Only a durably completed action with unchanged state may proceed to validation.
export async function recoverFeedbackSession(options) {
  if (options.ownerStopped !== true) throw new Error('OWNER_STOP_CONFIRMATION_REQUIRED');
  if (ownershipBlockers(options).length) throw new Error('OWNERSHIP_RECONCILIATION_REQUIRED');
  let session = readFeedbackSession(options.feedbackId, options);
  if (!session.activeAttempt) {
    const current = resumeFeedbackSession(options);
    return current.status === 'CURRENT' || session.state === 'STALE' ? session : refused(session, current.reasonCode, options);
  }
  if (session.state === 'ACTING' || session.state === 'INTERRUPTED_UNKNOWN_OUTCOME') {
    const reconciliation = reconcileFeedbackSession(options);
    if (reconciliation.outcome !== 'ACTION_APPLIED') {
      session = save({ ...session, state: 'INTERRUPTED_UNKNOWN_OUTCOME', reasonCode: reconciliation.outcome }, options, session);
      return refused(session, reconciliation.outcome, options);
    }
    const activeAttempt = sealFeedback({ ...session.activeAttempt, receiptIds: reconciliation.receiptIds,
      stateAfter: reconciliation.stateFingerprint, scopeAfter: feedbackActionScope(feedbackFacts(options), session.activeAttempt.action) });
    session = save({ ...session, state: 'ACTION_COMPLETE', activeAttempt, currentStateFingerprint: reconciliation.stateFingerprint,
      reasonCode: 'RECONCILED_ACTION_APPLIED' }, options, session);
  }
  const current = feedbackFacts(options);
  if (!['ACTION_COMPLETE', 'VALIDATING'].includes(session.state) || current.fingerprint !== session.currentStateFingerprint ||
    current.fingerprint !== session.activeAttempt.stateAfter) return refused(session, 'INTERRUPTED_STATE_REQUIRES_REPLAN', options);
  const attempt = session.activeAttempt;
  const before = { ...current, assessment: readCompletionAssessment(attempt.completionBefore, options),
    failures: session.currentFailureSet, validation: null };
  session = save({ ...session, state: 'VALIDATING', reasonCode: 'OWNER_RECOVERY_VALIDATION_ONLY' }, options, session);
  const executor = feedbackExecutor(session, current, attempt, options);
  let errorCode = null;
  try { await options.validate?.(executor.context); await executor.context.validate(); executor.guard(); }
  catch (error) {
    if (error.message === 'FEEDBACK_BUSY') throw error;
    errorCode = ['CONCURRENT_CHANGE', 'CANCELLED'].includes(error.message) ? error.message : 'EXECUTOR_FAILED';
  }
  return finishAttempt(session, before, attempt, executor, options, errorCode);
}

export async function runFeedbackLoop(options) {
  const resumed = options.feedbackId ? resumeFeedbackSession(options) : null;
  let session = resumed?.session ?? startFeedbackSession(options);
  if (resumed?.status === 'STALE' && session.state !== 'STALE') return refused(session, resumed.reasonCode, options);
  if (session.activeAttempt) throw new Error('FEEDBACK_BUSY: explicit owner recovery required');
  while (!session.outcome && session.state === 'READY') {
    session = await runFeedbackIteration({ ...options, feedbackId: session.feedbackId });
  }
  return session;
}

async function main() {
  const [command, ...values] = process.argv.slice(2); const args = {};
  for (let i = 0; i < values.length; i += 2) {
    if (!['--root', '--thread-id', '--goal-run-id', '--revision', '--feedback-id', '--diagnosis', '--attempt-budget'].includes(values[i]) || !values[i + 1]) throw new Error('INVALID_FEEDBACK_ARGUMENTS');
    args[values[i].slice(2)] = values[i + 1];
  }
  const options = { root: path.resolve(args.root ?? process.cwd()), identity: { schemaVersion: 1, threadId: args['thread-id'],
    goalRunId: args['goal-run-id'], revision: Number(args.revision) }, feedbackId: args['feedback-id'],
  ...(args['attempt-budget'] ? { attemptBudget: Number(args['attempt-budget']) } : {}), diagnose: () => JSON.parse(args.diagnosis) };
  if (options.feedbackId && !FEEDBACK_ID.test(options.feedbackId)) throw new Error('INVALID_FEEDBACK_REFERENCE');
  const result = command === 'start' ? startFeedbackSession(options) : command === 'resume' || command === 'inspect' ? resumeFeedbackSession(options) :
    command === 'step' ? await runFeedbackIteration(options) : command === 'run' ? await runFeedbackLoop(options) :
      command === 'cancel' ? cancelFeedbackSession(options) : null;
  if (!result) throw new Error('Use start, inspect, resume, step, run or cancel');
  console.log(JSON.stringify(result, null, 2));
  if (result.outcome && result.outcome !== 'SUCCEEDED' || result.status && result.status !== 'CURRENT') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error.message); process.exitCode = 1;
});
