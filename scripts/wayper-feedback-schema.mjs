import { assertIdentity } from './wayper-context-identity.mjs';
import { HASH, RECEIPT_ID, safeEvidencePath } from './wayper-evidence-receipts.mjs';
import { ASSESSMENT_ID } from './wayper-completion-policy.mjs';
import { digest, exact } from './wayper-validation-policy.mjs';
import { FEEDBACK_ID, FAILURE_ID, ATTEMPT_ID, FAILURE_CLASSES, ACTIONS, OUTCOMES, STATES, failureIdentity, failureSetFingerprint, hypothesisFingerprint, normalizeActionCommand, operationalActionFingerprint, actionFingerprint } from './wayper-feedback-policy.mjs';

export const shortText = (v) => typeof v === 'string' && v.trim().length > 0 && Buffer.byteLength(v) <= 240;
const refs = (v, regex, max = 128) => Array.isArray(v) && v.length <= max && new Set(v).size === v.length &&
  v.every((s) => shortText(s) && (!regex || regex.test(s)));
const repo = (r) => r === null || ['wayper', 'wayper-site'].includes(r);
const sealed = (v) => HASH.test(v?.fingerprint) && sealFeedback(v).fingerprint === v.fingerprint;
export function sealFeedback(value) { const { fingerprint: _old, ...content } = value; return { ...content, fingerprint: digest(content) }; }
export function validProgress(p) {
  const vector = (v) => exact(v, 'completionRank blockingFailures criticalHighFailures maxSeverity missingValidation staleEvidence materialFindings') &&
    Object.values(v).every((n) => Number.isSafeInteger(n) && n >= 0);
  return exact(p, 'relation materialProgress regression removedFailureIds addedFailureIds satisfiedRequirementIds beforeVector afterVector consecutiveNoProgress') &&
    ['SAME', 'REDUCED', 'CHANGED', 'RESOLVED', 'EXPANDED'].includes(p.relation) && typeof p.materialProgress === 'boolean' &&
    typeof p.regression === 'boolean' && refs(p.removedFailureIds, FAILURE_ID) && refs(p.addedFailureIds, FAILURE_ID) &&
    refs(p.satisfiedRequirementIds) && vector(p.beforeVector) && vector(p.afterVector) && Number.isSafeInteger(p.consecutiveNoProgress) && p.consecutiveNoProgress >= 0;
}
export function validFailure(f) {
  return exact(f, 'kind sourceId reasonCode repository relatedRequirementIds relatedFindingIds failureId failureClass priority severity blockerIds relatedReceiptIds dependencyIds dependencyStatus') &&
    ['STATE', 'REQUIREMENT', 'VALIDATION', 'EVIDENCE', 'FINDING', 'PROOF_GAP', 'AMBIGUITY'].includes(f.kind) &&
    shortText(f.sourceId) && shortText(f.reasonCode) && repo(f.repository) && refs(f.relatedRequirementIds) && refs(f.relatedFindingIds) &&
    FAILURE_ID.test(f.failureId) && f.failureId === failureIdentity(f) && FAILURE_CLASSES.includes(f.failureClass) &&
    Number.isSafeInteger(f.priority) && f.priority >= 0 && f.priority <= 6 && [null, 'INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(f.severity) &&
    refs(f.blockerIds, /^CB-[a-f0-9]{24}$/) && refs(f.relatedReceiptIds, RECEIPT_ID) && refs(f.dependencyIds, FAILURE_ID) &&
    ['KNOWN', 'UNKNOWN'].includes(f.dependencyStatus);
}
export function validateFeedbackDiagnosis(d, context) {
  try { normalizeActionCommand(d.actionCommand); } catch { return false; }
  return exact(d, 'failureIds causeClass summary hypothesis confidence affectedScope proposedActionKind validationRequirementIds evidenceRefs actionCommand') &&
    refs(d.failureIds, FAILURE_ID, 1) && d.failureIds[0] === context.failure.failureId && d.causeClass === context.failure.failureClass &&
    shortText(d.summary) && shortText(d.hypothesis) && Number.isFinite(d.confidence) && d.confidence >= 0 && d.confidence <= 1 &&
    exact(d.affectedScope, 'repository paths') && d.affectedScope.repository === context.failure.repository &&
    refs(d.affectedScope.paths, null, 16) && d.affectedScope.paths.every(safeEvidencePath) &&
    ACTIONS[d.causeClass]?.includes(d.proposedActionKind) && (d.proposedActionKind !== 'EDIT' || d.affectedScope.paths.length > 0) &&
    refs(d.validationRequirementIds, /^VR-[a-f0-9]{24}$/, 16) && refs(d.evidenceRefs, null, 16) &&
    d.evidenceRefs.every((id) => context.evidenceRefs.includes(id));
}
const validation = (v) => exact(v, 'planId status fingerprint') && (v.planId === null || /^VP-[a-f0-9]{64}$/.test(v.planId)) &&
  ['LEGACY_UNPLANNED', 'COMPLETE', 'INCOMPLETE', 'BLOCKED', 'REPLAN_REQUIRED'].includes(v.status) && HASH.test(v.fingerprint);
export function validateFeedbackAttempt(a) {
  try {
    const scope = (v) => exact(v, 'repository paths') && repo(v.repository) && Array.isArray(v.paths) && v.paths.length <= 16 &&
      v.paths.every((p) => exact(p, 'path fingerprint') && safeEvidencePath(p.path) && (p.fingerprint === null || HASH.test(p.fingerprint)));
    const lineage = (v) => Array.isArray(v) && v.length <= 1024 && v.every((item) => exact(item, 'failureId relatedFailureId relation evidenceRefs') &&
      FAILURE_ID.test(item.failureId) && (item.relatedFailureId === null || FAILURE_ID.test(item.relatedFailureId)) &&
      ['SAME_ROOT', 'CAUSED_BY_ATTEMPT', 'SUPERSEDES', 'INDEPENDENT', 'UNKNOWN'].includes(item.relation) && refs(item.evidenceRefs, RECEIPT_ID, 64));
    if (!exact(a, 'schemaVersion attemptId feedbackId attemptNumber goalReference baselineReference failureId failureClass repository diagnosis hypothesis hypothesisFingerprint action actionSemanticFingerprint actionFingerprint selectionReason dependencyStatus stateBefore stateAfter scopeBefore scopeAfter changedFiles validationBefore validationAfter completionBefore completionAfter executionRefs receiptIds progress lineage outcome contextMetrics fingerprint') ||
      a.schemaVersion !== 1 || !ATTEMPT_ID.test(a.attemptId) || !FEEDBACK_ID.test(a.feedbackId) || !FAILURE_ID.test(a.failureId) ||
      !Number.isSafeInteger(a.attemptNumber) || a.attemptNumber < 1 || a.attemptNumber > 3 || !FAILURE_CLASSES.includes(a.failureClass) ||
      !repo(a.repository) || !exact(a.baselineReference, 'fingerprint') || !HASH.test(a.baselineReference.fingerprint) ||
      !shortText(a.hypothesis) || !HASH.test(a.hypothesisFingerprint) || !HASH.test(a.actionSemanticFingerprint) || !HASH.test(a.actionFingerprint) ||
      !exact(a.action, 'kind repository paths validationRequirementIds command') || !ACTIONS[a.failureClass].includes(a.action.kind) ||
      a.action.repository !== a.repository || !refs(a.action.paths, null, 16) || !a.action.paths.every(safeEvidencePath) ||
      !refs(a.action.validationRequirementIds, /^VR-[a-f0-9]{24}$/, 16) || normalizeActionCommand(a.action.command) === undefined || !shortText(a.selectionReason) ||
      !['KNOWN', 'UNKNOWN'].includes(a.dependencyStatus) || !HASH.test(a.stateBefore) || !(a.stateAfter === null || HASH.test(a.stateAfter)) ||
      !scope(a.scopeBefore) || !(a.scopeAfter === null || scope(a.scopeAfter)) ||
      !refs(a.changedFiles, null, 128) || !validation(a.validationBefore) || !(a.validationAfter === null || validation(a.validationAfter)) ||
      !ASSESSMENT_ID.test(a.completionBefore) || !(a.completionAfter === null || ASSESSMENT_ID.test(a.completionAfter)) ||
      !refs(a.executionRefs, RECEIPT_ID, 64) || !refs(a.receiptIds, RECEIPT_ID, 64) || !validProgress(a.progress) || !lineage(a.lineage) ||
      ![null, 'SUCCEEDED', 'PROGRESS', 'SAME', 'REGRESSION', 'ACTION_FAILED', 'INTERRUPTED'].includes(a.outcome) ||
      !exact(a.contextMetrics, 'bytes tokenProxy') || !Number.isSafeInteger(a.contextMetrics.bytes) || a.contextMetrics.bytes < 0 ||
      a.contextMetrics.tokenProxy !== Math.ceil(a.contextMetrics.bytes / 4) || !sealed(a)) return false;
    assertIdentity(a.goalReference);
    if (a.attemptId !== `AT-${digest([a.feedbackId, a.attemptNumber]).slice(7)}` ||
      a.actionSemanticFingerprint !== operationalActionFingerprint(a.action) || a.actionFingerprint !== actionFingerprint(a.action, a.failureId, a.stateBefore) || a.hypothesisFingerprint !== hypothesisFingerprint(a.hypothesis) ||
      a.action.kind !== a.diagnosis.proposedActionKind || digest(a.action.paths) !== digest([...a.diagnosis.affectedScope.paths].sort()) ||
      digest(a.action.validationRequirementIds) !== digest([...a.diagnosis.validationRequirementIds].sort()) ||
      a.outcome !== null && (!a.stateAfter || !a.validationAfter || !a.completionAfter)) return false;
    return validateFeedbackDiagnosis(a.diagnosis, { failure: { failureId: a.failureId, failureClass: a.failureClass, repository: a.repository },
      evidenceRefs: a.diagnosis.evidenceRefs }) && a.hypothesis === a.diagnosis.hypothesis;
  } catch { return false; }
}
export function attemptIndex(a) {
  return Object.fromEntries(['attemptId', 'attemptNumber', 'failureId', 'failureClass', 'repository', 'hypothesis',
    'hypothesisFingerprint', 'actionSemanticFingerprint', 'actionFingerprint', 'stateBefore', 'stateAfter', 'receiptIds', 'progress', 'lineage', 'outcome', 'contextMetrics', 'fingerprint'].map((key) => [key, a[key]]));
}
export function validateFeedbackSession(s) {
  try {
    if (!exact(s, 'schemaVersion feedbackId goalReference baselineReference initialAssessmentId currentAssessmentId finalAssessmentId targetBlockerIds state attemptBudget attempts activeAttempt currentFailureSet failureSetFingerprint currentStateFingerprint progressState outcome reasonCode decisionRequest sequence previousFingerprint fingerprint') ||
      s.schemaVersion !== 1 || !FEEDBACK_ID.test(s.feedbackId) || !exact(s.baselineReference, 'fingerprint') || !HASH.test(s.baselineReference.fingerprint) ||
      !ASSESSMENT_ID.test(s.initialAssessmentId) || !ASSESSMENT_ID.test(s.currentAssessmentId) ||
      !(s.finalAssessmentId === null || ASSESSMENT_ID.test(s.finalAssessmentId)) || !refs(s.targetBlockerIds, /^CB-[a-f0-9]{24}$/, 1024) ||
      !STATES.includes(s.state) || !exact(s.attemptBudget, 'total byClass noProgressLimit') ||
      !Number.isSafeInteger(s.attemptBudget.total) || s.attemptBudget.total < 0 || s.attemptBudget.total > 3 || s.attemptBudget.noProgressLimit !== 2 ||
      !exact(s.attemptBudget.byClass, FAILURE_CLASSES.join(' ')) || Object.values(s.attemptBudget.byClass).some((n) => !Number.isSafeInteger(n) || n < 0 || n > 3) ||
      !Array.isArray(s.attempts) || s.attempts.length > s.attemptBudget.total ||
      !(s.activeAttempt === null || validateFeedbackAttempt(s.activeAttempt)) ||
      !Array.isArray(s.currentFailureSet) || s.currentFailureSet.length > 1024 || !s.currentFailureSet.every(validFailure) ||
      s.failureSetFingerprint !== failureSetFingerprint(s.currentFailureSet) || !HASH.test(s.currentStateFingerprint) || !validProgress(s.progressState) ||
      !(s.outcome === null || OUTCOMES.includes(s.outcome)) || !shortText(s.reasonCode) ||
      !Number.isSafeInteger(s.sequence) || s.sequence < 1 || s.sequence > 32 || !(s.previousFingerprint === null || HASH.test(s.previousFingerprint)) || !sealed(s)) return false;
    assertIdentity(s.goalReference);
    if (['EXTERNAL', 'HUMAN_DECISION', 'INVALID_STATE'].some((c) => s.attemptBudget.byClass[c] !== 0) ||
      s.attemptBudget.byClass.REVALIDATE > 2 || s.attemptBudget.byClass.REPLAN > 2 ||
      Boolean(s.outcome) !== ['FINISHED', 'STALE'].includes(s.state) ||
      s.activeAttempt && (s.activeAttempt.feedbackId !== s.feedbackId || digest(s.activeAttempt.goalReference) !== digest(s.goalReference) ||
        digest(s.activeAttempt.baselineReference) !== digest(s.baselineReference) || s.activeAttempt.attemptNumber !== s.attempts.length + 1 ||
        s.activeAttempt.attemptNumber > s.attemptBudget.total)) return false;
    if (s.feedbackId !== `FB-${digest([s.goalReference, s.baselineReference, s.initialAssessmentId]).slice(7)}`) return false;
    for (const [i, a] of s.attempts.entries()) if (!exact(a, Object.keys(attemptIndex(a)).join(' ')) || a.attemptNumber !== i + 1 ||
      !ATTEMPT_ID.test(a.attemptId) || !FAILURE_ID.test(a.failureId) || !shortText(a.hypothesis) || !refs(a.receiptIds, RECEIPT_ID, 64) ||
      !validProgress(a.progress) || !HASH.test(a.fingerprint)) return false;
    if (s.outcome === 'SUCCEEDED' && (s.currentFailureSet.length || s.finalAssessmentId !== s.currentAssessmentId)) return false;
    if (s.decisionRequest !== null) {
      const d = s.decisionRequest;
      if (!exact(d, 'decisionId reason context options impact blockedGoal') || !/^FD-[a-f0-9]{64}$/.test(d.decisionId) ||
        !shortText(d.reason) || !shortText(d.impact) || !exact(d.context, 'failureId repository sourceId relatedRequirementIds relatedFindingIds') ||
        !FAILURE_ID.test(d.context.failureId) || !repo(d.context.repository) || !shortText(d.context.sourceId) ||
        !refs(d.context.relatedRequirementIds, null, 8) || !refs(d.context.relatedFindingIds, null, 8) || !refs(d.options, null, 8) ||
        digest(d.blockedGoal) !== digest(s.goalReference)) return false;
    }
    return true;
  } catch { return false; }
}
