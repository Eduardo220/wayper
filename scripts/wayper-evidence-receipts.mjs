import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertIdentity, stable } from './wayper-context-identity.mjs';

export const EVIDENCE_SCHEMA_VERSION = 1;
export const EVIDENCE_KINDS = Object.freeze(['SOURCE', 'DOCUMENT', 'COMMAND', 'TEST',
  'QUALITY_GATE', 'RUNTIME', 'GRAPH', 'REVIEW', 'HUMAN_DECISION']);
export const EVIDENCE_ORIGINS = Object.freeze(['SOURCE_OBSERVED', 'RUNNER_OBSERVED', 'HOST_OBSERVED',
  'HANDOFF_ASSERTED', 'MODEL_ASSERTED', 'HUMAN_ASSERTED', 'IMPORTED_LEGACY']);
export const HASH = /^sha256:[a-f0-9]{64}$/;
export const RECEIPT_ID = /^ER-[a-f0-9]{64}$/;
export const evidenceHash = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === keys.split(' ').sort().join('|');
const text = (value, limit = 240) => typeof value === 'string' && Boolean(value.trim()) &&
  Buffer.byteLength(value) <= limit && !/[\u0000-\u0008]/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const date = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const safeEvidencePath = (value) => text(value) && !path.isAbsolute(value) &&
  !value.includes('\\') && !value.split('/').some((part) => ['..', '.', ''].includes(part));
const range = (value) => {
  const match = /^L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(value ?? '');
  return match && Number.isSafeInteger(Number(match[2] ?? match[1])) && Number(match[2] ?? match[1]) >= Number(match[1]);
};
export const canonicalEvidenceRange = (value) => value == null ? null : String(value).replace(/^(L\d+)-\1$/, '$1');

export function redactEvidenceText(value) {
  return String(value ?? '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED_KEY]')
    .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)?\s*[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*)["']?[^\s,"';]+/gi, '$1[REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]');
}

export function evidenceText(value, limit = 240) {
  const sanitized = redactEvidenceText(value).trim().replace(/\s+/g, ' ');
  if (!text(sanitized, limit)) throw new Error('Invalid bounded evidence text');
  return sanitized;
}

// Shared with Context Map: observe bytes, never interpret the source as correctness.
export function sourceFingerprint(root, relativePath, rangeValue = null) {
  if (!safeEvidencePath(relativePath)) throw new Error(`Invalid repository path: ${relativePath}`);
  const file = path.resolve(root, relativePath);
  if (!fs.existsSync(file)) return null;
  const real = fs.realpathSync(file); const realRoot = fs.realpathSync(root);
  if (!real.startsWith(`${realRoot}${path.sep}`)) throw new Error('Path escapes repository through symlink');
  if (!fs.statSync(real).isFile()) throw new Error('Not a repository file');
  const bytes = fs.readFileSync(real);
  if (rangeValue === null) return { hash: evidenceHash(bytes), bytes: bytes.length };
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = source.split(/\r?\n/);
  if (rangeValue !== null && !range(rangeValue)) throw new Error('Invalid source range');
  const match = rangeValue?.match(/^L(\d+)(?:-L(\d+))?$/);
  if (match && Number(match[2] ?? match[1]) > lines.length) throw new Error(`Artifact range exceeds file: ${relativePath}`);
  const content = match ? lines.slice(Number(match[1]) - 1, Number(match[2] ?? match[1])).join('\n') : source;
  return { hash: evidenceHash(content), bytes: Buffer.byteLength(content) };
}

function validObservation(receipt) {
  const o = receipt.observation;
  if (!o || typeof o !== 'object') return false;
  if (o.type === 'ASSERTION') return exact(o, 'type summary environment') && text(o.summary) &&
    (o.environment === null || text(o.environment)) && receipt.result === 'UNKNOWN' &&
    ['HANDOFF_ASSERTED', 'MODEL_ASSERTED', 'HUMAN_ASSERTED', 'IMPORTED_LEGACY'].includes(receipt.origin);
  if (o.type === 'FILE') return exact(o, 'type bytes') && integer(o.bytes) &&
    ['SOURCE', 'DOCUMENT'].includes(receipt.kind) && receipt.origin === 'SOURCE_OBSERVED' && receipt.result === 'OBSERVED' &&
    safeEvidencePath(receipt.subject.path);
  if (o.type === 'EXECUTION') return exact(o, 'type executionId command commandFingerprint cwd startedAt finishedAt exitCode signal stdoutFingerprint stderrFingerprint stdoutBytes stderrBytes outputPolicy stateBefore stateAfter counts') &&
    receipt.kind === 'COMMAND' && receipt.origin === 'RUNNER_OBSERVED' &&
    /^[a-f0-9-]{36}$/.test(o.executionId) && text(o.command) && HASH.test(o.commandFingerprint) &&
    (o.cwd === '.' || safeEvidencePath(o.cwd)) && date(o.startedAt) && date(o.finishedAt) && o.startedAt <= o.finishedAt &&
    (o.exitCode === null || integer(o.exitCode)) && (o.signal === null || text(o.signal, 40)) &&
    [o.stdoutFingerprint, o.stderrFingerprint, o.stateBefore, o.stateAfter].every((v) => HASH.test(v)) &&
    integer(o.stdoutBytes) && integer(o.stderrBytes) && o.outputPolicy === 'HASH_ONLY' && validCounts(o.counts) &&
    receipt.result === (o.exitCode === 0 && o.signal === null ? 'PASS' : 'FAIL') &&
    receipt.subject.fingerprint === o.stateBefore;
  if (o.type === 'DERIVATION') return exact(o, 'type commandReceiptId executionId counts') &&
    ['TEST', 'QUALITY_GATE'].includes(receipt.kind) && receipt.origin === 'RUNNER_OBSERVED' &&
    RECEIPT_ID.test(o.commandReceiptId) && /^[a-f0-9-]{36}$/.test(o.executionId) && validCounts(o.counts) &&
    ['PASS', 'FAIL'].includes(receipt.result) && receipt.parentReceiptIds.length === 1 &&
    receipt.parentReceiptIds[0] === o.commandReceiptId;
  if (o.type === 'GRAPH_REFERENCE') return exact(o, 'type graphPath corpusFingerprint graphFingerprint queryFingerprint resultFingerprint freshness') &&
    receipt.kind === 'GRAPH' && receipt.origin === 'MODEL_ASSERTED' && receipt.result === 'UNKNOWN' &&
    safeEvidencePath(o.graphPath) && [o.corpusFingerprint, o.graphFingerprint, o.queryFingerprint, o.resultFingerprint]
      .every((v) => HASH.test(v)) && ['CURRENT', 'STALE', 'UNKNOWN'].includes(o.freshness);
  return false;
}

const validCounts = (counts) => counts === null || exact(counts, 'total passed failed skipped') &&
  Object.values(counts).every(integer) && counts.passed + counts.failed + counts.skipped <= counts.total;

export function validateReceiptSchema(receipt) {
  try {
    if (!exact(receipt, 'schemaVersion receiptId goalReference baselineReference repositoryReference kind origin subject observation result producedAt producer contentFingerprint parentReceiptIds metadata') ||
      receipt.schemaVersion !== EVIDENCE_SCHEMA_VERSION || !RECEIPT_ID.test(receipt.receiptId) ||
      !HASH.test(receipt.contentFingerprint) || !EVIDENCE_KINDS.includes(receipt.kind) || !EVIDENCE_ORIGINS.includes(receipt.origin) ||
      !exact(receipt.baselineReference, 'fingerprint repositoryFingerprint') ||
      !Object.values(receipt.baselineReference).every((v) => HASH.test(v)) ||
      !exact(receipt.repositoryReference, 'repositoryId checkoutFingerprint branch head dirty contentFingerprint') ||
      !['wayper', 'wayper-site'].includes(receipt.repositoryReference.repositoryId) ||
      !HASH.test(receipt.repositoryReference.checkoutFingerprint) || !HASH.test(receipt.repositoryReference.contentFingerprint) ||
      !/^[a-f0-9]{40,64}$/.test(receipt.repositoryReference.head) || typeof receipt.repositoryReference.dirty !== 'boolean' ||
      !(receipt.repositoryReference.branch === null || text(receipt.repositoryReference.branch)) ||
      !exact(receipt.subject, 'path range target fingerprint') ||
      !(receipt.subject.path === null || safeEvidencePath(receipt.subject.path)) ||
      !(receipt.subject.range === null || range(receipt.subject.range) && receipt.subject.path !== null) ||
      !text(receipt.subject.target) || !HASH.test(receipt.subject.fingerprint) ||
      !date(receipt.producedAt) || !exact(receipt.producer, 'name version') ||
      !text(receipt.producer.name, 80) || receipt.producer.version !== 1 ||
      !Array.isArray(receipt.parentReceiptIds) || receipt.parentReceiptIds.length > 64 ||
      new Set(receipt.parentReceiptIds).size !== receipt.parentReceiptIds.length ||
      !receipt.parentReceiptIds.every((id) => RECEIPT_ID.test(id)) ||
      !receipt.metadata || Array.isArray(receipt.metadata) || typeof receipt.metadata !== 'object' ||
      Object.entries(receipt.metadata).some(([key, value]) => !['taskId', 'attemptId', 'failureId'].includes(key) || !text(value, 120)) ||
      !validObservation(receipt) || Buffer.byteLength(JSON.stringify(receipt)) > 12_288) throw new Error('schema');
    assertIdentity(receipt.goalReference);
    return { status: 'VALID', reasons: [] };
  } catch { return { status: 'INVALID_SCHEMA', reasons: ['INVALID_SCHEMA'] }; }
}

// Public canonicalization proves integrity only. It grants no producer authority.
export function sealReceipt(value) {
  const { receiptId: ignoredId, contentFingerprint: ignoredHash, ...content } = value;
  const contentFingerprint = evidenceHash(stable(content));
  return { ...structuredClone(content), contentFingerprint, receiptId: `ER-${contentFingerprint.slice(7)}` };
}

export function receiptIntegrityValid(receipt) {
  const sealed = sealReceipt(receipt);
  return sealed.receiptId === receipt.receiptId && sealed.contentFingerprint === receipt.contentFingerprint;
}

export function validateEvidenceRequirement(policy) {
  const keys = ['kinds', 'repository', 'target', 'path', 'range', 'fingerprint', 'result'];
  const valid = policy && typeof policy === 'object' && !Array.isArray(policy) &&
    Object.keys(policy).every((key) => keys.includes(key)) && Array.isArray(policy.kinds) &&
    policy.kinds.length > 0 && policy.kinds.length <= EVIDENCE_KINDS.length &&
    new Set(policy.kinds).size === policy.kinds.length && policy.kinds.every((kind) => EVIDENCE_KINDS.includes(kind)) &&
    ['wayper', 'wayper-site'].includes(policy.repository) && ['PASS', 'OBSERVED'].includes(policy.result) &&
    (policy.target === undefined || text(policy.target)) && (policy.path === undefined || safeEvidencePath(policy.path)) &&
    (policy.range == null || safeEvidencePath(policy.path) && range(policy.range)) &&
    (policy.fingerprint === undefined || HASH.test(policy.fingerprint)) && (policy.target || policy.path);
  return { status: valid ? 'VALID' : 'INVALID_REQUIREMENT' };
}

export function requirementPolicy(item) {
  const separator = item.id.indexOf(':');
  const qualified = separator > 0 && ['wayper', 'wayper-site'].includes(item.id.slice(0, separator));
  const repository = qualified ? item.id.slice(0, separator) : 'wayper';
  const target = qualified ? item.id.slice(separator + 1) : item.id;
  if (['SOURCE', 'DOCUMENT'].includes(item.kind)) {
    const [file, lines = null] = target.split('#');
    return { kinds: [item.kind], repository, path: file, range: lines, result: 'OBSERVED' };
  }
  return { kinds: ['COMMAND', 'TEST', 'QUALITY_GATE'].includes(item.kind) ? [item.kind] : ['TEST', 'QUALITY_GATE'],
    repository, target, result: 'PASS' };
}
