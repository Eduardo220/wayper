import fs from 'node:fs';
import path from 'node:path';
import { assertGoalExecution, repositorySnapshot, stable } from './wayper-context-identity.mjs';
import { RECEIPT_ID, receiptIntegrityValid, validateEvidenceRequirement, canonicalEvidenceRange,
  sourceFingerprint, validateReceiptSchema } from './wayper-evidence-receipts.mjs';

export function evidenceRepositories(options) {
  return options.repositories ?? options.repositoryDefinitions ?? [{ id: 'wayper', root: options.root }];
}

function directory({ root, execution, repositories, repositoryDefinitions }) {
  assertGoalExecution(execution);
  const owner = root ?? (repositories ?? repositoryDefinitions)?.find((repo) => repo.id === 'wayper')?.root;
  if (!owner || !path.isAbsolute(owner)) throw new Error('Evidence store requires the Working Context owner root');
  const parts = ['.wayper-context', 'evidence', execution.identity.goalRunId, `r${execution.identity.revision}`];
  let current = fs.realpathSync(owner);
  for (const part of parts) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('Unsafe evidence store directory');
  }
  return current;
}

export function receiptPath(id, options) {
  if (!RECEIPT_ID.test(id ?? '')) throw new Error('Invalid receipt reference');
  const file = path.join(directory(options), `${id}.json`);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.size > 12_288)) throw new Error('Unsafe receipt file');
  return file;
}

export function readReceipt(id, options) {
  const file = receiptPath(id, options);
  if (!fs.existsSync(file)) return null;
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (receipt?.receiptId !== id) throw new Error('Receipt ID does not match its file');
  return receipt;
}

export function listReceipts(options) {
  const dir = directory(options);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^ER-[a-f0-9]{64}\.json$/.test(name)).sort()
    .map((name) => readReceipt(name.slice(0, -5), options));
}

export function validateReceipt(receipt, options = {}) {
  const snapshots = new Map(); const visiting = new Set();
  const validate = (value) => {
    const reasons = [];
    const fail = (reason) => { if (!reasons.includes(reason)) reasons.push(reason); };
    const result = () => {
      const invalid = reasons.some((reason) => !['STALE_SUBJECT', 'STALE_REPOSITORY', 'STALE_GRAPH', 'STALE_PARENT', 'STATE_CHANGED_DURING_EXECUTION',
        'UNVERIFIED_ORIGIN'].includes(reason));
      const status = invalid ? 'INVALID' : reasons.some((reason) => reason !== 'UNVERIFIED_ORIGIN') ? 'STALE' :
        reasons.length ? 'UNVERIFIED' : 'VALID';
      return { receiptId: value?.receiptId ?? null, status, verification: status === 'VALID' ? 'VERIFIED' :
        status === 'UNVERIFIED' ? 'UNVERIFIED' : status, reasons: [...reasons].sort(), result: value?.result ?? 'UNKNOWN' };
    };
    if (validateReceiptSchema(value).status !== 'VALID') { fail('INVALID_SCHEMA'); return result(); }
    if (!receiptIntegrityValid(value)) { fail('INVALID_FINGERPRINT'); return result(); }
    try { assertGoalExecution(options.execution); } catch { fail('MISSING_EXECUTION'); return result(); }
    const identity = options.execution.identity;
    if (value.goalReference.goalRunId !== identity.goalRunId || value.goalReference.threadId !== identity.threadId) fail('WRONG_GOAL');
    if (value.goalReference.revision !== identity.revision) fail('WRONG_REVISION');
    if (value.baselineReference.fingerprint !== options.execution.baseline.fingerprint) fail('WRONG_BASELINE');
    const repository = value.repositoryReference.repositoryId;
    const baseline = options.execution.baseline.repositories.find((repo) => repo.repositoryId === repository);
    const definition = evidenceRepositories(options).find((repo) => repo.id === repository);
    if (!baseline || !definition || (options.repository && options.repository !== repository)) fail('WRONG_REPOSITORY');
    if (baseline && value.baselineReference.repositoryFingerprint !== baseline.contentFingerprint) fail('WRONG_BASELINE');
    if (reasons.length) return result();
    try {
      const persisted = readReceipt(value.receiptId, options);
      if (!persisted) fail('UNRECORDED_RECEIPT');
      else if (stable(persisted) !== stable(value)) fail('INVALID_FINGERPRINT');
      if (!snapshots.has(repository)) snapshots.set(repository, repositorySnapshot(definition));
      const current = snapshots.get(repository);
      if (current.checkoutFingerprint !== value.repositoryReference.checkoutFingerprint) fail('WRONG_REPOSITORY');
      if (current.head !== value.repositoryReference.head || current.branch !== value.repositoryReference.branch) fail('STALE_REPOSITORY');
      const o = value.observation;
      if (o.type === 'FILE') {
        let observed;
        try { observed = sourceFingerprint(definition.root, value.subject.path, value.subject.range); }
        catch { /* A moved/shortened/unsafe source cannot retain proof. */ }
        if (!observed || observed.hash !== value.subject.fingerprint || observed.bytes !== o.bytes) fail('STALE_SUBJECT');
      } else if (['EXECUTION', 'DERIVATION'].includes(o.type)) {
        if (current.contentFingerprint !== value.repositoryReference.contentFingerprint ||
          value.subject.fingerprint !== current.contentFingerprint) fail('STALE_REPOSITORY');
        if (o.type === 'EXECUTION' && o.stateBefore !== o.stateAfter) fail('STATE_CHANGED_DURING_EXECUTION');
      } else if (o.type === 'GRAPH_REFERENCE') {
        const graph = sourceFingerprint(definition.root, o.graphPath);
        if (o.freshness === 'STALE' || !graph || graph.hash !== o.graphFingerprint ||
          current.contentFingerprint !== value.repositoryReference.contentFingerprint) fail('STALE_GRAPH');
      }
    } catch { fail('OBSERVATION_UNAVAILABLE'); }
    if (['ASSERTION', 'GRAPH_REFERENCE'].includes(value.observation.type)) fail('UNVERIFIED_ORIGIN');
    if (visiting.has(value.receiptId)) { fail('PARENT_CYCLE'); return result(); }
    visiting.add(value.receiptId);
    for (const id of value.parentReceiptIds) {
      let parent;
      try { parent = readReceipt(id, options); } catch { /* Report a missing or unreadable parent below. */ }
      if (!parent) { fail('MISSING_PARENT'); continue; }
      const checked = validate(parent);
      if (checked.status !== 'VALID') { fail(checked.status === 'STALE' ? 'STALE_PARENT' : 'INVALID_PARENT'); continue; }
      if (stable(parent.repositoryReference) !== stable(value.repositoryReference)) fail('WRONG_PARENT_REPOSITORY');
      if (value.observation.type === 'DERIVATION' && (parent.kind !== 'COMMAND' ||
        parent.observation.executionId !== value.observation.executionId || parent.subject.target !== value.subject.target ||
        parent.subject.fingerprint !== value.subject.fingerprint || parent.result !== value.result ||
        stable(parent.observation.counts) !== stable(value.observation.counts))) fail('INVALID_DERIVATION');
    }
    visiting.delete(value.receiptId);
    return result();
  };
  try { return validate(receipt); }
  catch { return { receiptId: receipt?.receiptId ?? null, status: 'INVALID', verification: 'INVALID', reasons: ['INVALID_SCHEMA'], result: 'UNKNOWN' }; }
}

export function evaluateEvidenceRequirement(requirement, receiptIds, options = {}) {
  const receipts = []; const acceptedReceiptIds = [];
  if (validateEvidenceRequirement(requirement).status !== 'VALID' || !Array.isArray(receiptIds) || receiptIds.length > 64) {
    return { status: 'UNSATISFIED', reasons: ['INVALID_REQUIREMENT_OR_REFERENCES'], acceptedReceiptIds, receipts };
  }
  if (!receiptIds.length) return { status: 'UNSATISFIED', reasons: ['MISSING_RECEIPT'], acceptedReceiptIds, receipts };
  for (const id of receiptIds) {
    let receipt;
    try { receipt = readReceipt(id, options); } catch { /* A raw string is an assertion, never evidence. */ }
    if (!receipt) { receipts.push({ receiptId: id, status: 'UNVERIFIED', verification: 'UNVERIFIED', reasons: ['MISSING_RECEIPT'] }); continue; }
    const checked = validateReceipt(receipt, { ...options, repository: requirement.repository });
    const compatible = requirement.kinds.includes(receipt.kind) && receipt.result === requirement.result &&
      (!requirement.target || receipt.subject.target === requirement.target) &&
      (!requirement.path || receipt.subject.path === requirement.path && canonicalEvidenceRange(requirement.range) === canonicalEvidenceRange(receipt.subject.range)) &&
      (!requirement.fingerprint || receipt.subject.fingerprint === requirement.fingerprint);
    if (!compatible) checked.reasons.push('INCOMPATIBLE_SUBJECT_OR_RESULT');
    if (checked.status === 'VALID' && compatible) acceptedReceiptIds.push(id);
    receipts.push(checked);
  }
  return { status: acceptedReceiptIds.length ? 'SATISFIED' : 'UNSATISFIED', acceptedReceiptIds, receipts,
    reasons: [...new Set(receipts.flatMap((receipt) => receipt.reasons))].sort() };
}

export function receiptIndexEntry(receipt, options) {
  const validation = validateReceipt(receipt, options);
  return { receiptId: receipt.receiptId, kind: receipt.kind, repository: receipt.repositoryReference.repositoryId,
    subject: receipt.subject, origin: receipt.origin, verification: validation.verification, reasons: validation.reasons,
    baselineFingerprint: receipt.baselineReference.fingerprint, result: receipt.result,
    summary: `${receipt.kind} ${receipt.result}`, producer: receipt.producer.name, producedAt: receipt.producedAt };
}

export function inspectEvidenceRequirements(requirements, options) {
  // ponytail: on-demand filesystem validation; indexed queries only if Goal inventories outgrow it.
  const inventory = listReceipts(options).map((receipt) => receiptIndexEntry(receipt, options));
  const ids = inventory.map((item) => item.receiptId);
  return { inventory, requirements: requirements.map((requirement) => {
    const groups = Array.from({ length: Math.max(1, Math.ceil(ids.length / 64)) }, (_, i) =>
      evaluateEvidenceRequirement(requirement, ids.slice(i * 64, (i + 1) * 64), options));
    return { requirement, status: groups.some((group) => group.status === 'SATISFIED') ? 'SATISFIED' : 'UNSATISFIED',
      acceptedReceiptIds: groups.flatMap((group) => group.acceptedReceiptIds), receipts: groups.flatMap((group) => group.receipts),
      reasons: [...new Set(groups.flatMap((group) => group.reasons))].sort() };
  }) };
}
