import { digest, sorted } from './wayper-validation-policy.mjs';

export const FEEDBACK_ID = /^FB-[a-f0-9]{64}$/;
export const FAILURE_ID = /^FL-[a-f0-9]{64}$/;
export const ATTEMPT_ID = /^AT-[a-f0-9]{64}$/;
export const FAILURE_CLASSES = ['INVALID_STATE', 'REPLAN', 'EXTERNAL', 'HUMAN_DECISION', 'FIXABLE', 'REVALIDATE'];
export const ACTIONS = {
  FIXABLE: ['EDIT', 'REVIEW', 'INSPECT', 'REVALIDATE'], REVALIDATE: ['REVALIDATE', 'INSPECT'], REPLAN: ['REPLAN'],
  EXTERNAL: ['EXTERNAL_WAIT'], HUMAN_DECISION: ['HUMAN_ESCALATION'], INVALID_STATE: [],
};
export const OUTCOMES = ['SUCCEEDED', 'EXHAUSTED', 'NO_PROGRESS', 'BLOCKED_EXTERNAL', 'HUMAN_REQUIRED',
  'REPLAN_REQUIRED', 'INVALID_STATE', 'CANCELLED'];
export const STATES = ['READY', 'ACTING', 'ACTION_COMPLETE', 'VALIDATING', 'REASSESS_CAUSE', 'FINISHED', 'STALE'];
export const hypothesisFingerprint = (text) => digest(text.trim().toLowerCase().replace(/\s+/g, ' '));

// Receipt IDs identify observations, not causes: replacing a receipt must not reset a failure budget.
export function failureIdentity(f) {
  return `FL-${digest({ kind: f.kind, sourceId: f.sourceId, reasonCode: f.reasonCode, repository: f.repository,
    relatedRequirementIds: sorted(f.relatedRequirementIds), relatedFindingIds: sorted(f.relatedFindingIds) }).slice(7)}`;
}

export function classifyFeedbackFailures(assessment, { state, plan, receipts = [] } = {}) {
  const failures = new Map();
  for (const b of assessment.blockers.filter((b) => b.blocking)) {
    const finding = state?.contextMap?.findings?.find((f) => b.relatedFindingIds.includes(f.id));
    const evidence = receipts.filter((r) => b.relatedReceiptIds.includes(r.receiptId));
    const requirement = state?.requirements?.find((r) => b.relatedRequirementIds.includes(`${r.kind}:${r.id}`));
    const human = requirement?.receiptRequirement?.kinds.includes('HUMAN_DECISION') || evidence.some((r) => r.kind === 'HUMAN_DECISION');
    const failureClass = b.kind === 'STATE' || /WRONG_GOAL|WRONG_BASELINE|INVALID_SCHEMA/.test(b.reasonCode) ? 'INVALID_STATE' :
      b.kind === 'AMBIGUITY' || /HUMAN_DECISION/.test(b.reasonCode) || human ? 'HUMAN_DECISION' :
        /UNAVAILABLE|EXTERNAL/.test(b.reasonCode) ? 'EXTERNAL' :
          /REPLAN|VALIDATION_PLAN_MISSING/.test(b.reasonCode) ? 'REPLAN' :
            b.kind === 'FINDING' && b.reasonCode === 'OPEN' || /FAILED|^FAIL$/.test(b.reasonCode) || evidence.some((r) => r.result === 'FAIL') ? 'FIXABLE' : 'REVALIDATE';
    const sourceId = b.kind === 'EVIDENCE' ? sorted([...b.relatedRequirementIds, ...b.relatedFindingIds])[0] ??
      evidence[0]?.subject.target ?? b.sourceId : b.kind === 'VALIDATION' && /REPLAN/.test(b.reasonCode) ? 'plan' : b.sourceId;
    const content = { kind: b.kind, sourceId, reasonCode: b.reasonCode, repository: b.repository ??
      (state?.contextMap?.repositories.length === 1 ? state.contextMap.repositories[0] : null),
    relatedRequirementIds: sorted(b.relatedRequirementIds), relatedFindingIds: sorted(b.relatedFindingIds) };
    const failureId = failureIdentity(content);
    const priority = failureClass === 'INVALID_STATE' ? 0 : failureClass === 'REPLAN' ? 1 :
      ['EXTERNAL', 'HUMAN_DECISION'].includes(failureClass) ? 2 : finding?.severity === 'CRITICAL' ? 3 : finding?.severity === 'HIGH' ? 4 :
        failureClass === 'REVALIDATE' ? 5 : 6;
    const previous = failures.get(failureId);
    failures.set(failureId, { ...content, failureId, failureClass, priority, severity: finding?.severity ?? null,
      blockerIds: sorted([...(previous?.blockerIds ?? []), b.blockerId]),
      relatedReceiptIds: sorted([...(previous?.relatedReceiptIds ?? []), ...b.relatedReceiptIds]), dependencyIds: [], dependencyStatus: 'UNKNOWN' });
  }
  const result = [...failures.values()];
  for (const f of result) {
    const requirements = (plan?.requirements ?? []).filter((r) => f.relatedRequirementIds.includes(r.validationRequirementId));
    if (!requirements.length) continue;
    f.dependencyStatus = 'KNOWN';
    const ids = sorted(requirements.flatMap((r) => r.dependencies));
    f.dependencyIds = sorted(result.filter((other) => other.failureId !== f.failureId && other.repository === f.repository &&
      other.relatedRequirementIds.some((id) => ids.includes(id))).map((r) => r.failureId));
  }
  return result.sort((a, b) => a.priority - b.priority || a.failureId.localeCompare(b.failureId));
}

export function feedbackBudget(state, requested) {
  const conservative = ['ARCHITECTURAL', 'CRITICAL_RUNTIME'].includes(state.taskClass) || (state.riskFlags ?? []).some((r) =>
    ['RUN_DATA_LOSS', 'CONCURRENCY', 'LIFECYCLE', 'AUTH_SECURITY', 'DATA_MIGRATION'].includes(r));
  const maximum = conservative ? 2 : 3;
  const total = requested ?? maximum;
  if (!Number.isSafeInteger(total) || total < 0 || total > maximum) throw new Error('INVALID_ATTEMPT_BUDGET');
  return { total, byClass: { FIXABLE: Math.min(total, maximum), REVALIDATE: Math.min(total, 2), REPLAN: Math.min(total, 2),
    EXTERNAL: 0, HUMAN_DECISION: 0, INVALID_STATE: 0 }, noProgressLimit: 2 };
}

export function selectFeedbackFailure(failures) {
  return failures.find((f) => f.dependencyIds.length === 0) ?? null;
}

export function compareFeedbackProgress(before, after, { previousNoProgress = 0, validationBefore, validationAfter } = {}) {
  const ids = (a) => sorted(a.failures.map((f) => f.failureId));
  const oldIds = ids(before); const newIds = ids(after);
  const removed = oldIds.filter((id) => !newIds.includes(id)); const added = newIds.filter((id) => !oldIds.includes(id));
  const relation = !newIds.length ? 'RESOLVED' : !removed.length && !added.length ? 'SAME' :
    removed.length && !added.length ? 'REDUCED' : added.length && !removed.length ? 'EXPANDED' : 'CHANGED';
  const satisfied = (a, v) => sorted([...(a.assessment.requirementState ?? []).filter((r) => r.status === 'SATISFIED').map((r) => r.sourceId),
    ...(v?.requirements ?? []).filter((r) => r.status === 'SATISFIED').map((r) => r.validationRequirementId)]);
  const oldSatisfied = satisfied(before, validationBefore);
  const satisfiedRequirementIds = satisfied(after, validationAfter).filter((id) => !oldSatisfied.includes(id));
  const newCritical = after.failures.some((f) => added.includes(f.failureId) && f.severity === 'CRITICAL');
  const severity = (f) => [null, 'INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].indexOf(f.severity);
  const raisedSeverity = after.failures.some((f) => before.failures.some((old) => old.failureId === f.failureId && severity(f) > severity(old)));
  const regression = relation === 'EXPANDED' || newCritical || raisedSeverity || newIds.length > oldIds.length;
  const materialProgress = !regression && (relation === 'REDUCED' || after.assessment.decision === 'ADMISSIBLE' || satisfiedRequirementIds.length > 0);
  return { relation, materialProgress, regression, removedFailureIds: removed, addedFailureIds: added, satisfiedRequirementIds,
    consecutiveNoProgress: materialProgress ? 0 : previousNoProgress + 1 };
}

export const failureSetFingerprint = (failures) => digest(failures.map(({ failureId, failureClass, severity, dependencyIds }) =>
  ({ failureId, failureClass, severity, dependencyIds })).sort((a, b) => a.failureId.localeCompare(b.failureId)));

export function feedbackDecisionRequest(session, failure) {
  return { decisionId: `FD-${digest([session.feedbackId, failure.failureId]).slice(7)}`, reason: failure.reasonCode,
    context: { failureId: failure.failureId, repository: failure.repository, sourceId: failure.sourceId,
      relatedRequirementIds: failure.relatedRequirementIds.slice(0, 8), relatedFindingIds: failure.relatedFindingIds.slice(0, 8) },
    options: [], impact: 'Material blocker remains; owner must obtain the required authoritative decision.', blockedGoal: session.goalReference };
}

export function feedbackIndex(session) {
  const attempt = session.activeAttempt ?? session.attempts.at(-1);
  return { feedbackId: session.feedbackId, sequence: session.sequence, fingerprint: session.fingerprint,
    state: session.state, activeFailureIds: session.currentFailureSet.slice(0, 8).map((f) => f.failureId),
    failures: session.currentFailureSet.slice(0, 8).map((f) => ({ ...f, relatedRequirementIds: f.relatedRequirementIds.slice(0, 8),
      relatedFindingIds: f.relatedFindingIds.slice(0, 8), relatedReceiptIds: f.relatedReceiptIds.slice(0, 8),
      blockerIds: f.blockerIds.slice(0, 8), dependencyIds: f.dependencyIds.slice(0, 8) })),
    attemptId: attempt?.attemptId ?? null, attemptNumber: attempt?.attemptNumber ?? 0,
    receiptIds: (attempt?.receiptIds ?? []).slice(-8), progress: session.progressState.relation, outcome: session.outcome,
    failedHypotheses: session.attempts.filter((a) => !a.progress.materialProgress).slice(-2).map((a) => ({ failureId: a.failureId,
      repository: a.repository, hypothesis: a.hypothesis, actionFingerprint: a.actionFingerprint })),
    omitted: Math.max(0, session.currentFailureSet.length - 8) };
}

export function packetFeedbackContext(map, repositories, paths) {
  if (!map.feedback) return undefined;
  const f = map.feedback;
  const failures = f.failures.filter((r) => repositories.includes(r.repository));
  const relevant = new Set(failures.map((r) => r.failureId));
  return { feedbackId: f.feedbackId, sessionFingerprint: f.fingerprint, attemptId: f.attemptId, state: f.state,
    failures: failures.map(({ failureId, failureClass, repository, sourceId, reasonCode, relatedReceiptIds }) =>
      ({ failureId, failureClass, repository, sourceId, reasonCode, receiptIds: relatedReceiptIds.slice(0, 8) })),
    failedHypotheses: f.failedHypotheses.filter((h) => relevant.has(h.failureId)),
    scope: paths.filter((p) => repositories.some((r) => p.startsWith(`${r}:`))) };
}
