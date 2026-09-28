import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCapabilityFiles, validateRegistry } from './quality/check-capability-routing.mjs';
import { readWorkingContext, repositoryDefinitions, ROOT } from './wayper-context.mjs';
import { sourceFingerprint, validateContextMap } from './wayper-context-map.mjs';
import { buildContextPacket, validateContextPacket } from './wayper-context-packet.mjs';
import { validateRouterSelectionReceipt } from './wayper-agent-router.mjs';
import { digest } from './wayper-validation-policy.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const STRUCTURED_HANDOFF_SCHEMA_VERSION = 1;
export const STRUCTURED_HANDOFF_EVALS_PATH = 'docs/ai/structured-handoff-evals.json';
export const PACKETIZED_SPECIALIST_MODE = 'PACKETIZED_DEFAULT';
export const LEGACY_SPECIALIST_MODE = 'LEGACY_BOUNDED_BRIEF';
export const SPECIALIST_EXECUTION_POLICY = 'specialist-risk-capability-task-cost-v1';
export const HARNESS_SPECIALIST_DISPATCH_INVARIANT = 'HARNESS_SPECIALIST_DISPATCH_V1';

const STATUSES = new Set(['DONE', 'NO_FINDINGS', 'PARTIAL', 'BLOCKED', 'INVALID_INPUT']);
const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
const READ_CLASSES = new Set(['PACKET_SCOPED_READ', 'DEPENDENCY_CLOSURE_READ', 'OUT_OF_PACKET_READ']);
const TEST_STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'NOT_APPLICABLE']);
const PROVENANCE = new Set(['SOURCE', 'TEST', 'CONFIG', 'DOC', 'COMMAND', 'OBSERVATION']);
const REUSABLE_EVIDENCE = new Set(['PROVEN', 'HIGH_CONFIDENCE']);
const TASK_CEILINGS = Object.freeze({ TRIVIAL: 1_500, BOUNDED: 4_000, BUG: 8_000,
  INVESTIGATION: 10_000, ARCHITECTURAL: 16_000, CRITICAL_RUNTIME: 24_000 });
const PROFILE_CAPS = Object.freeze({ wayper_geospatial_reviewer: 2_400, wayper_concurrency_reviewer: 3_000,
  wayper_mobile_lifecycle_reviewer: 3_000, wayper_persistence_reviewer: 3_000,
  'independent-review': 3_200, 'followup-review': 3_200 });
const CRITICAL_SPECIALIST_RISKS = new Set(['RUN_DATA_LOSS', 'LIFECYCLE', 'CONCURRENCY', 'GPS_GEO',
  'TERRITORY_GEO', 'OFFLINE_STORAGE', 'SYNC', 'FIREBASE', 'AUTH_SECURITY', 'NATIVE_ANDROID', 'PERFORMANCE',
  'DATA_MIGRATION']);
const CRITICAL_SPECIALIST_CAPABILITIES = new Set(['active-run-lifecycle', 'active-run-recovery',
  'active-run-notification', 'live-gps-ingestion', 'durable-run-save', 'run-finalization', 'run-finish-handoff',
  'run-sync-replay', 'storage-migration', 'android-run-boundary']);
const DISPATCH_OWNER_FILES = ['AGENTS.md', '.agents/skills/wayper-context-efficiency/SKILL.md'];
const DIRECT_DISPATCH = /\b(?:spawn_agent|collaboration\.spawn_agent|tools\.spawn_agent)\b/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const NEW_EVIDENCE_ID = /^NE-[A-Za-z0-9._-]{1,80}$/;
const FORBIDDEN_KEY = /transcript|chain.?of.?thought|source.?blob|raw.?graph|raw.?diff|tool.?diar|stdout|stderr|test.?log|packet.?content/i;
const TOP_KEYS = new Set(['schemaVersion', 'goalId', 'taskId', 'agentId', 'packetId', 'status', 'confidence',
  'coverage', 'findings', 'evidenceRefs', 'newEvidence', 'risks', 'recommendations', 'filesRead', 'filesChanged',
  'tests', 'proofGaps', 'ambiguities', 'blockers', 'metrics', 'existingEvidenceReceiptIds', 'validationFindings', 'feedback']);
const FINDING_KEYS = new Set(['id', 'severity', 'category', 'claim', 'scenario', 'impact', 'safeguard',
  'confidence', 'evidenceRefs', 'proofGapRefs', 'affectedCapabilities', 'contextArtifactRefs']);
const NEW_EVIDENCE_KEYS = new Set(['id', 'repository', 'path', 'range', 'symbol', 'sourceHash', 'category',
  'claim', 'provenance', 'capabilityRefs']);
const FILE_READ_KEYS = new Set(['repository', 'path', 'range', 'symbol', 'classification', 'reason']);
const TEST_KEYS = new Set(['command', 'status', 'summary', 'evidenceRefs']);
const PROOF_GAP_KEYS = new Set(['id', 'claim', 'reason', 'requiredEvidence', 'evidenceRefs', 'capabilityRefs']);
const METRIC_KEYS = new Set(['handoffBytes', 'handoffTokenProxy', 'findingsReturned', 'evidenceRefsReturned',
  'newEvidenceReturned', 'filesReadByAgent', 'outOfPacketReads', 'inlineBytes', 'tokenProxyCeiling',
  'budgetStatus', 'budgetReason']);

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const unique = (value) => Array.isArray(value) && new Set(value).size === value.length;
const compact = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const normalized = (value) => compact(value).normalize('NFKC').toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const qualify = (repository, value) => `${repository}:${String(value).split('#', 1)[0]}`;
const rejectKeys = (value, allowed, label, errors) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return errors.push(`invalid ${label}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`unknown ${label} field: ${key}`);
};
const validText = (value, limit = 240) => typeof value === 'string' && Boolean(compact(value)) &&
  Buffer.byteLength(value) <= limit;
const validTexts = (value, limit = 240) => unique(value) && value.every((item) => validText(item, limit));
const filesUnder = (root, relativePath, accept) => {
  const start = path.join(root, relativePath);
  if (!fs.statSync(start, { throwIfNoEntry: false })?.isDirectory()) return [];
  const visit = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return visit(absolute);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    return entry.isFile() && accept(relative) ? [relative] : [];
  });
  return visit(start).sort();
};
const lineRange = (value) => {
  const match = /^L(\d+)(?:-L(\d+))?$/.exec(value ?? '');
  return match ? [Number(match[1]), Number(match[2] ?? match[1])] : null;
};
const coversRead = (locator, read) => {
  if (!locator.range) return true;
  const allowed = lineRange(locator.range); const actual = lineRange(read.range);
  return actual ? allowed[0] <= actual[0] && allowed[1] >= actual[1] :
    Boolean(locator.symbol && locator.symbol === read.symbol);
};
const dependencyLocator = (repository, ref) => {
  const [relativePath, range] = String(ref).split('#', 2);
  return { qualified: `${repository}:${relativePath}`, ...(/^L\d+(?:-L\d+)?$/.test(range ?? '') ? { range } : {}) };
};

export function selectSpecialistExecutionPolicy(packet) {
  const taskClass = packet?.contextBudget?.taskClass;
  if (!TASK_CEILINGS[taskClass] || !Array.isArray(packet?.riskFlags) ||
    !Array.isArray(packet?.capabilities?.required) || !Array.isArray(packet?.capabilities?.optional)) {
    throw new Error('Validated specialist policy input is required');
  }
  const risks = packet.riskFlags.filter((item) => CRITICAL_SPECIALIST_RISKS.has(item)).sort();
  const capabilities = [...packet.capabilities.required, ...packet.capabilities.optional]
    .filter((item) => CRITICAL_SPECIALIST_CAPABILITIES.has(item)).sort();
  const critical = risks.length > 0 || capabilities.length > 0 ||
    ['ARCHITECTURAL', 'CRITICAL_RUNTIME'].includes(taskClass);
  let model = 'gpt-5.6-terra'; let reasoningEffort = 'medium'; let costClass = 'BALANCED';
  if (critical) [model, reasoningEffort, costClass] = ['gpt-5.6-sol', 'high', 'QUALITY_FIRST'];
  else if (['BUG', 'INVESTIGATION'].includes(taskClass)) reasoningEffort = 'high';
  else if (taskClass === 'TRIVIAL') [model, costClass] = ['gpt-5.6-luna', 'COST_EFFICIENT'];
  return { id: SPECIALIST_EXECUTION_POLICY, model, reasoningEffort, costClass,
    reasons: [`TASK_CLASS:${taskClass}`, ...(risks.length ? risks.map((item) => `RISK:${item}`) : ['RISK:NONE']),
      ...(capabilities.length ? capabilities.map((item) => `CAPABILITY:${item}`) : ['CAPABILITY:NON_CRITICAL']),
      `COST_CLASS:${costClass}`] };
}

export function validateHarnessSpecialistDispatches({ root = ROOT, registry } = {}) {
  const errors = [];
  let profiles;
  try {
    profiles = [...validateRegistry(registry).agentProfiles.values()]
      .filter((profile) => profile.writePermission === 'none' && profile.sandbox === 'read-only');
  } catch (error) {
    return { status: 'BYPASS_DETECTED', errors: [`REGISTRY_INVALID:${error.message}`], coveredOperationalPaths: [] };
  }
  const ids = profiles.map((profile) => profile.id).sort();
  for (const profile of profiles) {
    if (profile.modelPolicy !== SPECIALIST_EXECUTION_POLICY ||
      profile.reasoningPolicy !== SPECIALIST_EXECUTION_POLICY ||
      profile.handoffSchema !== `structured-handoff-v${STRUCTURED_HANDOFF_SCHEMA_VERSION}`) {
      errors.push(`PROFILE_POLICY_BYPASS:${profile.id}`);
    }
  }
  for (const relativePath of DISPATCH_OWNER_FILES) {
    const ownerPath = path.join(root, relativePath);
    if (!fs.statSync(ownerPath, { throwIfNoEntry: false })?.isFile()) {
      errors.push(`DISPATCH_OWNER_MISSING:${relativePath}`);
      continue;
    }
    const source = fs.readFileSync(ownerPath, 'utf8');
    if (!source.includes(HARNESS_SPECIALIST_DISPATCH_INVARIANT)) errors.push(`DISPATCH_OWNER_MARKER_MISSING:${relativePath}`);
  }
  const operationalPaths = filesUnder(root, '.agents/skills', (item) => item.endsWith('/SKILL.md'));
  const coveredOperationalPaths = [];
  for (const relativePath of ['AGENTS.md', ...operationalPaths]) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    if (DIRECT_DISPATCH.test(source)) errors.push(`DIRECT_RUNTIME_DISPATCH:${relativePath}`);
    if (ids.some((id) => source.includes(id))) coveredOperationalPaths.push(relativePath);
  }
  const executablePaths = [...filesUnder(root, 'scripts', (item) => /\.(?:[cm]?js|ts|tsx|json)$/.test(item) &&
      !/\.test\.[cm]?js$/.test(item) && !item.startsWith('scripts/quality/')),
    ...filesUnder(root, '.codex', (item) => /\.(?:toml|json|[cm]?js)$/.test(item)),
    ...(fs.statSync(path.join(root, 'package.json'), { throwIfNoEntry: false })?.isFile() ? ['package.json'] : [])];
  for (const relativePath of executablePaths) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    if (relativePath !== 'scripts/wayper-structured-handoff.mjs' && DIRECT_DISPATCH.test(source)) {
      errors.push(`DIRECT_RUNTIME_DISPATCH:${relativePath}`);
    }
    if (relativePath.startsWith('.codex/agents/') && /^(?:model|model_reasoning_effort)\s*=/m.test(source)) {
      errors.push(`STATIC_SPECIALIST_POLICY_OVERRIDE:${relativePath}`);
    }
    const directProfiles = ids.filter((id) => source.includes(id));
    const allowed = relativePath === 'scripts/wayper-structured-handoff.mjs' ||
      directProfiles.every((id) => relativePath === `.codex/agents/${id}.toml`);
    if (directProfiles.length && !allowed) errors.push(`DIRECT_SPECIALIST_REFERENCE:${relativePath}:${directProfiles.join(',')}`);
  }
  return { status: errors.length ? 'BYPASS_DETECTED' : 'VALID', errors: [...new Set(errors)].sort(),
    coveredOperationalPaths: [...new Set(coveredOperationalPaths)].sort(), profiles: ids };
}

function handoffCeiling(packet) {
  const task = TASK_CEILINGS[packet?.contextBudget?.taskClass];
  if (!task) throw new Error('Unsupported handoff task class');
  return Math.max(512, Math.min(Math.ceil(task / 4), PROFILE_CAPS[packet.target.id] ?? 2_800));
}

function inlineBytes(handoff) {
  const fields = [handoff.findings, handoff.newEvidence, handoff.risks, handoff.recommendations,
    handoff.tests, handoff.proofGaps, handoff.ambiguities, handoff.blockers];
  return Buffer.byteLength(JSON.stringify(fields));
}

function finalizeMetrics(handoff, packet, budgetReason) {
  const next = structuredClone(handoff);
  const ceiling = handoffCeiling(packet);
  let metrics = { handoffBytes: 0, handoffTokenProxy: 0, findingsReturned: next.findings?.length ?? 0,
    evidenceRefsReturned: next.evidenceRefs?.length ?? 0, newEvidenceReturned: next.newEvidence?.length ?? 0,
    filesReadByAgent: next.filesRead?.length ?? 0,
    outOfPacketReads: next.filesRead?.filter((item) => item.classification === 'OUT_OF_PACKET_READ').length ?? 0,
    inlineBytes: inlineBytes(next), tokenProxyCeiling: ceiling, budgetStatus: 'WITHIN_BUDGET' };
  for (let index = 0; index < 8; index += 1) {
    next.metrics = metrics;
    const handoffBytes = Buffer.byteLength(JSON.stringify(next));
    const handoffTokenProxy = Math.ceil(handoffBytes / 4);
    const over = handoffTokenProxy > ceiling;
    metrics = { ...metrics, handoffBytes, handoffTokenProxy, budgetStatus: over ? 'OVER_BUDGET' : 'WITHIN_BUDGET',
      ...(over && budgetReason ? { budgetReason: compact(budgetReason) } : {}) };
  }
  next.metrics = metrics;
  return next;
}

export function buildStructuredHandoff(draft, { packet, budgetReason } = {}) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || !packet) throw new Error('Handoff draft and packet are required');
  if (draft.metrics && Object.keys(draft.metrics).some((key) => key !== 'budgetReason')) {
    throw new Error('Agent-supplied handoff metrics are not accepted');
  }
  const reason = budgetReason ?? draft.metrics?.budgetReason;
  const payload = structuredClone(draft);
  delete payload.metrics;
  return finalizeMetrics(payload, packet, reason);
}

function repositoryMap(definitions = []) {
  return new Map(definitions.map((item) => [item.id, item]));
}

function validateStructuredHandoffUnsafe(handoff, { packet, contextMap, registry, repositoryDefinitions: repos = [] } = {}) {
  const errors = [];
  const mapValidation = validateContextMap(contextMap, { repositoryDefinitions: repos, registry });
  if (mapValidation.status !== 'VALID') return { status: 'INVALID_HANDOFF',
    errors: mapValidation.errors.map((item) => `contextMap: ${item}`) };
  if (repos.some((item) => contextMap.repositoryState[item.id]?.logicalRoot !== item.logicalRoot)) {
    return { status: 'INVALID_HANDOFF', errors: ['contextMap: repository definition mismatch'] };
  }
  const packetValidation = validateContextPacket(packet, { contextMap, registry, repositoryDefinitions: repos });
  if (packetValidation.status !== 'VALID') return { status: 'INVALID_HANDOFF',
    errors: packetValidation.errors.map((item) => `packet: ${item}`) };
  rejectKeys(handoff, TOP_KEYS, 'handoff', errors);
  if (handoff.feedback !== undefined) {
    rejectKeys(handoff.feedback, new Set(['feedbackId', 'attemptId', 'failureId', 'diagnosisSummary']), 'feedback', errors);
    const f = handoff.feedback;
    if (!packet.feedback || f.feedbackId !== packet.feedback.feedbackId || !packet.feedback.attemptId ||
      f.attemptId !== packet.feedback.attemptId || !packet.feedback.failures.some((x) => x.failureId === f.failureId) ||
      !validText(f.diagnosisSummary, 240)) errors.push('invalid feedback proposal binding');
  }
  rejectKeys(handoff?.metrics, METRIC_KEYS, 'metrics', errors);
  const arrays = ['coverage', 'findings', 'evidenceRefs', 'newEvidence', 'risks', 'recommendations', 'filesRead',
    'filesChanged', 'tests', 'proofGaps', 'ambiguities', 'blockers'];
  if (arrays.some((field) => !Array.isArray(handoff?.[field]))) {
    errors.push('invalid handoff collections');
    return { status: 'INVALID_HANDOFF', errors: [...new Set(errors)].sort() };
  }
  if (handoff?.schemaVersion !== STRUCTURED_HANDOFF_SCHEMA_VERSION || handoff.goalId !== packet.goalId ||
    handoff.packetId !== packet.packetId || !validText(handoff.taskId, 120) || !validText(handoff.agentId, 120) ||
    !STATUSES.has(handoff.status) || !Number.isFinite(handoff.confidence) || handoff.confidence < 0 || handoff.confidence > 1) {
    errors.push('invalid handoff identity/status');
  }
  const state = validateRegistry(registry);
  const profile = state.agentProfiles.get(handoff?.agentId);
  if (packet.target.type === 'agentProfile' && (handoff.agentId !== packet.target.id || !profile) ||
    packet.target.type === 'validationRole' && handoff.agentId !== packet.target.id) errors.push('agent/profile identity mismatch');
  if (!unique(handoff.coverage) || !unique(handoff.evidenceRefs) ||
    !validTexts(handoff.risks) || !validTexts(handoff.recommendations) ||
    !validTexts(handoff.ambiguities) || !validTexts(handoff.blockers)) errors.push('invalid or duplicate compact arrays');
  const capabilities = new Set([...packet.capabilities.required, ...packet.capabilities.optional]);
  if (handoff.coverage.some((id) => !capabilities.has(id))) errors.push('coverage capability outside packet');
  if (packet.capabilities.required.some((id) => !handoff.coverage.includes(id))) errors.push('required capability coverage omitted');
  if (packet.riskFlags.some((id) => !handoff.risks.includes(id))) errors.push('packet risk omitted');
  const evidence = new Map(contextMap.evidence.map((item) => [item.id, item]));
  if (!Array.isArray(handoff.validationFindings ?? []) || (handoff.validationFindings ?? []).length > 24) {
    errors.push('invalid validation findings');
  } else for (const item of handoff.validationFindings ?? []) {
    rejectKeys(item, new Set(['validationRequirementId', 'summary', 'candidateChecks', 'existingEvidenceReceiptIds']), 'validation finding', errors);
    if (!packet.validationPlan?.requirements.some((r) => r.validationRequirementId === item.validationRequirementId) ||
      !validText(item.summary) || !validTexts(item.candidateChecks) || item.candidateChecks.length > 4 ||
      !unique(item.existingEvidenceReceiptIds) || item.existingEvidenceReceiptIds.length > 8 ||
      item.existingEvidenceReceiptIds.some((id) => !(packet.evidenceReceiptIds ?? []).includes(id))) errors.push('invalid validation finding refs');
  }
  if (!unique(handoff.existingEvidenceReceiptIds ?? []) || (handoff.existingEvidenceReceiptIds ?? []).length > 64 ||
    (handoff.existingEvidenceReceiptIds ?? []).some((id) => !(packet.evidenceReceiptIds ?? []).includes(id))) {
    errors.push('invalid handoff Evidence Receipt refs');
  }
  if (handoff.evidenceRefs.some((id) => !packet.evidenceRefs.includes(id) || !REUSABLE_EVIDENCE.has(evidence.get(id)?.status))) {
    errors.push('invalid or stale evidence ref');
  }
  const definitions = repositoryMap(repos);
  const readPaths = new Set();
  const packetPaths = new Set(packet.scope.paths);
  const dependencies = new Map(contextMap.dependencies.map((item) => [item.id, item]));
  const closureLocators = packet.dependencyRefs.flatMap(({ id }) => {
    const item = dependencies.get(id);
    return item ? [dependencyLocator(item.from.repository, item.from.ref),
      dependencyLocator(item.to.repository, item.to.ref)] : [];
  });
  const packetLocators = packet.evidenceRefs.map((id) => evidence.get(id)).filter(Boolean)
    .map((item) => ({ qualified: qualify(item.repository, item.path), range: item.range, symbol: item.symbol }));
  for (const item of handoff.filesRead) {
    rejectKeys(item, FILE_READ_KEYS, 'file read', errors);
    const qualified = qualify(item?.repository, item?.path);
    const scoped = packetLocators.filter((locator) => locator.qualified === qualified);
    const closure = closureLocators.filter((locator) => locator.qualified === qualified);
    const inPacket = packetPaths.has(qualified) && (!scoped.length || scoped.some((locator) => coversRead(locator, item)));
    const inClosure = closure.some((locator) => coversRead(locator, item));
    const validClassification = item?.classification === 'PACKET_SCOPED_READ' && inPacket ||
      item?.classification === 'DEPENDENCY_CLOSURE_READ' && inClosure ||
      item?.classification === 'OUT_OF_PACKET_READ' && !inPacket && !inClosure;
    if (!packet.repositories.includes(item?.repository) || !validText(item?.path, 240) ||
      !READ_CLASSES.has(item?.classification) || !validClassification ||
      (item.classification === 'OUT_OF_PACKET_READ' && !validText(item.reason, 240)) ||
      (item.range != null && !/^L\d+(?:-L\d+)?$/.test(item.range)) ||
      (item.symbol != null && !validText(item.symbol, 160))) errors.push(`invalid source expansion: ${qualified}`);
    try {
      if (!definitions.has(item?.repository) || !sourceFingerprint(definitions.get(item.repository).root, item.path, item.range)) {
        errors.push(`missing file read: ${qualified}`);
      }
    } catch (error) { errors.push(`invalid file read ${qualified}: ${error.message}`); }
    readPaths.add(qualified);
  }
  if (handoff.filesChanged.length) errors.push('read-only handoff changed files');
  const localEvidence = new Set();
  for (const item of handoff.newEvidence) {
    rejectKeys(item, NEW_EVIDENCE_KEYS, 'new evidence', errors);
    const qualified = qualify(item?.repository, item?.path);
    if (!NEW_EVIDENCE_ID.test(item?.id ?? '') || localEvidence.has(item.id) || !packet.repositories.includes(item?.repository) ||
      !validText(item?.path, 240) || !validText(item?.category) || !validText(item?.claim) || !PROVENANCE.has(item?.provenance) ||
      !HASH.test(item?.sourceHash ?? '') || !unique(item?.capabilityRefs) ||
      item.capabilityRefs.some((id) => !capabilities.has(id)) || !readPaths.has(qualified) ||
      (item.range != null && !/^L\d+(?:-L\d+)?$/.test(item.range)) ||
      (item.symbol != null && !validText(item.symbol, 160))) errors.push(`invalid proposed evidence: ${item?.id}`);
    try {
      const source = definitions.has(item?.repository)
        ? sourceFingerprint(definitions.get(item.repository).root, item.path, item.range) : null;
      if (!source || source.hash !== item.sourceHash) errors.push(`new evidence source mismatch: ${item?.id}`);
    } catch (error) { errors.push(`new evidence source invalid ${item?.id}: ${error.message}`); }
    localEvidence.add(item?.id);
  }
  const gapIds = new Set();
  for (const gap of handoff.proofGaps) {
    rejectKeys(gap, PROOF_GAP_KEYS, 'proof gap', errors);
    if (!validText(gap?.id, 100) || gapIds.has(gap.id)) errors.push('invalid or duplicate proof gap id');
    const existing = contextMap.proofGaps.find((item) => item.id === gap?.id);
    if (existing) {
      if (!packet.proofGapRefs.includes(gap.id) || Object.keys(gap).length !== 1) errors.push(`invalid existing proof gap ref: ${gap.id}`);
    } else if (!/^PGP-[A-Za-z0-9._-]{1,80}$/.test(gap?.id ?? '') || !validText(gap?.claim) ||
      !validText(gap?.reason) || !validText(gap?.requiredEvidence) || !unique(gap?.evidenceRefs) ||
      gap.evidenceRefs.some((id) => !handoff.evidenceRefs.includes(id) && !localEvidence.has(id)) ||
      !unique(gap?.capabilityRefs) || gap.capabilityRefs.some((id) => !capabilities.has(id))) {
      errors.push(`invalid proposed proof gap: ${gap?.id}`);
    }
    gapIds.add(gap?.id);
  }
  if (packet.proofGapRefs.some((id) => !gapIds.has(id))) errors.push('packet proof gap omitted');
  const findingIds = new Set(); const findingSubjects = new Set();
  for (const finding of handoff.findings) {
    rejectKeys(finding, FINDING_KEYS, 'finding', errors);
    if (finding.contextArtifactRefs !== undefined && (!unique(finding.contextArtifactRefs) || finding.contextArtifactRefs.length > 16 ||
      finding.contextArtifactRefs.some((id) => !(packet.contextArtifactRefs ?? []).includes(id)))) errors.push('invalid finding context artifacts');
    const subject = [finding?.category, finding?.claim, finding?.scenario].map(normalized).join('|');
    if (!/^F-[A-Za-z0-9._-]{1,80}$/.test(finding?.id ?? '') || findingIds.has(finding.id) || findingSubjects.has(subject) ||
      !SEVERITIES.has(finding?.severity) || !validText(finding?.category) || !validText(finding?.claim) ||
      !validText(finding?.scenario) || !validText(finding?.impact) || !validText(finding?.safeguard) ||
      !Number.isFinite(finding?.confidence) || finding.confidence < 0 || finding.confidence > 1 ||
      !unique(finding?.evidenceRefs) || finding.evidenceRefs.some((id) =>
        !handoff.evidenceRefs.includes(id) && !localEvidence.has(id)) || !unique(finding?.proofGapRefs) ||
      finding.proofGapRefs.some((id) => !gapIds.has(id)) ||
      !(finding.evidenceRefs.length || finding.proofGapRefs.length) || !unique(finding?.affectedCapabilities) ||
      finding.affectedCapabilities.some((id) => !capabilities.has(id))) errors.push(`invalid finding: ${finding?.id}`);
    findingIds.add(finding?.id); findingSubjects.add(subject);
  }
  for (const item of handoff.tests) {
    rejectKeys(item, TEST_KEYS, 'test', errors);
    if (!validText(item?.command, 240) || !TEST_STATUSES.has(item?.status) || !validText(item?.summary, 240) ||
      !unique(item?.evidenceRefs) || item.evidenceRefs.some((id) =>
        !handoff.evidenceRefs.includes(id) && !localEvidence.has(id))) errors.push('invalid compact test result');
  }
  if (handoff.status === 'NO_FINDINGS' && handoff.findings.length ||
    handoff.status === 'DONE' && handoff.blockers.length ||
    ['BLOCKED', 'INVALID_INPUT'].includes(handoff.status) && !handoff.blockers.length ||
    handoff.status === 'PARTIAL' && ![handoff.proofGaps, handoff.ambiguities, handoff.blockers].some((items) => items.length)) {
    errors.push('invalid status semantics');
  }
  const limits = { findings: 64, evidenceRefs: 256, newEvidence: 128, filesRead: 256, tests: 64,
    proofGaps: 128, risks: 128, recommendations: 128, ambiguities: 128, blockers: 64 };
  if (Object.entries(limits).some(([field, limit]) => handoff[field].length > limit)) errors.push('handoff collection limit exceeded');
  const expected = finalizeMetrics({ ...structuredClone(handoff), metrics: undefined }, packet, handoff.metrics?.budgetReason);
  if (stable(handoff.metrics) !== stable(expected.metrics)) errors.push('invalid handoff metrics');
  if (handoff.metrics?.budgetStatus === 'OVER_BUDGET' && !validText(handoff.metrics.budgetReason, 240)) {
    errors.push('over-budget handoff requires reason');
  }
  const walk = (value) => {
    if (typeof value === 'string' && Buffer.byteLength(value) > 512) errors.push('oversized handoff value');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) errors.push(`prohibited handoff field: ${key}`);
      walk(child);
    }
  };
  walk(handoff);
  return { status: errors.length ? 'INVALID_HANDOFF' : 'VALID', errors: [...new Set(errors)].sort() };
}

export function validateStructuredHandoff(handoff, options = {}) {
  try { return validateStructuredHandoffUnsafe(handoff, options); }
  catch (error) { return { status: 'INVALID_HANDOFF', errors: [`validator rejected malformed handoff: ${error.message}`] }; }
}

export function planContextMapMerge(handoff, options = {}) {
  const validation = validateStructuredHandoff(handoff, options);
  if (validation.status !== 'VALID') throw new Error(validation.errors.join('; '));
  return {
    completionAuthority: 'NONE',
    ...(handoff.feedback ? { feedbackProposal: { ...handoff.feedback, origin: 'HANDOFF_ASSERTED',
      ownerAction: 'FEEDBACK_OWNER_REVIEW_REQUIRED', attemptAuthority: 'NONE' } } : {}),
    findings: handoff.findings.flatMap((finding) => {
      const evidence = [...options.contextMap.evidence, ...handoff.newEvidence].filter((e) => finding.evidenceRefs.includes(e.id));
      const repositories = [...new Set(evidence.map((e) => e.repository))];
      if (!repositories.length && options.packet.repositories.length === 1) repositories.push(options.packet.repositories[0]);
      return repositories.map((repository) => ({ id: `F-${digest([handoff.taskId, finding.id, repository]).slice(7, 31)}`,
        repository, paths: [...new Set(evidence.filter((e) => e.repository === repository).map((e) => e.path))].sort(),
        severity: finding.severity, materiality: ['CRITICAL', 'HIGH'].includes(finding.severity) ? 'BLOCKING' :
          finding.severity === 'INFO' ? 'INFORMATIONAL' : 'NON_BLOCKING', status: 'OPEN', claim: finding.claim,
        scenario: finding.scenario, relatedRequirementIds: [], receiptIds: [], resolution: null }));
    }),
    existingEvidenceReceiptIds: [...(handoff.existingEvidenceReceiptIds ?? [])],
    validationFindings: (handoff.validationFindings ?? []).map((item) => ({ ...item, origin: 'HANDOFF_ASSERTED',
      verification: 'UNVERIFIED', ownerAction: 'PLANNER_REASSESSMENT_REQUIRED' })),
    candidateEvidence: [
      ...handoff.newEvidence.map((item) => ({ proposalId: item.id, kind: 'REVIEW', summary: item.claim,
        origin: 'HANDOFF_ASSERTED', verification: 'UNVERIFIED' })),
      ...handoff.tests.map((item) => ({ kind: 'TEST', summary: item.summary,
        origin: 'HANDOFF_ASSERTED', verification: 'UNVERIFIED' })),
    ],
    newEvidence: handoff.newEvidence.map(({ id, sourceHash, ...item }) => ({ proposalId: id, ...item, status: 'UNVALIDATED' })),
    proofGaps: handoff.proofGaps.filter((item) => item.id.startsWith('PGP-')),
    findingRefs: handoff.findings.map((item) => item.id), risks: [...handoff.risks],
    ownerAction: 'CONTEXT_MAP_OWNER_REVIEW_REQUIRED',
  };
}

function parseCompletion(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1_048_576) throw new Error('Invalid completion payload');
  return JSON.parse(value);
}

const fallback = (reason, extra = {}) => ({ status: 'FALLBACK', executionMode: LEGACY_SPECIALIST_MODE, reason, ...extra });

const routerSelectionVerified = (authority, contextMap, registry) =>
  authority?.source === 'ROUTER_SELECTED' && authority.routerReceipt?.decision === 'ROUTER_SELECTED' &&
  validateRouterSelectionReceipt(authority.routerReceipt, { registry, agentId: authority.agentId }).status === 'VALID' &&
  contextMap?.router?.mode === 'SELECTIVE' &&
  contextMap.router.selectionReceipt?.receiptId === authority.routerReceipt.receiptId &&
  contextMap.router.selectedProfiles?.includes(authority.agentId);

export function preparePacketizedSpecialist({ selection, contextMap, registry, repositoryDefinitions: repos = [] } = {}) {
  const sourceAccepted = selection?.source === 'DECISION_GATE' ||
    routerSelectionVerified(selection, contextMap, registry);
  if (!sourceAccepted || selection?.decided !== true || !validText(selection?.agentId, 120)) {
    return { status: 'NOT_SELECTED', executionMode: 'NONE', reason: 'DECISION_GATE_SELECTION_REQUIRED' };
  }
  try {
    const hardening = validateHarnessSpecialistDispatches({ registry });
    if (hardening.status !== 'VALID') return { status: 'BLOCKED', executionMode: 'NONE',
      reason: 'HARNESS_DISPATCH_BYPASS_DETECTED', agentId: selection.agentId, errors: hardening.errors };
    const profile = validateRegistry(registry).agentProfiles.get(selection.agentId);
    if (!profile || profile.writePermission !== 'none' || profile.sandbox !== 'read-only') {
      return fallback('READ_ONLY_SPECIALIST_PROFILE_REQUIRED', { agentId: selection.agentId });
    }
    if (!validText(selection.objective, 240)) return fallback('SPECIALIST_OBJECTIVE_REQUIRED', { agentId: selection.agentId });
    const mapValidation = validateContextMap(contextMap, { repositoryDefinitions: repos, registry });
    if (mapValidation.status !== 'VALID') {
      return fallback('CONTEXT_MAP_UNAVAILABLE', { agentId: selection.agentId, errors: mapValidation.errors });
    }
    const packet = buildContextPacket(contextMap, { type: 'agentProfile', id: selection.agentId,
      objective: selection.objective, repositories: selection.repositories }, { registry });
    const packetValidation = validateContextPacket(packet, { contextMap, registry, repositoryDefinitions: repos });
    if (packetValidation.status !== 'VALID') {
      return fallback('CONTEXT_PACKET_INVALID', { agentId: selection.agentId, errors: packetValidation.errors });
    }
    const policy = selectSpecialistExecutionPolicy(packet);
    return { status: 'READY', executionMode: PACKETIZED_SPECIALIST_MODE, agentId: selection.agentId, packet,
      runtime: { forkTurns: 'none', readOnly: true, descendants: 0,
        ...(profile.nativeRole ? { agentType: profile.nativeRole } : {}),
        model: policy.model, reasoningEffort: policy.reasoningEffort }, policy,
      selectionAuthority: { source: selection.source,
        ...(selection.routerReceipt ? { routerReceiptId: selection.routerReceipt.receiptId } : {}) },
      fallback: { executionMode: LEGACY_SPECIALIST_MODE, trigger: 'PACKET_OR_HANDOFF_INVALID_OR_UNAVAILABLE' } };
  } catch (error) {
    return fallback('CONTEXT_PACKET_UNAVAILABLE', { agentId: selection.agentId, errors: [error.message] });
  }
}

const baseDispatchVerified = (dispatch, options) => {
  let policy;
  try { policy = selectSpecialistExecutionPolicy(options.packet); } catch { return false; }
  return dispatch?.source === 'ORCHESTRATOR' && dispatch?.event === 'FINAL_RESULT' && dispatch?.readOnly === true &&
    dispatch?.forkTurns === 'none' && dispatch?.descendants === 0 && dispatch?.packetId === options.packet?.packetId &&
    dispatch?.agentId === options.packet?.target?.id && options.packet?.target?.type === 'agentProfile' &&
    dispatch?.policyId === policy.id && dispatch?.model === policy.model &&
    dispatch?.reasoningEffort === policy.reasoningEffort;
};

async function consumePacketizedCompletion({ dispatch, completion, correct, ...options }, verified, unverifiedStatus) {
  if (!verified) {
    return { status: unverifiedStatus, handoff: null, errors: ['Verified orchestrator dispatch receipt is required'],
      correctionAttempts: 0, invalidHandoffs: 0 };
  }
  const evaluate = (value) => {
    try {
      const handoff = buildStructuredHandoff(parseCompletion(value), options);
      return { handoff, validation: validateStructuredHandoff(handoff, options) };
    } catch (error) { return { handoff: null, validation: { status: 'INVALID_HANDOFF', errors: [error.message] } }; }
  };
  let result = evaluate(completion); let correctionAttempts = 0;
  let invalidHandoffs = result.validation.status === 'VALID' ? 0 : 1;
  if (result.validation.status !== 'VALID' && correct) {
    correctionAttempts = 1;
    try { result = evaluate(await correct(result.validation.errors)); }
    catch (error) {
      return { status: 'INVALID_HANDOFF', handoff: result.handoff,
        errors: [`correction failed: ${error.message}`], correctionAttempts, invalidHandoffs };
    }
    if (result.validation.status !== 'VALID') invalidHandoffs += 1;
  }
  return { status: result.validation.status, handoff: result.handoff, errors: result.validation.errors,
    correctionAttempts, invalidHandoffs };
}

export function consumePacketizedCanary(args) {
  const hardening = validateHarnessSpecialistDispatches({ registry: args.registry });
  if (hardening.status !== 'VALID') return { status: 'BLOCKED', executionMode: 'NONE',
    reason: 'HARNESS_DISPATCH_BYPASS_DETECTED', handoff: null, errors: hardening.errors,
    correctionAttempts: 0, invalidHandoffs: 0 };
  const verified = baseDispatchVerified(args.dispatch, args) && args.dispatch.mode === 'CANARY' &&
    args.dispatch.optIn === true && args.dispatch.selectionSource === 'DECISION_GATE';
  return consumePacketizedCompletion(args, verified, 'UNVERIFIED_CANARY');
}

export async function consumePacketizedSpecialist(args) {
  let policy;
  try { policy = selectSpecialistExecutionPolicy(args.packet); } catch { policy = null; }
  const hardening = validateHarnessSpecialistDispatches({ registry: args.registry });
  if (hardening.status !== 'VALID') return { status: 'BLOCKED', executionMode: 'NONE',
    reason: 'HARNESS_DISPATCH_BYPASS_DETECTED', agentId: args.packet?.target?.id, handoff: null,
    errors: hardening.errors, correctionAttempts: 0, invalidHandoffs: 0, policy };
  const selectionVerified = args.dispatch?.selectionSource === 'DECISION_GATE' ||
    routerSelectionVerified({ source: args.dispatch?.selectionSource, routerReceipt: args.dispatch?.routerReceipt,
      agentId: args.packet?.target?.id }, args.contextMap, args.registry);
  const verified = baseDispatchVerified(args.dispatch, args) && args.dispatch.mode === PACKETIZED_SPECIALIST_MODE &&
    selectionVerified;
  if (!verified) return { status: 'BLOCKED', executionMode: 'NONE', reason: 'UNVERIFIED_PACKETIZED_DISPATCH',
    agentId: args.packet?.target?.id, handoff: null, errors: ['Verified orchestrator dispatch receipt is required'],
    correctionAttempts: 0, invalidHandoffs: 0, policy };
  const result = await consumePacketizedCompletion(args, verified, 'UNVERIFIED_PACKETIZED_DISPATCH');
  if (result.status === 'VALID') return { ...result, executionMode: PACKETIZED_SPECIALIST_MODE, policy, fallback: null };
  return fallback(result.status, { agentId: args.packet?.target?.id, packetizedStatus: result.status,
    handoff: null, errors: result.errors, correctionAttempts: result.correctionAttempts,
    invalidHandoffs: result.invalidHandoffs, policy });
}

export function aggregateHandoffTelemetry(results, observations = {}) {
  const valid = results.filter((item) => item.status === 'VALID' && item.handoff);
  const value = (name) => Number.isInteger(observations[name]) && observations[name] >= 0 ? observations[name] : 'UNKNOWN';
  return { handoffsBuilt: valid.length,
    handoffBytes: valid.reduce((sum, item) => sum + item.handoff.metrics.handoffBytes, 0),
    handoffTokenProxy: valid.reduce((sum, item) => sum + item.handoff.metrics.handoffTokenProxy, 0),
    findingsReturned: valid.reduce((sum, item) => sum + item.handoff.metrics.findingsReturned, 0),
    evidenceRefsReturned: valid.reduce((sum, item) => sum + item.handoff.metrics.evidenceRefsReturned, 0),
    newEvidenceReturned: valid.reduce((sum, item) => sum + item.handoff.metrics.newEvidenceReturned, 0),
    filesReadByAgent: valid.reduce((sum, item) => sum + item.handoff.metrics.filesReadByAgent, 0),
    outOfPacketReads: valid.reduce((sum, item) => sum + item.handoff.metrics.outOfPacketReads, 0),
    correctionAttempts: results.reduce((sum, item) => sum + item.correctionAttempts, 0),
    invalidHandoffs: results.reduce((sum, item) => sum + item.invalidHandoffs, 0),
    controlPayloadProxy: value('controlPayloadProxy'), canaryPayloadProxy: value('canaryPayloadProxy'),
    controlResultProxy: value('controlResultProxy'), canaryHandoffProxy: value('canaryHandoffProxy'),
    providerUsage: observations.providerUsage ?? { status: 'UNAVAILABLE', reason: 'PROVIDER_ATTRIBUTION_UNAVAILABLE' } };
}

function args(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || values[index + 1] === undefined) throw new Error(`Invalid argument: ${values[index]}`);
    result[values[index].slice(2)] = values[index + 1];
  }
  return result;
}

async function readStdin() {
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

async function main() {
  if (process.argv.includes('--eval')) {
    const { evaluateStructuredHandoffCases, formatStructuredHandoffBenchmark } = await import('./quality/evaluate-structured-handoff-cases.mjs');
    const result = await evaluateStructuredHandoffCases();
    console.log(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : formatStructuredHandoffBenchmark(result));
    process.exitCode = result.status === 'PASS' ? 0 : 1;
    return;
  }
  const options = args(process.argv.slice(2));
  const state = readWorkingContext(ROOT, options);
  const repositories = repositoryDefinitions(options, state);
  const { registry } = loadCapabilityFiles();
  const target = JSON.parse(options.target);
  const mode = options.mode ?? PACKETIZED_SPECIALIST_MODE;
  if (!['CANARY', PACKETIZED_SPECIALIST_MODE].includes(mode)) throw new Error(`Unsupported packetized mode: ${mode}`);
  const prepared = preparePacketizedSpecialist({ selection: { source: options['selection-source'],
    decided: options.selected === 'true', agentId: target.id, objective: target.objective,
    repositories: target.repositories,
    ...(options['router-receipt'] ? { routerReceipt: JSON.parse(options['router-receipt']) } : {}) },
    contextMap: state.contextMap, registry, repositoryDefinitions: repositories });
  if (options.prepare === 'true' || prepared.status !== 'READY') {
    console.log(JSON.stringify(prepared, null, 2));
    process.exitCode = ['NOT_SELECTED', 'BLOCKED'].includes(prepared.status) ? 1 : 0;
    return;
  }
  const packet = prepared.packet;
  const completion = await readStdin();
  const dispatch = { source: 'ORCHESTRATOR', event: 'FINAL_RESULT', mode,
    optIn: options['opt-in'] === 'true', readOnly: options['read-only'] === 'true', forkTurns: options['fork-turns'],
    descendants: Number(options.descendants), packetId: packet.packetId, agentId: packet.target.id,
    selectionSource: options['selection-source'], policyId: options['policy-id'], model: options.model,
    reasoningEffort: options['reasoning-effort'],
    ...(options['router-receipt'] ? { routerReceipt: JSON.parse(options['router-receipt']) } : {}) };
  const input = { dispatch, completion, packet, contextMap: state.contextMap, registry,
    repositoryDefinitions: repositories, budgetReason: options['budget-reason'] };
  const result = mode === 'CANARY' ? await consumePacketizedCanary(input) : await consumePacketizedSpecialist(input);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = ['VALID', 'FALLBACK'].includes(result.status) ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  main().catch((error) => { console.error(`WAYPER STRUCTURED HANDOFF TOOLING_ERROR\n${error.message}`); process.exitCode = 2; });
}
