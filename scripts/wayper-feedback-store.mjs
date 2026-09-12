import fs from 'node:fs';
import path from 'node:path';
import { assertIdentity, stable } from './wayper-context-identity.mjs';
import { contextStoreFile, writeContextArtifact, readCompletionAssessment } from './wayper-completion-store.mjs';
import { validateCompletionAssessmentSchema } from './wayper-completion-policy.mjs';
import { FEEDBACK_ID, ATTEMPT_ID, feedbackIndex } from './wayper-feedback-policy.mjs';
import { validateFeedbackAttempt, validateFeedbackSession, attemptIndex, sealFeedback } from './wayper-feedback-schema.mjs';
import { exact } from './wayper-validation-policy.mjs';
import { readReceipt, validateReceipt } from './wayper-evidence-store.mjs';

function artifact(feedbackId, name, { root, identity }) {
  assertIdentity(identity);
  if (!FEEDBACK_ID.test(feedbackId) || !/^(?:\d{6}|AT-[a-f0-9]{64})\.json$/.test(name)) throw new Error('INVALID_FEEDBACK_REFERENCE');
  return contextStoreFile(root, 'feedback', [identity.goalRunId, `r${identity.revision}`, feedbackId, name]);
}
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function assertContinuation(s, previous) {
  if (!previous) return;
  const transitions = { READY: ['ACTING', 'FINISHED', 'STALE'], REASSESS_CAUSE: ['ACTING', 'FINISHED', 'STALE'],
    ACTING: ['ACTION_COMPLETE', 'READY', 'REASSESS_CAUSE', 'FINISHED', 'STALE'], ACTION_COMPLETE: ['VALIDATING', 'FINISHED', 'STALE'],
    VALIDATING: ['VALIDATING', 'READY', 'REASSESS_CAUSE', 'FINISHED', 'STALE'], FINISHED: ['STALE'], STALE: [] };
  if (!transitions[previous.state].includes(s.state) || stable(previous.baselineReference) !== stable(s.baselineReference) ||
    stable(previous.attemptBudget) !== stable(s.attemptBudget) || s.attempts.length < previous.attempts.length ||
    s.attempts.length > previous.attempts.length + 1 ||
    stable(s.attempts.slice(0, previous.attempts.length)) !== stable(previous.attempts) ||
    s.attempts.length > previous.attempts.length && s.attempts.at(-1).attemptId !== previous.activeAttempt?.attemptId) {
    throw new Error('FEEDBACK_HISTORY_REWRITTEN');
  }
}
export function readFeedbackAttempt(feedbackId, attemptId, options) {
  if (!ATTEMPT_ID.test(attemptId)) throw new Error('INVALID_ATTEMPT_REFERENCE');
  const a = read(artifact(feedbackId, `${attemptId}.json`, options));
  if (!validateFeedbackAttempt(a) || a.attemptId !== attemptId || a.feedbackId !== feedbackId ||
    stable(a.goalReference) !== stable(options.identity)) throw new Error('INVALID_ATTEMPT');
  return a;
}
export function readFeedbackHistory(feedbackId, options) {
  const dir = path.dirname(artifact(feedbackId, '000001.json', options));
  if (!fs.existsSync(dir)) throw new Error('STALE_OR_WRONG_FEEDBACK: missing session');
  const names = fs.readdirSync(dir).filter((n) => /^\d{6}\.json$/.test(n)).sort();
  if (!names.length || names.length > 32) throw new Error('INVALID_FEEDBACK_HISTORY');
  let previous = null;
  return names.map((name, index) => {
    const envelope = read(artifact(feedbackId, name, options)); const s = envelope.session;
    if (!exact(envelope, 'schemaVersion observedAt session') || envelope.schemaVersion !== 1 ||
      !Number.isFinite(Date.parse(envelope.observedAt)) || !validateFeedbackSession(s) || s.feedbackId !== feedbackId ||
      stable(s.goalReference) !== stable(options.identity) || s.sequence !== index + 1 ||
      s.previousFingerprint !== previous?.fingerprint && !(index === 0 && s.previousFingerprint === null) ||
      name !== `${String(s.sequence).padStart(6, '0')}.json`) throw new Error('INVALID_FEEDBACK_HISTORY');
    assertContinuation(s, previous);
    for (const ref of s.attempts) if (stable(ref) !== stable(attemptIndex(readFeedbackAttempt(feedbackId, ref.attemptId, options)))) throw new Error('INVALID_ATTEMPT_INDEX');
    const a = readCompletionAssessment(s.currentAssessmentId, options);
    if (!validateCompletionAssessmentSchema(a) || stable(a.goalReference) !== stable(s.goalReference) ||
      stable(a.baselineReference) !== stable(s.baselineReference) || s.outcome === 'SUCCEEDED' && a.decision !== 'ADMISSIBLE') throw new Error('INVALID_FEEDBACK_COMPLETION_REFERENCE');
    previous = s; return envelope;
  });
}
export const readFeedbackSession = (id, options) => readFeedbackHistory(id, options).at(-1).session;

// Exclusive next checkpoint reserves this session's attempt before any callback can act.
// This is a bounded session journal, not a lease/CAS system for product files or other writers.
export function appendFeedbackCheckpoint(value, options, previous = null) {
  const s = sealFeedback({ ...value, sequence: (previous?.sequence ?? 0) + 1, previousFingerprint: previous?.fingerprint ?? null });
  if (!validateFeedbackSession(s)) throw new Error('INVALID_FEEDBACK_SESSION');
  const assessment = readCompletionAssessment(s.currentAssessmentId, options);
  if (!validateCompletionAssessmentSchema(assessment) || stable(assessment.goalReference) !== stable(s.goalReference) ||
    stable(assessment.baselineReference) !== stable(s.baselineReference) ||
    s.outcome === 'SUCCEEDED' && assessment.decision !== 'ADMISSIBLE') throw new Error('INVALID_FEEDBACK_COMPLETION_REFERENCE');
  if (previous && readFeedbackSession(s.feedbackId, options).fingerprint !== previous.fingerprint) throw new Error('FEEDBACK_BUSY');
  assertContinuation(s, previous);
  for (const ref of s.attempts) if (stable(ref) !== stable(attemptIndex(readFeedbackAttempt(s.feedbackId, ref.attemptId, options)))) throw new Error('INVALID_ATTEMPT_INDEX');
  try { writeContextArtifact(artifact(s.feedbackId, `${String(s.sequence).padStart(6, '0')}.json`, options),
    { schemaVersion: 1, observedAt: new Date().toISOString(), session: s }, true, true); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('FEEDBACK_BUSY'); throw error; }
  return s;
}
export function persistFeedbackAttempt(a, options) {
  if (!validateFeedbackAttempt(a) || stable(a.goalReference) !== stable(options.identity)) throw new Error('INVALID_FEEDBACK_ATTEMPT');
  for (const id of a.receiptIds) {
    const receipt = readReceipt(id, options);
    if (!receipt || !['VALID', 'STALE'].includes(validateReceipt(receipt, options).status) ||
      receipt.metadata.attemptId !== a.attemptId || receipt.metadata.failureId !== a.failureId ||
      receipt.metadata.taskId !== a.feedbackId || a.repository !== null && receipt.repositoryReference.repositoryId !== a.repository) {
      throw new Error('INVALID_FEEDBACK_RECEIPT_BINDING');
    }
  }
  writeContextArtifact(artifact(a.feedbackId, `${a.attemptId}.json`, options), a);
  return a;
}
export function validateFeedbackIndex(index, options) {
  try {
    const history = readFeedbackHistory(index.feedbackId, options);
    const snapshot = history.find((e) => e.session.sequence === index.sequence)?.session;
    return Boolean(snapshot && stable(index) === stable(feedbackIndex(snapshot)));
  } catch { return false; }
}

export function feedbackTelemetry(histories) {
  const last = histories.map((h) => h.at(-1).session); const attempts = last.flatMap((s) => s.attempts);
  const count = (outcome) => last.filter((s) => s.outcome === outcome).length;
  return { sessionsStarted: last.length, sessionsSucceeded: count('SUCCEEDED'), attempts: attempts.length,
    attemptsPerSession: last.map((s) => ({ feedbackId: s.feedbackId, attempts: s.attempts.length })),
    sameFailureCount: attempts.filter((a) => a.progress.relation === 'SAME').length, noProgressCount: count('NO_PROGRESS'),
    replans: attempts.filter((a) => a.failureClass === 'REPLAN').length, revalidations: attempts.filter((a) => a.failureClass === 'REVALIDATE').length,
    externalBlocks: count('BLOCKED_EXTERNAL'), humanEscalations: count('HUMAN_REQUIRED'), budgetExhaustions: count('EXHAUSTED'),
    regressions: attempts.filter((a) => a.progress.regression).length,
    diagnosisContextBytes: attempts.reduce((sum, a) => sum + a.contextMetrics.bytes, 0),
    diagnosisContextTokenProxy: attempts.reduce((sum, a) => sum + a.contextMetrics.tokenProxy, 0),
    timeToAdmissibleMs: histories.filter((h) => h.at(-1).session.outcome === 'SUCCEEDED').map((h) =>
      Date.parse(h.at(-1).observedAt) - Date.parse(h[0].observedAt)), providerTokens: 'UNKNOWN' };
}
