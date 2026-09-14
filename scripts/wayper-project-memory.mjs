import fs from 'node:fs';
import path from 'node:path';
import { assertIdentity, stable } from './wayper-context-identity.mjs';
import { redactEvidenceText, safeEvidencePath, sourceFingerprint, RECEIPT_ID } from './wayper-evidence-receipts.mjs';
import { digest, exact, bounded, sorted } from './wayper-validation-policy.mjs';

export const MEMORY_SCHEMA_VERSION = 1;
export const MEMORY_KINDS = Object.freeze(['ARCHITECTURAL_INVARIANT', 'OPERATIONAL_RULE', 'KNOWN_CONSTRAINT',
  'VALIDATED_PATTERN', 'KNOWN_FAILURE_MODE', 'DECISION']);
export const MEMORY_STATUSES = Object.freeze(['CURRENT', 'STALE', 'SUPERSEDED', 'INVALIDATED', 'CONFLICTED']);
export const MEMORY_CONFIDENCE = Object.freeze(['VERIFIED', 'SUPPORTED', 'TENTATIVE']);
const SUPPORT_KINDS = ['SOURCE', 'DOCUMENT', 'EVIDENCE_RECEIPT', 'FINDING', 'FEEDBACK', 'COMPLETION_ASSESSMENT',
  'VALIDATION', 'HUMAN_DECISION', 'MODEL_ASSERTION', 'GRAPHIFY'];
const CANDIDATE_KEYS = 'schemaVersion candidateId goalReference subject proposedKind proposedStatement scope supportingRefs contradictingRefs dependencies durabilityReason promotionStatus fingerprint';
const ENTRY_KEYS = 'schemaVersion memoryId subject kind scope statement provenance confidence validity status dependencies createdAt lastValidatedAt supersedes supersededBy fingerprint';
const INDEX_KEYS = 'schemaVersion entries';
const SENSITIVE = /-----BEGIN [^-]*PRIVATE KEY-----|(?:password|passwd|token|secret|api[_-]?key|authorization)\s*[=:]|(?:postgres|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]+:[^\s]+@|\b(?:gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})\b/i;
const EPHEMERAL = /\b(?:lease|fencing token|grant|mutation permit|context artifact|context packet|raw (?:command )?output|transcript|temporary branch|temporary head|external wip|cache artifact)\b/i;

const validDate = (value) => typeof value === 'string' && new Date(value).toISOString() === value;
const stringList = (value, max = 32) => Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every((item) => bounded(item, 160));
const scopeKey = (scope) => stable({ project: scope.project, repository: scope.repository, paths: sorted(scope.paths),
  capabilities: sorted(scope.capabilities), domains: sorted(scope.domains) });
const memoryIdentity = (value) => digest([value.subject.trim().toLowerCase(), scopeKey(value.scope), value.statement.trim()]);

function validScope(scope) {
  return exact(scope, 'project repository paths capabilities domains') && bounded(scope.project, 80) &&
    (scope.repository === null || ['wayper', 'wayper-site'].includes(scope.repository)) && stringList(scope.paths) &&
    scope.paths.every(safeEvidencePath) && stringList(scope.capabilities) && stringList(scope.domains);
}

function validRef(ref) {
  return exact(ref, 'kind id repository path fingerprint') && SUPPORT_KINDS.includes(ref.kind) && bounded(ref.id, 180) &&
    (ref.repository === null || ['wayper', 'wayper-site'].includes(ref.repository)) &&
    (ref.path === null || safeEvidencePath(ref.path)) && (ref.fingerprint === null || /^sha256:[a-f0-9]{64}$/.test(ref.fingerprint)) &&
    (ref.kind !== 'EVIDENCE_RECEIPT' || RECEIPT_ID.test(ref.id));
}

function validDependency(dependency) {
  return exact(dependency, 'repository path fingerprint') && ['wayper', 'wayper-site'].includes(dependency.repository) &&
    safeEvidencePath(dependency.path) && /^sha256:[a-f0-9]{64}$/.test(dependency.fingerprint);
}

function sealCandidate(value) {
  const { candidateId: _id, fingerprint: _fingerprint, ...body } = value;
  const fingerprint = digest(body);
  return { ...body, candidateId: `LC-${fingerprint.slice(7)}`, fingerprint };
}

export function buildLearningCandidate(input) {
  if (!exact(input, 'goalReference subject proposedKind proposedStatement scope supportingRefs contradictingRefs dependencies durabilityReason') ||
    !bounded(input.subject, 160) || !MEMORY_KINDS.includes(input.proposedKind) || !bounded(input.proposedStatement, 600) ||
    !validScope(input.scope) || !Array.isArray(input.supportingRefs) || input.supportingRefs.length > 24 ||
    !input.supportingRefs.every(validRef) || !Array.isArray(input.contradictingRefs) || input.contradictingRefs.length > 12 ||
    !input.contradictingRefs.every(validRef) || !Array.isArray(input.dependencies) || input.dependencies.length > 16 ||
    !input.dependencies.every(validDependency) || !bounded(input.durabilityReason, 240)) throw new Error('INVALID_LEARNING_CANDIDATE');
  assertIdentity(input.goalReference);
  const value = { schemaVersion: MEMORY_SCHEMA_VERSION, ...structuredClone(input),
    scope: { ...input.scope, paths: sorted(input.scope.paths), capabilities: sorted(input.scope.capabilities), domains: sorted(input.scope.domains) },
    supportingRefs: [...input.supportingRefs].sort((a, b) => stable(a).localeCompare(stable(b))),
    contradictingRefs: [...input.contradictingRefs].sort((a, b) => stable(a).localeCompare(stable(b))),
    dependencies: [...input.dependencies].sort((a, b) => stable(a).localeCompare(stable(b))), promotionStatus: 'CANDIDATE_ONLY' };
  return sealCandidate(value);
}

export function validateLearningCandidate(candidate) {
  try {
    if (!exact(candidate, CANDIDATE_KEYS) || candidate.schemaVersion !== 1 || stable(sealCandidate(candidate)) !== stable(candidate) ||
      !['CANDIDATE_ONLY', 'PROMOTABLE', 'HUMAN_DECISION_REQUIRED', 'REJECTED', 'PROMOTED'].includes(candidate.promotionStatus)) {
      throw new Error('INVALID_LEARNING_CANDIDATE');
    }
    assertIdentity(candidate.goalReference);
    return { status: 'VALID', reasons: [] };
  } catch (error) { return { status: 'INVALID', reasons: [error.message] }; }
}

export function evaluateMemoryPromotion(candidate) {
  if (validateLearningCandidate(candidate).status !== 'VALID') return { decision: 'REJECTED', confidence: 'TENTATIVE', reasons: ['INVALID_CANDIDATE'] };
  const text = stable(candidate);
  if (SENSITIVE.test(text) || text !== redactEvidenceText(text)) return { decision: 'REJECTED', confidence: 'TENTATIVE', reasons: ['SENSITIVE_MATERIAL'] };
  if (EPHEMERAL.test(candidate.subject) || EPHEMERAL.test(candidate.proposedStatement)) {
    return { decision: 'REJECTED', confidence: 'TENTATIVE', reasons: ['EPHEMERAL_OR_RUNTIME_STATE'] };
  }
  if (candidate.contradictingRefs.length) return { decision: 'CANDIDATE_ONLY', confidence: 'TENTATIVE', reasons: ['UNRESOLVED_CONTRADICTION'] };
  const kinds = new Set(candidate.supportingRefs.map((ref) => ref.kind));
  if (kinds.has('MODEL_ASSERTION') && [...kinds].every((kind) => kind === 'MODEL_ASSERTION')) {
    return { decision: 'CANDIDATE_ONLY', confidence: 'TENTATIVE', reasons: ['UNSUPPORTED_ASSERTION'] };
  }
  if (candidate.proposedKind === 'DECISION' && !kinds.has('HUMAN_DECISION')) {
    return { decision: 'HUMAN_DECISION_REQUIRED', confidence: 'TENTATIVE', reasons: ['PRODUCT_OR_PROJECT_DECISION'] };
  }
  const source = kinds.has('SOURCE') && candidate.dependencies.length > 0;
  const documented = kinds.has('DOCUMENT') || kinds.has('HUMAN_DECISION');
  const validated = ['EVIDENCE_RECEIPT', 'COMPLETION_ASSESSMENT', 'VALIDATION'].some((kind) => kinds.has(kind));
  if (!source || !documented || !validated) return { decision: 'CANDIDATE_ONLY', confidence: kinds.size > 1 ? 'SUPPORTED' : 'TENTATIVE', reasons: ['PROVENANCE_INSUFFICIENT'] };
  return { decision: 'AUTO_PROMOTE', confidence: 'VERIFIED', reasons: ['DURABLE_SUPPORTED_NON_SECRET'] };
}

function provenance(refs) {
  const ids = (kind) => sorted(refs.filter((ref) => ref.kind === kind).map((ref) => ref.id));
  return { sourceRefs: refs.filter((ref) => ['SOURCE', 'DOCUMENT', 'HUMAN_DECISION', 'VALIDATION', 'GRAPHIFY', 'MODEL_ASSERTION'].includes(ref.kind)),
    evidenceReceiptIds: ids('EVIDENCE_RECEIPT'), findingIds: ids('FINDING'), feedbackIds: ids('FEEDBACK'),
    completionAssessmentIds: ids('COMPLETION_ASSESSMENT') };
}

function sealEntry(value) {
  const { fingerprint: _fingerprint, ...body } = value;
  return { ...body, fingerprint: digest(body) };
}

export function validateMemoryEntry(entry) {
  try {
    if (!exact(entry, ENTRY_KEYS) || entry.schemaVersion !== 1 || stable(sealEntry(entry)) !== stable(entry) ||
      !/^MM-[a-f0-9]{64}$/.test(entry.memoryId) || !bounded(entry.subject, 160) || !MEMORY_KINDS.includes(entry.kind) ||
      !validScope(entry.scope) || !bounded(entry.statement, 600) || !MEMORY_CONFIDENCE.includes(entry.confidence) ||
      !MEMORY_STATUSES.includes(entry.status) || !exact(entry.validity, 'status reasons') ||
      !['VALIDATED', 'NEEDS_REVALIDATION', 'CONTRADICTED'].includes(entry.validity.status) || !stringList(entry.validity.reasons) ||
      !Array.isArray(entry.dependencies) || entry.dependencies.length > 16 || !entry.dependencies.every(validDependency) || !validDate(entry.createdAt) ||
      !validDate(entry.lastValidatedAt) || !stringList(entry.supersedes) || !stringList(entry.supersededBy) ||
      !exact(entry.provenance, 'sourceRefs evidenceReceiptIds findingIds feedbackIds completionAssessmentIds') ||
      !Array.isArray(entry.provenance.sourceRefs) || entry.provenance.sourceRefs.length > 24 || !entry.provenance.sourceRefs.every(validRef) || ![entry.provenance.evidenceReceiptIds, entry.provenance.findingIds,
        entry.provenance.feedbackIds, entry.provenance.completionAssessmentIds].every(stringList)) throw new Error('INVALID_MEMORY_ENTRY');
    return { status: 'VALID', reasons: [] };
  } catch (error) { return { status: 'INVALID', reasons: [error.message] }; }
}

export function emptyMemoryIndex() { return { schemaVersion: 2, entries: [] }; }
export function validateMemoryIndex(index) {
  const valid = exact(index, INDEX_KEYS) && index.schemaVersion === 2 && Array.isArray(index.entries) && index.entries.length <= 64 && Buffer.byteLength(stable(index)) <= 262_144 &&
    new Set(index.entries.map((entry) => entry.memoryId)).size === index.entries.length && index.entries.every((entry) => validateMemoryEntry(entry).status === 'VALID');
  return { status: valid ? 'VALID' : 'INVALID', reasons: valid ? [] : ['INVALID_MEMORY_INDEX'] };
}

function currentPromotionSupport(candidate, repositories) {
  const checks = [...candidate.dependencies, ...candidate.supportingRefs.filter((ref) =>
    ['SOURCE', 'DOCUMENT'].includes(ref.kind)).map((ref) => ({ repository: ref.repository, path: ref.path, fingerprint: ref.fingerprint }))];
  return checks.length > 0 && checks.every((item) => {
    const definition = repositories.find((repository) => repository.id === item.repository);
    try { return definition && sourceFingerprint(definition.root, item.path).hash === item.fingerprint; }
    catch { return false; }
  });
}

export function promoteLearningCandidate(candidate, index = emptyMemoryIndex(), { now = new Date().toISOString(), repositories = [] } = {}) {
  if (validateMemoryIndex(index).status !== 'VALID') throw new Error('INVALID_MEMORY_INDEX');
  const policy = evaluateMemoryPromotion(candidate);
  if (policy.decision !== 'AUTO_PROMOTE') return { status: policy.decision, policy, index, entry: null };
  if (!currentPromotionSupport(candidate, repositories)) return { status: 'CANDIDATE_ONLY',
    policy: { ...policy, decision: 'CANDIDATE_ONLY', confidence: 'SUPPORTED', reasons: ['PROVENANCE_UNVERIFIED'] }, index, entry: null };
  const memoryId = `MM-${memoryIdentity({ subject: candidate.subject, scope: candidate.scope, statement: candidate.proposedStatement }).slice(7)}`;
  const duplicate = index.entries.find((entry) => entry.memoryId === memoryId);
  if (duplicate) return { status: 'DUPLICATE', policy, index, entry: duplicate };
  const entry = sealEntry({ schemaVersion: 1, memoryId, subject: candidate.subject, kind: candidate.proposedKind,
    scope: candidate.scope, statement: candidate.proposedStatement, provenance: provenance(candidate.supportingRefs),
    confidence: policy.confidence, validity: { status: 'VALIDATED', reasons: [] }, status: 'CURRENT',
    dependencies: candidate.dependencies, createdAt: now, lastValidatedAt: now, supersedes: [], supersededBy: [] });
  if (validateMemoryEntry(entry).status !== 'VALID') throw new Error('INVALID_PROMOTED_MEMORY');
  return { status: 'PROMOTED', policy, entry, index: { ...index, entries: [...index.entries, entry].sort((a, b) => a.memoryId.localeCompare(b.memoryId)) } };
}

export function revalidateMemoryEntry(entry, { repositories = [], contradictionRefs = [], now = new Date().toISOString() } = {}) {
  if (validateMemoryEntry(entry).status !== 'VALID') throw new Error('INVALID_MEMORY_ENTRY');
  if (['SUPERSEDED', 'INVALIDATED'].includes(entry.status)) return entry;
  const reasons = [];
  for (const dependency of entry.dependencies) {
    const definition = repositories.find((item) => item.id === dependency.repository);
    let current = null;
    try { current = definition && sourceFingerprint(definition.root, dependency.path)?.hash; } catch { /* stale below */ }
    if (current !== dependency.fingerprint) reasons.push(`DEPENDENCY_CHANGED:${dependency.repository}:${dependency.path}`);
  }
  if (contradictionRefs.length) reasons.push('CURRENT_SOURCE_CONTRADICTION');
  return sealEntry({ ...entry, status: contradictionRefs.length ? 'CONFLICTED' : reasons.length ? 'STALE' : 'CURRENT',
    validity: { status: contradictionRefs.length ? 'CONTRADICTED' : reasons.length ? 'NEEDS_REVALIDATION' : 'VALIDATED', reasons: sorted(reasons) },
    lastValidatedAt: now });
}

export function supersedeMemory(index, newer, oldIds) {
  if (validateMemoryIndex(index).status !== 'VALID' || validateMemoryEntry(newer).status !== 'VALID' || !stringList(oldIds)) throw new Error('INVALID_SUPERSESSION');
  const known = new Set(index.entries.map((entry) => entry.memoryId));
  if (oldIds.some((id) => !known.has(id) || id === newer.memoryId)) throw new Error('INVALID_SUPERSESSION');
  const replacement = sealEntry({ ...newer, supersedes: sorted([...newer.supersedes, ...oldIds]) });
  const entries = index.entries.filter((entry) => entry.memoryId !== newer.memoryId).map((entry) => oldIds.includes(entry.memoryId) ?
    sealEntry({ ...entry, status: 'SUPERSEDED', supersededBy: sorted([...entry.supersededBy, replacement.memoryId]) }) : entry);
  entries.push(replacement);
  return { schemaVersion: 2, entries: entries.sort((a, b) => a.memoryId.localeCompare(b.memoryId)) };
}

export function markMemoryConflicts(index) {
  const groups = new Map();
  for (const entry of index.entries.filter((item) => item.status === 'CURRENT')) {
    const key = `${entry.subject.trim().toLowerCase()}|${scopeKey(entry.scope)}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const conflicted = new Set([...groups.values()].filter((items) => new Set(items.map((item) => item.statement)).size > 1).flat().map((item) => item.memoryId));
  return { schemaVersion: 2, entries: index.entries.map((entry) => conflicted.has(entry.memoryId) ? sealEntry({ ...entry, status: 'CONFLICTED',
    validity: { status: 'CONTRADICTED', reasons: ['CONFLICTING_CURRENT_ENTRY'] } }) : entry) };
}

export function assertMemoryAuthority(purpose) {
  if (['EVIDENCE', 'AUTHORIZATION', 'COMPLETION'].includes(purpose)) throw new Error(`MEMORY_CANNOT_SATISFY_${purpose}`);
  return { kind: 'MEMORY', authority: 'CONTEXT_ONLY' };
}

export function retrieveProjectMemory({ index, goalReference = null, repository = null, capabilities = [], domains = [], paths = [], query = '', limit = 5,
  includeHistorical = false, repositories = [] }) {
  if (validateMemoryIndex(index).status !== 'VALID' || !Number.isInteger(limit) || limit < 1 || limit > 10 ||
    !stringList(capabilities) || !stringList(domains) || !stringList(paths) || paths.some((item) => !safeEvidencePath(item)) ||
    !(repository === null || ['wayper', 'wayper-site'].includes(repository)) || Buffer.byteLength(query) > 240) throw new Error('INVALID_MEMORY_QUERY');
  if (goalReference !== null) assertIdentity(goalReference);
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  const ranked = index.entries.map((entry) => revalidateMemoryEntry(entry, { repositories })).filter((entry) =>
    (entry.scope.repository === null || entry.scope.repository === repository) && (includeHistorical || entry.status === 'CURRENT')).map((entry) => {
    let score = entry.status === 'CURRENT' ? 100 : entry.status === 'STALE' ? 10 : 0;
    score += entry.confidence === 'VERIFIED' ? 30 : entry.confidence === 'SUPPORTED' ? 15 : 0;
    score += entry.scope.capabilities.filter((item) => capabilities.includes(item)).length * 12;
    score += entry.scope.domains.filter((item) => domains.includes(item)).length * 10;
    score += entry.scope.paths.filter((item) => paths.some((candidate) => candidate === item || candidate.startsWith(`${item}/`) || item.startsWith(`${candidate}/`))).length * 14;
    const haystack = `${entry.subject} ${entry.statement}`.toLowerCase(); score += terms.filter((term) => haystack.includes(term)).length * 2;
    return { entry, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.entry.memoryId.localeCompare(b.entry.memoryId)).slice(0, limit);
  return { schemaVersion: 1, goalReference, authority: 'CONTEXT_ONLY', bounded: true, limit, results: ranked.map(({ entry, score }) => ({
    memoryId: entry.memoryId, subject: entry.subject, statement: entry.statement, repository: entry.scope.repository,
    status: entry.status, confidence: entry.confidence, score, kind: 'MEMORY', authority: 'CONTEXT_ONLY' })) };
}

export function renderMemoryProjection(entry) {
  if (validateMemoryEntry(entry).status !== 'VALID') throw new Error('INVALID_MEMORY_ENTRY');
  const refs = entry.provenance.sourceRefs.map((ref) => `- ${ref.kind}: ${ref.id}`).join('\n') || '- none';
  const dependencies = entry.dependencies.map((item) => `- ${item.repository}:${item.path} @ ${item.fingerprint}`).join('\n') || '- none';
  return `# ${entry.subject}\n\n- Memory ID: \`${entry.memoryId}\`\n- Kind: \`${entry.kind}\`\n- Scope: \`${entry.scope.project}/${entry.scope.repository ?? 'project'}\`\n- Status: \`${entry.status}\`\n- Confidence: \`${entry.confidence}\`\n- Last validation: \`${entry.lastValidatedAt}\`\n\n## Statement\n\n${entry.statement}\n\n## Why we believe this\n\n${refs}\n\n## Dependencies\n\n${dependencies}\n\n## Lineage\n\n- Supersedes: ${entry.supersedes.join(', ') || 'none'}\n- Superseded by: ${entry.supersededBy.join(', ') || 'none'}\n`;
}

export function loadMemoryIndex(root) {
  const file = path.join(root, 'docs/ai/memory/index.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schemaVersion === 1) return { status: 'LEGACY_UNVERIFIED', index: value };
  if (validateMemoryIndex(value).status !== 'VALID') throw new Error('INVALID_MEMORY_INDEX');
  return { status: 'CURRENT', index: value };
}

export function writeMemoryStore(root, index) {
  if (validateMemoryIndex(index).status !== 'VALID') throw new Error('INVALID_MEMORY_INDEX');
  const memoryRoot = path.join(root, 'docs/ai/memory'); const projectionRoot = path.join(memoryRoot, 'topics');
  fs.mkdirSync(projectionRoot, { recursive: true });
  const temporary = path.join(memoryRoot, `.index.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, path.join(memoryRoot, 'index.json'));
  for (const entry of index.entries) fs.writeFileSync(path.join(projectionRoot, `${entry.memoryId}.md`), renderMemoryProjection(entry));
  return index;
}

export function memoryTelemetry({ candidates = [], promotions = [], entries = [], retrievals = [] }) {
  return { learningCandidatesGenerated: candidates.length, candidatesPromoted: promotions.filter((item) => item.status === 'PROMOTED').length,
    candidatesRejected: promotions.filter((item) => item.status === 'REJECTED').length,
    humanDecisionRequired: promotions.filter((item) => item.status === 'HUMAN_DECISION_REQUIRED').length,
    memoryEntriesCurrent: entries.filter((item) => item.status === 'CURRENT').length,
    memoryEntriesStale: entries.filter((item) => item.status === 'STALE').length,
    memoryEntriesSuperseded: entries.filter((item) => item.status === 'SUPERSEDED').length,
    memoryEntriesConflicted: entries.filter((item) => item.status === 'CONFLICTED').length,
    memoryRetrievals: retrievals.length, memoryHits: retrievals.reduce((sum, item) => sum + item.results.length, 0),
    memoryRevalidations: entries.filter((item) => item.validity.status === 'VALIDATED').length,
    memoryInvalidations: entries.filter((item) => ['STALE', 'INVALIDATED', 'CONFLICTED'].includes(item.status)).length,
    duplicateCandidatesAvoided: promotions.filter((item) => item.status === 'DUPLICATE').length };
}
