import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertIdentity, stable } from './wayper-context-identity.mjs';
import { readWorkingContext } from './wayper-context.mjs';
import { validateCompletionAssessment } from './wayper-completion-boundary.mjs';
import { ASSESSMENT_ID, completionIndex, validateCompletionAssessmentSchema } from './wayper-completion-policy.mjs';
import { digest, exact } from './wayper-validation-policy.mjs';

export function contextStoreFile(root, area, parts) {
  if (!path.isAbsolute(root ?? '')) throw new Error('Absolute completion owner root required');
  if (!['completion', 'feedback'].includes(area)) throw new Error('Invalid context artifact area');
  let file = fs.realpathSync(root);
  const all = ['.wayper-context', area, ...parts];
  for (const [index, part] of all.entries()) {
    if (!/^[A-Za-z0-9._-]+$/.test(part) || ['.', '..'].includes(part)) throw new Error('Unsafe completion reference');
    file = path.join(file, part);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || (index === all.length - 1 ? !stat.isFile() || stat.size > 1_048_576 : !stat.isDirectory()))) {
      throw new Error('Unsafe completion store');
    }
  }
  return file;
}

const storeFile = (root, parts) => contextStoreFile(root, 'completion', parts);

export function writeContextArtifact(file, value, immutable = true, exclusive = false) {
  const content = JSON.stringify(value);
  if (Buffer.byteLength(content) > 1_048_576) throw new Error('Completion store byte budget exceeded');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (!immutable) fs.renameSync(temp, file);
    else try { fs.linkSync(temp, file); } catch (error) {
      if (exclusive || error.code !== 'EEXIST' || stable(JSON.parse(fs.readFileSync(file, 'utf8'))) !== stable(value)) throw error;
    }
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

const atomicWrite = writeContextArtifact;

export function completionAssessmentPath(id, { root, identity }) {
  assertIdentity(identity);
  if (!ASSESSMENT_ID.test(id)) throw new Error('Invalid assessment ID');
  return storeFile(root, [identity.goalRunId, `r${identity.revision}`, `${id}.json`]);
}

export function readCompletionAssessment(id, options) {
  const file = completionAssessmentPath(id, options);
  if (!fs.existsSync(file)) return null;
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.assessmentId !== id) throw new Error('Assessment filename mismatch');
  return value;
}

export function persistCompletionAssessment(assessment, options) {
  if (validateCompletionAssessment(assessment, options).status !== 'CURRENT') throw new Error('Cannot publish stale or invalid assessment');
  atomicWrite(completionAssessmentPath(assessment.assessmentId, options), assessment);
  return assessment;
}

export function validCompletionIndexReference(map, options) {
  if (!map.completion || map.completion.stale) return true;
  try {
    const a = readCompletionAssessment(map.completion.assessmentId, { ...options, identity: map.execution.identity });
    if (!validateCompletionAssessmentSchema(a) || stable(a.goalReference) !== stable(map.execution.identity) ||
      a.baselineReference.fingerprint !== map.execution.baseline.fingerprint) return false;
    return stable(map.completion) === stable(completionIndex(a, map));
  } catch { return false; }
}

export function recordCompletionAttempt(assessment, options) {
  const identity = options.identity; assertIdentity(identity);
  if (!validateCompletionAssessmentSchema(assessment) || stable(assessment.goalReference) !== stable(identity)) throw new Error('Invalid completion attempt');
  const event = { schemaVersion: 1, eventId: crypto.randomUUID(), observedAt: new Date().toISOString(),
    goalReference: identity, assessmentId: assessment.assessmentId, decision: assessment.decision,
    blockerKinds: [...new Set(assessment.blockers.map((b) => b.kind))].sort(),
    acceptedUnknowns: assessment.acceptedUnknowns.length, staleAssessment: options.staleAssessment === true };
  atomicWrite(storeFile(options.root, [identity.goalRunId, `r${identity.revision}`, 'attempts', `${event.eventId}.json`]), event);
  return event;
}

export function completionTelemetry(events) {
  return { completionAttempts: events.length, admissible: events.filter((e) => e.decision === 'ADMISSIBLE').length,
    rejected: events.filter((e) => e.decision !== 'ADMISSIBLE').length,
    staleAssessments: events.filter((e) => e.staleAssessment).length,
    revalidationRequests: events.filter((e) => e.decision === 'REVALIDATION_REQUIRED').length,
    replanRequests: events.filter((e) => e.decision === 'REPLAN_REQUIRED').length,
    externalBlocks: events.filter((e) => e.decision === 'BLOCKED_EXTERNAL').length,
    acceptedUnknowns: events.reduce((sum, e) => sum + e.acceptedUnknowns, 0),
    blockerKinds: Object.fromEntries([...new Set(events.flatMap((e) => e.blockerKinds))].sort()
      .map((kind) => [kind, events.filter((e) => e.blockerKinds.includes(kind)).length])) };
}

// An explicit request binds this Stop session to an exact execution; no thread-based discovery.
export function bindCompletionStop({ root, identity, turnId = null }) {
  assertIdentity(identity);
  if (turnId !== null && (typeof turnId !== 'string' || !turnId || turnId.length > 200)) throw new Error('Invalid Stop turn');
  const state = readWorkingContext(root, { 'thread-id': identity.threadId, 'goal-run-id': identity.goalRunId, revision: identity.revision });
  const binding = { schemaVersion: 1, goalReference: identity, baselineFingerprint: state.execution.baseline.fingerprint, turnId };
  atomicWrite(storeFile(root, ['stop', `${digest(identity.threadId).slice(7)}.json`]), binding, false);
  return binding;
}

export function completionStopBinding(root, payload) {
  if (!payload.session_id) return { coverage: 'UNBOUND', identity: null };
  const file = storeFile(root, ['stop', `${digest(payload.session_id).slice(7)}.json`]);
  if (!fs.existsSync(file)) return { coverage: 'UNBOUND', identity: null };
  const binding = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!exact(binding, 'schemaVersion goalReference baselineFingerprint turnId') || binding.schemaVersion !== 1) throw new Error('Invalid Stop binding');
  assertIdentity(binding.goalReference);
  if (binding.goalReference.threadId !== payload.session_id) throw new Error('Wrong Stop session');
  if (binding.turnId !== null && binding.turnId !== payload.turn_id) return { coverage: 'UNBOUND_TURN', identity: null };
  const state = readWorkingContext(root, { 'thread-id': binding.goalReference.threadId,
    'goal-run-id': binding.goalReference.goalRunId, revision: binding.goalReference.revision });
  if (state.execution.baseline.fingerprint !== binding.baselineFingerprint) {
    throw new Error('STALE_STOP_BINDING: explicit completion request required');
  }
  return { coverage: binding.turnId === null ? 'EXPLICIT_SESSION_BINDING' : 'EXPLICIT_TURN_BINDING', identity: binding.goalReference };
}
