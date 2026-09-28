import { assertIdentity, stable } from './wayper-context-identity.mjs';
import { HASH, RECEIPT_ID, safeEvidencePath, validateEvidenceRequirement, requirementPolicy } from './wayper-evidence-receipts.mjs';
import { digest, exact, sorted } from './wayper-validation-policy.mjs';

export const COMPLETION_SCHEMA_VERSION = 1;
export const ASSESSMENT_ID = /^CA-[a-f0-9]{64}$/;
export const COMPLETION_DECISIONS = ['ADMISSIBLE', 'NOT_ADMISSIBLE', 'REPLAN_REQUIRED',
  'REVALIDATION_REQUIRED', 'BLOCKED_EXTERNAL', 'INVALID_STATE'];

export const completionRequirementPolicy = (r) => r.receiptRequirement ??
  (['RUNTIME', 'REVIEW', 'HUMAN_DECISION', 'GRAPH'].includes(r.kind) ?
    { ...requirementPolicy(r), kinds: [r.kind] } : requirementPolicy(r));
const text = (s) => typeof s === 'string' && s.trim().length > 0 && Buffer.byteLength(s) <= 240;
const refs = (s) => Array.isArray(s) && s.length <= 128 && new Set(s).size === s.length && s.every(text);
const keys = (o, allowed) => o && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).every((k) => allowed.split(' ').includes(k));

export function completionMapFingerprint(map) {
  const copy = structuredClone(map);
  delete copy.completion; delete copy.feedback; delete copy.metrics; delete copy.learningDelta;
  delete copy.context; // Discovery cache and its counters are not material proof.
  copy.validation = { checks: copy.validation?.checks ?? [] };
  return digest(copy);
}

export function completionDefinition(state) {
  return digest({ objective: state.objective, taskClass: state.taskClass,
    requirements: state.requirements.map(({ kind, id, receiptRequirement, blocking }) => ({ kind, id,
      ...(receiptRequirement ? { receiptRequirement } : {}), blocking: blocking ?? true })).sort((a, b) => stable(a).localeCompare(stable(b))),
    riskFlags: sorted(state.riskFlags), invariants: sorted(state.invariants), validations: sorted(state.validations) });
}

export function validateCompletionLedger(map) {
  const errors = [];
  const repository = (r) => map.repositories.includes(r);
  if (map.findings !== undefined && (!Array.isArray(map.findings) || map.findings.length > 128)) return ['INVALID_FINDING_LEDGER'];
  const ids = new Set();
  for (const f of map.findings ?? []) {
    if (!exact(f, 'id repository paths severity materiality status claim scenario relatedRequirementIds receiptIds resolution') ||
      !/^F-[A-Za-z0-9._-]{1,100}$/.test(f.id) || ids.has(f.id) || !repository(f.repository) ||
      !refs(f.paths) || !f.paths.every(safeEvidencePath) || !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(f.severity) ||
      !['BLOCKING', 'NON_BLOCKING', 'INFORMATIONAL'].includes(f.materiality) ||
      !['OPEN', 'RESOLVED', 'ACCEPTED_RISK', 'NOT_APPLICABLE', 'INVALIDATED'].includes(f.status) ||
      !text(f.claim) || !text(f.scenario) || !refs(f.relatedRequirementIds) || !refs(f.receiptIds) ||
      !f.receiptIds.every((r) => RECEIPT_ID.test(r))) errors.push('INVALID_FINDING');
    ids.add(f.id);
    if (f.resolution !== null) {
      const r = f.resolution;
      if (!exact(r, 'reviewer reason humanDecisionRequired goalReference baselineFingerprint') ||
        r.reviewer !== 'OWNER' || !text(r.reason) || typeof r.humanDecisionRequired !== 'boolean' ||
        !HASH.test(r.baselineFingerprint)) errors.push('INVALID_FINDING_RESOLUTION');
      try { assertIdentity(r.goalReference); } catch { errors.push('INVALID_RESOLUTION_IDENTITY'); }
    }
  }
  for (const g of map.proofGaps ?? []) {
    if (g.materiality !== undefined && !['BLOCKING', 'NON_BLOCKING', 'INFORMATIONAL'].includes(g.materiality) ||
      g.repository !== undefined && !repository(g.repository) ||
      g.relatedRequirementIds !== undefined && !refs(g.relatedRequirementIds)) errors.push('INVALID_PROOF_GAP_MATERIALITY');
    if (g.materiality !== undefined && (!g.repository || !g.relatedRequirementIds)) errors.push('UNSCOPED_PROOF_GAP');
    if (g.repository && g.receiptRequirement && g.repository !== g.receiptRequirement.repository) errors.push('CROSS_REPOSITORY_GAP_PROOF');
  }
  for (const a of map.ambiguities ?? []) {
    if (a.materiality === undefined) continue; // Legacy router ambiguity is not a product blocker.
    if (!['MATERIAL', 'NON_MATERIAL'].includes(a.materiality) || !['OPEN', 'RESOLVED'].includes(a.status) ||
      !repository(a.repository) || !text(a.reason) || !refs(a.relatedRequirementIds) ||
      !refs(a.receiptIds) || !a.receiptIds.every((id) => RECEIPT_ID.test(id))) errors.push('INVALID_MATERIAL_AMBIGUITY');
  }
  return sorted(errors);
}

export function validateCompletionRequirements(requirements) {
  if (!Array.isArray(requirements) || requirements.length > 128) return false;
  const ids = new Set();
  return requirements.every((r) => {
    const id = `${r.kind}:${r.id}`;
    if (ids.has(id)) return false;
    ids.add(id);
    return keys(r, 'kind id status evidence invalidatedEvidence verification receiptRequirement blocking reason') &&
      text(r.kind) && text(r.id) && refs(r.evidence) &&
      ['PENDING', 'SATISFIED', 'UNSATISFIED', 'UNVERIFIED', 'STALE', 'BLOCKED', 'NOT_APPLICABLE', 'REVALIDATION_REQUIRED'].includes(r.status) &&
      (r.blocking === undefined || typeof r.blocking === 'boolean') &&
      (!r.receiptRequirement || validateEvidenceRequirement(r.receiptRequirement).status === 'VALID');
  });
}

export function completionIssue(kind, sourceId, reasonCode, options = {}) {
  const content = { kind, sourceId, reasonCode, repository: options.repository ?? null,
    blocking: options.blocking ?? true, relatedRequirementIds: sorted(options.relatedRequirementIds),
    relatedReceiptIds: sorted(options.relatedReceiptIds).filter((id) => RECEIPT_ID.test(id)), relatedFindingIds: sorted(options.relatedFindingIds) };
  return { blockerId: `CB-${digest({ kind, sourceId, reasonCode, repository: content.repository }).slice(7, 31)}`, ...content };
}

export function sealCompletionAssessment(content) {
  const fingerprint = digest(content);
  return { ...content, fingerprint, assessmentId: `CA-${fingerprint.slice(7)}` };
}

export function validateCompletionAssessmentSchema(a) {
  try {
    if (!exact(a, 'schemaVersion goalReference baselineReference inputFingerprint goalState requirementState validationState evidenceState findingState proofGapState amendmentState blockers warnings acceptedUnknowns decision reasons fingerprint assessmentId') ||
      a.schemaVersion !== 1 || !COMPLETION_DECISIONS.includes(a.decision) || !HASH.test(a.inputFingerprint) ||
      !ASSESSMENT_ID.test(a.assessmentId) || !HASH.test(a.fingerprint) || !refs(a.reasons)) return false;
    if (a.goalReference !== null) assertIdentity(a.goalReference);
    if (a.baselineReference !== null && (!exact(a.baselineReference, 'fingerprint') || !HASH.test(a.baselineReference.fingerprint))) return false;
    if (!exact(a.goalState, 'status contextStatus') || !['INVALID', 'CURRENT'].includes(a.goalState.status) ||
      !['CONTINUE_CONTEXT', 'STOP_WHEN_PROVEN', 'REVALIDATION_REQUIRED', 'LEGACY_UNASSESSED'].includes(a.goalState.contextStatus) ||
      !exact(a.amendmentState, 'revision incorporated') || !(a.amendmentState.revision === null || Number.isSafeInteger(a.amendmentState.revision)) ||
      typeof a.amendmentState.incorporated !== 'boolean') return false;
    for (const field of ['requirementState', 'findingState', 'proofGapState']) {
      if (!Array.isArray(a[field]) || a[field].length > 512 || a[field].some((r) =>
        !exact(r, 'sourceId repository status blocking acceptedReceiptIds') || !text(r.sourceId) ||
        ![null, 'wayper', 'wayper-site'].includes(r.repository) ||
        !(field === 'requirementState' ? ['SATISFIED', 'UNSATISFIED', 'UNVERIFIED', 'STALE', 'BLOCKED', 'NOT_APPLICABLE'] :
          field === 'findingState' ? ['OPEN', 'RESOLVED', 'ACCEPTED_RISK', 'NOT_APPLICABLE', 'INVALIDATED'] : ['OPEN', 'RESOLVED']).includes(r.status) ||
        typeof r.blocking !== 'boolean' ||
        !refs(r.acceptedReceiptIds) || !r.acceptedReceiptIds.every((id) => RECEIPT_ID.test(id)))) return false;
    }
    if (!exact(a.validationState, 'planId status') || !(a.validationState.planId === null || /^VP-[a-f0-9]{64}$/.test(a.validationState.planId)) ||
      !['LEGACY_UNPLANNED', 'COMPLETE', 'INCOMPLETE', 'BLOCKED', 'REPLAN_REQUIRED'].includes(a.validationState.status) ||
      !exact(a.evidenceState, 'acceptedReceiptIds rejectedReceiptIds') || !refs(a.evidenceState.acceptedReceiptIds) ||
      !refs(a.evidenceState.rejectedReceiptIds) || ![...a.evidenceState.acceptedReceiptIds, ...a.evidenceState.rejectedReceiptIds]
        .every((id) => RECEIPT_ID.test(id))) return false;
    for (const field of ['blockers', 'warnings', 'acceptedUnknowns']) {
      if (!Array.isArray(a[field]) || a[field].length > 1024) return false;
      for (const b of a[field]) if (!exact(b, 'blockerId kind sourceId reasonCode repository blocking relatedRequirementIds relatedReceiptIds relatedFindingIds') ||
        !/^CB-[a-f0-9]{24}$/.test(b.blockerId) || !['STATE', 'REQUIREMENT', 'VALIDATION', 'EVIDENCE', 'FINDING', 'PROOF_GAP', 'AMBIGUITY'].includes(b.kind) ||
        !text(b.sourceId) || !text(b.reasonCode) || typeof b.blocking !== 'boolean' || ![null, 'wayper', 'wayper-site'].includes(b.repository) ||
        !['relatedRequirementIds', 'relatedReceiptIds', 'relatedFindingIds'].every((k) => refs(b[k])) ||
        (field === 'blockers') !== b.blocking || stable(completionIssue(b.kind, b.sourceId, b.reasonCode, b)) !== stable(b)) return false;
    }
    const { fingerprint, assessmentId, ...content } = a;
    return sealCompletionAssessment(content).fingerprint === fingerprint && `CA-${fingerprint.slice(7)}` === assessmentId;
  } catch { return false; }
}

export function completionIndex(a, map) {
  return { assessmentId: a.assessmentId, decision: a.decision, mapFingerprint: completionMapFingerprint(map),
    stale: false, blockers: a.blockers.slice(0, 24), warnings: a.warnings.slice(0, 12),
    omitted: Math.max(0, a.blockers.length - 24) + Math.max(0, a.warnings.length - 12) };
}

export function packetCompletionContext(map, repositories, paths) {
  const relevant = (item) => item.repository && repositories.includes(item.repository);
  return { assessmentId: map.completion?.assessmentId ?? null,
    decision: map.completion?.stale ? 'STALE' : map.completion?.decision ?? 'LEGACY_UNASSESSED',
    blockers: (map.completion?.blockers ?? []).filter(relevant).map((b) => ({ blockerId: b.blockerId,
      kind: b.kind, sourceId: b.sourceId, reasonCode: b.reasonCode, repository: b.repository })),
    openFindings: (map.findings ?? []).filter((f) => relevant(f) &&
      (f.status === 'OPEN' || !map.completion || map.completion.stale || map.completion.blockers.some((b) => b.relatedFindingIds.includes(f.id))) &&
      (!paths.length || f.paths.some((p) => paths.includes(`${f.repository}:${p}`))))
      .map((f) => ({ id: f.id, repository: f.repository, severity: f.severity, materiality: f.materiality, status: f.status })) };
}
