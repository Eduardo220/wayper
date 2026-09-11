import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  integrateRouterOutput,
  recordContextEntry,
  refreshContextMap,
  validateContextMap,
} from './wayper-context-map.mjs';
import { evaluateContextMapCases } from './quality/evaluate-context-map-cases.mjs';
import { loadCapabilityFiles } from './quality/check-capability-routing.mjs';
import {
  assertGoalExecution, assertSameExecution, assertSameIdentity, baselineFor, captureRepositories,
  contextStatePath, createGoalExecution, goalReference, invalidateMapProofs, invalidateWorkingProof,
  repositoryChanges, stable,
} from './wayper-context-identity.mjs';
import { RECEIPT_ID, requirementPolicy } from './wayper-evidence-receipts.mjs';
import { evaluateEvidenceRequirement } from './wayper-evidence-store.mjs';
import { refreshContextValidationPlan } from './wayper-validation-store.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
export const BENCHMARK_PATH = 'docs/ai/context-efficiency-evals.json';
export const TASK_BUDGETS = Object.freeze({
  TRIVIAL: { contextTokenCeiling: 1_500, subagentBriefTokenCeiling: 0 },
  BOUNDED: { contextTokenCeiling: 4_000, subagentBriefTokenCeiling: 0 },
  BUG: { contextTokenCeiling: 8_000, subagentBriefTokenCeiling: 800 },
  INVESTIGATION: { contextTokenCeiling: 10_000, subagentBriefTokenCeiling: 800 },
  ARCHITECTURAL: { contextTokenCeiling: 16_000, subagentBriefTokenCeiling: 1_200 },
  CRITICAL_RUNTIME: { contextTokenCeiling: 24_000, subagentBriefTokenCeiling: 1_600 },
});

const START = '<!-- wayper-context-json:start -->';
const END = '<!-- wayper-context-json:end -->';
const PROVEN = new Set(['PROVEN', 'KNOWN_GOOD_UNCHANGED']);

const unique = (items = []) => [...new Set(items)];
const tokenProxy = (bytes) => Math.ceil(bytes / 4);

function repoFile(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error(`Invalid path: ${relativePath}`);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes repository: ${relativePath}`);
  }
  const real = fs.realpathSync(resolved);
  const realRoot = fs.realpathSync(root);
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`Path escapes repository through symlink: ${relativePath}`);
  }
  if (!fs.statSync(real).isFile()) throw new Error(`Not a file: ${relativePath}`);
  return real;
}

export function parseArtifactSpec(spec) {
  const match = String(spec).match(/^(.*?)(?:#L(\d+)(?:-L(\d+))?)?$/);
  if (!match?.[1]) throw new Error(`Invalid artifact spec: ${spec}`);
  const start = match[2] ? Number(match[2]) : null;
  const end = match[3] ? Number(match[3]) : start;
  if (start !== null && (start < 1 || end < start)) throw new Error(`Invalid artifact range: ${spec}`);
  return { spec, path: match[1], start, end };
}

export function fingerprintArtifact(root, spec) {
  const artifact = parseArtifactSpec(spec);
  const source = fs.readFileSync(repoFile(root, artifact.path), 'utf8');
  const lines = source.split(/\r?\n/);
  if (artifact.end !== null && artifact.end > lines.length) {
    throw new Error(`Artifact range exceeds file: ${spec}`);
  }
  const content = artifact.start === null
    ? source
    : lines.slice(artifact.start - 1, artifact.end).join('\n');
  const bytes = Buffer.byteLength(content);
  return {
    ...artifact,
    fingerprint: `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`,
    bytes,
    tokenProxy: tokenProxy(bytes),
  };
}

function fingerprintWorkingArtifact(root, spec, repositories) {
  const definitions = new Map((repositories?.length ? repositories : [{ id: 'wayper', root }])
    .map((item) => [item.id, item]));
  const separator = String(spec).indexOf(':');
  const prefix = String(spec).slice(0, separator);
  const requestedRepository = separator > 0 && ['wayper', 'wayper-site'].includes(prefix) ? prefix : 'wayper';
  const repositorySpec = requestedRepository === 'wayper' && !String(spec).startsWith('wayper:')
    ? String(spec) : String(spec).slice(separator + 1);
  const repository = definitions.get(requestedRepository);
  if (!repository) throw new Error(`Unknown artifact repository: ${requestedRepository}`);
  const artifact = fingerprintArtifact(repository.root, repositorySpec);
  return { ...artifact, repository: requestedRepository,
    spec: requestedRepository === 'wayper' ? repositorySpec : `${requestedRepository}:${repositorySpec}` };
}

export function parseWorkingContext(markdown) {
  const prefix = `${START}\n\`\`\`json\n`;
  const suffix = `\n\`\`\`\n${END}`;
  const source = String(markdown);
  const start = source.indexOf(prefix);
  const end = source.indexOf(suffix, start + prefix.length);
  if (start < 0 || end < 0) throw new Error('Working Context JSON block missing');
  const state = JSON.parse(source.slice(start + prefix.length, end));
  if (![1, 2].includes(state.schemaVersion) || !state.goalId || !Array.isArray(state.artifacts)) {
    throw new Error('Unsupported Working Context schema');
  }
  if (state.schemaVersion === 2) assertWorkingContext(state);
  for (const item of [...(state.requirements ?? []), ...state.artifacts]) {
    if (item.evidence?.length && (!Array.isArray(item.evidence) || !item.evidence.every((id) => RECEIPT_ID.test(id)))) {
      item.verification = 'LEGACY_UNVERIFIED';
      item.status = item.spec ? 'REUSE_BEFORE_READ' : 'REVALIDATION_REQUIRED';
    }
  }
  return state;
}

export function renderWorkingContext(state) {
  return [
    '# Wayper Working Context',
    '',
    '> Estado operacional persistente deste Goal. O bloco JSON abaixo é canônico;',
    '> source, testes e documentação aprovada continuam sendo a verdade do produto.',
    '',
    START,
    '```json',
    JSON.stringify(state, null, 2),
    '```',
    END,
    '',
  ].join('\n');
}

const artifactPolicy = (item) => ({ kinds: ['SOURCE', 'DOCUMENT'], repository: item.repository ?? 'wayper',
  path: item.path, range: item.start === null ? null : `L${item.start}${item.end !== item.start ? `-L${item.end}` : ''}`,
  fingerprint: item.fingerprint, result: 'OBSERVED' });

function proofOptions(state, options = {}) {
  const root = options.root ?? ROOT;
  return { ...options, root, execution: state.execution, repositories: options.repositories ??
    (state.contextMap ? Object.values(state.contextMap.repositoryState).map((item) => ({ id: item.repository,
      root: path.resolve(root, item.logicalRoot) })) : [{ id: 'wayper', root }]) };
}

export function workingValidationStatus(state, options = {}) {
  if (!state.contextMap?.validationPlan) return { status: 'LEGACY_UNPLANNED', requirements: [] };
  return refreshContextValidationPlan(state.contextMap, proofOptions(state, options));
}

export function contextDecision(state, options = {}) {
  try { assertWorkingContext(state); } catch { return 'REVALIDATION_REQUIRED'; }
  const accepts = (policy, evidence) => evaluateEvidenceRequirement(policy, evidence, proofOptions(state, options)).status === 'SATISFIED';
  const requirements = state.requirements ?? [];
  const requirementsProven = requirements.length > 0 && requirements.every(
    (item) => item.status === 'SATISFIED' && accepts(requirementPolicy(item), item.evidence),
  );
  const artifactsProven = state.artifacts.length > 0
    && state.artifacts.every((item) => PROVEN.has(item.status) && accepts(artifactPolicy(item), item.evidence));
  if (!requirementsProven || !artifactsProven) return 'CONTINUE_CONTEXT';
  const map = state.contextMap;
  if (!map) return 'STOP_WHEN_PROVEN';
  if (map.validationPlan && workingValidationStatus(state, options).status !== 'COMPLETE') return 'CONTINUE_CONTEXT';
  if (validateContextMap(map, { repositoryDefinitions: proofOptions(state, options).repositories,
    registry: options.registry }).status !== 'VALID') return 'CONTINUE_CONTEXT';
  const checks = map.validation?.checks ?? [];
  const checksProven = checks.every(
    (item) => item.status === 'PASS' && accepts(requirementPolicy({ kind: 'QUALITY_GATE', id: item.id }), [item.evidence]),
  );
  const provenChecks = new Set(checks.filter((item) => item.status === 'PASS' &&
    accepts(requirementPolicy({ kind: 'QUALITY_GATE', id: item.id }), [item.evidence]))
    .map((item) => item.id));
  const declaredValidationsProven = (state.validations ?? []).every((id) => provenChecks.has(id));
  const assurancesProven = [
    ...(state.riskFlags ?? []).map((item) => `risk:${item}`),
    ...(state.invariants ?? []).map((item) => `invariant:${item}`),
  ].every((id) => provenChecks.has(id));
  const graphifyProven = Object.values(map.graphify).every((item) =>
    item.decision !== 'REQUIRED_BY_STRUCTURAL_UNCERTAINTY' || item.status === 'CURRENT');
  const unresolved = map.proofGaps.some((item) => item.status !== 'RESOLVED' || item.verification !== 'VERIFIED') ||
    map.knownGood.some((item) => item.status !== 'KNOWN_GOOD_UNCHANGED' || item.verification !== 'VERIFIED');
  const reusableSubjects = new Set(map.evidence.filter((item) => ['PROVEN', 'HIGH_CONFIDENCE'].includes(item.status))
    .map((item) => [item.repository, item.path, item.category,
      item.claim.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()].join('|')));
  const unresolvedStaleness = map.evidence.some((item) => item.status === 'STALE' && !reusableSubjects.has(
    [item.repository, item.path, item.category,
      item.claim.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()].join('|')));
  return checksProven && declaredValidationsProven && assurancesProven && graphifyProven &&
    !unresolved && !unresolvedStaleness
    ? 'STOP_WHEN_PROVEN' : 'CONTINUE_CONTEXT';
}

export function assertWorkingContext(state, identity) {
  if (state?.schemaVersion !== 2) throw new Error('LEGACY_UNVERIFIED: explicit new Goal required');
  assertGoalExecution(state.execution, state.goalId);
  assertGoalExecution({ identity: state.execution.identity, baseline: baselineFor(state.currentRepositories) });
  repositoryChanges(state.execution.baseline.repositories, state.currentRepositories);
  if (identity) assertSameIdentity(state.execution.identity, identity);
  if (!Array.isArray(state.revisionHistory) || state.revisionHistory.length !== state.execution.identity.revision - 1) {
    throw new Error('Invalid Goal revision history');
  }
  state.revisionHistory.forEach((execution, index) => {
    assertGoalExecution(execution);
    assertSameIdentity(execution.identity, { ...state.execution.identity, revision: index + 1 });
  });
  if (state.contextMap) {
    if (state.contextMap.schemaVersion !== 2 || state.contextMap.goalId !== state.goalId) throw new Error('Context Map Goal mismatch');
    assertSameExecution(state.execution, state.contextMap.execution);
  }
}

function newState(execution, objective, taskClass) {
  const budget = TASK_BUDGETS[taskClass];
  if (!budget) throw new Error(`Unknown task class: ${taskClass}`);
  return {
    schemaVersion: 2,
    goalId: goalReference(execution.identity),
    execution,
    objective,
    revisionHistory: [],
    currentRepositories: structuredClone(execution.baseline.repositories),
    taskClass,
    budget,
    riskFlags: [],
    invariants: [],
    validations: [],
    requirements: [],
    artifacts: [],
    learningDelta: [],
    contextDecision: 'CONTINUE_CONTEXT',
  };
}

export function startWorkingContext(options) {
  const repositories = options.repositories ?? [{ id: 'wayper', root: options.root ?? ROOT, logicalRoot: '.' }];
  const objective = String(options.objective ?? '').trim();
  if (!objective || Buffer.byteLength(objective) > 400) throw new Error('Compact Goal objective required');
  const execution = createGoalExecution({ threadId: options.threadId, repositories });
  const existing = newState(execution, objective, options.taskClass);
  existing.requirements = unique(options.requirements).map(requirementFromSpec);
  for (const field of ['riskFlags', 'invariants', 'validations']) existing[field] = unique(options[field]);
  return refreshWorkingContext({ ...options, repositories, existing, identity: execution.identity });
}

function requirementFromSpec(spec) {
  const separator = spec.indexOf(':');
  if (separator < 1 || separator === spec.length - 1) throw new Error(`Invalid requirement: ${spec}`);
  return { kind: spec.slice(0, separator), id: spec.slice(separator + 1), status: 'PENDING', evidence: [] };
}

export function refreshWorkingContext({
  root = ROOT,
  repositories,
  existing,
  identity,
  objective,
  taskClass = existing?.taskClass,
  specs = [],
  requirements = [],
  riskFlags = [],
  invariants = [],
  validations = [],
  registry,
}) {
  assertWorkingContext(existing);
  assertSameIdentity(existing.execution.identity, identity);
  if (objective !== undefined && String(objective).trim() !== existing.objective) {
    throw new Error('Definition change requires explicit amendment or new Goal start');
  }
  const state = structuredClone(existing);
  repositories ??= [{ id: 'wayper', root, logicalRoot: '.' }];
  const currentRepositories = captureRepositories(repositories);
  const { changed, incompatible } = repositoryChanges(state.currentRepositories, currentRepositories);
  state.currentRepositories = currentRepositories;
  if (changed.length) {
    for (const item of state.requirements) invalidateWorkingProof(item, 'PENDING');
    if (state.contextMap) invalidateMapProofs(state.contextMap, {
      evidence: state.contextMap.evidence.filter((item) => incompatible.includes(item.repository) ||
        changed.includes(item.repository) && ['COMMAND', 'TEST', 'OBSERVATION'].includes(item.provenance)).map((item) => item.id),
      validations: state.contextMap.validation.checks.map((item) => item.id),
      artifacts: state.contextMap.knownGood.filter((item) => incompatible.includes(item.repository))
        .map((item) => `${item.repository}:${item.artifact}`), graphify: changed,
    }, 'REPOSITORY_STATE_CHANGED');
  }
  for (const item of state.artifacts) if (incompatible.includes(item.repository ?? 'wayper')) {
    invalidateWorkingProof(item, 'DIFF_BEFORE_FILE');
  }
  if (!TASK_BUDGETS[taskClass]) throw new Error(`Unknown task class: ${taskClass}`);
  state.taskClass = taskClass;
  state.budget = TASK_BUDGETS[taskClass];
  const previous = new Map(state.artifacts.map((item) => [item.spec, item]));
  const targets = specs.length && !changed.length ? unique(specs) : unique([...previous.keys(), ...specs]);
  const refreshed = new Map(previous);

  for (const spec of targets) {
    const current = fingerprintWorkingArtifact(root, spec, repositories);
    const prior = previous.get(spec);
    let status = 'READ_REQUIRED';
    let evidence = [];
    let invalidatedEvidence = [];
    if (prior?.fingerprint === current.fingerprint) {
      evidence = prior.evidence ?? [];
      invalidatedEvidence = prior.invalidatedEvidence ?? [];
      if (evidence.length && PROVEN.has(prior.status)) status = 'KNOWN_GOOD_UNCHANGED';
      else if (prior.status === 'DIFF_BEFORE_FILE') status = prior.status;
      else status = 'REUSE_BEFORE_READ';
    } else if (prior) {
      status = 'DIFF_BEFORE_FILE';
      invalidatedEvidence = prior.evidence ?? [];
    }
    refreshed.set(spec, { ...current, status, evidence, invalidatedEvidence });
  }

  const knownRequirements = new Map((state.requirements ?? []).map((item) => [`${item.kind}:${item.id}`, item]));
  for (const spec of requirements) {
    if (!knownRequirements.has(spec)) throw new Error('Definition change requires explicit amendment');
  }
  for (const [field, values] of Object.entries({ riskFlags, invariants, validations })) {
    if (values.some((value) => !state[field].includes(value))) throw new Error('Definition change requires explicit amendment');
  }
  state.requirements = [...knownRequirements.values()];
  for (const item of state.requirements) if (item.status === 'SATISFIED' && evaluateEvidenceRequirement(
    requirementPolicy(item), item.evidence, proofOptions(state, { root, repositories })).status !== 'SATISFIED') {
    item.status = 'REVALIDATION_REQUIRED'; item.verification = 'REVALIDATION_REQUIRED';
  }
  state.riskFlags = unique([...(state.riskFlags ?? []), ...riskFlags]);
  state.invariants = unique([...(state.invariants ?? []), ...invariants]);
  state.validations = unique([...(state.validations ?? []), ...validations]);
  state.artifacts = [...refreshed.values()].sort((left, right) => left.spec.localeCompare(right.spec));
  for (const item of state.artifacts) if (PROVEN.has(item.status) && evaluateEvidenceRequirement(
    artifactPolicy(item), item.evidence, proofOptions(state, { root, repositories })).status !== 'SATISFIED') {
    item.status = 'REUSE_BEFORE_READ'; item.verification = 'REVALIDATION_REQUIRED';
  }
  if (state.contextMap) state.contextMap = refreshContextMap(state.contextMap, {
    goalId: state.goalId, execution: state.execution, repositories, taskClass,
    tokenCeiling: state.budget.contextTokenCeiling, workingArtifacts: state.artifacts,
    risks: state.riskFlags, invariants: state.invariants, validations: state.validations,
    registry: registry ?? loadCapabilityFiles().registry,
  });
  state.contextDecision = contextDecision(state, { root, repositories });
  return state;
}

export function proveWorkingContext(state, { artifact, requirement, evidence }, options = {}) {
  assertWorkingContext(state);
  if (Boolean(artifact) === Boolean(requirement)) {
    throw new Error('Choose exactly one of --artifact or --requirement');
  }
  if (!RECEIPT_ID.test(evidence ?? '')) throw new Error('Verified compatible Evidence Receipt reference required');
  const proof = evidence;
  const next = structuredClone(state);
  if (artifact) {
    const item = next.artifacts.find((candidate) => candidate.spec === artifact);
    if (!item) throw new Error(`Unknown artifact: ${artifact}`);
    const accepted = evaluateEvidenceRequirement(artifactPolicy(item), [proof], proofOptions(state, options));
    if (accepted.status !== 'SATISFIED') throw new Error(`Evidence receipt rejected: ${accepted.reasons.join(',')}`);
    item.status = 'PROVEN';
    item.verification = 'VERIFIED';
    item.evidence = unique([...(item.evidence ?? []), proof]);
    item.invalidatedEvidence = [];
  } else if (requirement) {
    const item = next.requirements.find((candidate) => `${candidate.kind}:${candidate.id}` === requirement);
    if (!item) throw new Error(`Unknown requirement: ${requirement}`);
    const accepted = evaluateEvidenceRequirement(requirementPolicy(item), [proof], proofOptions(state, options));
    if (accepted.status !== 'SATISFIED') throw new Error(`Evidence receipt rejected: ${accepted.reasons.join(',')}`);
    item.status = 'SATISFIED';
    item.verification = 'VERIFIED';
    item.evidence = unique([...(item.evidence ?? []), proof]);
  } else throw new Error('Choose --artifact or --requirement');
  if (next.contextMap) next.contextMap = recordContextEntry(next.contextMap, 'receipt', { receiptId: proof },
    proofOptions(state, options).repositories, proofOptions(state, options));
  next.contextDecision = contextDecision(next, options);
  return next;
}

export function amendWorkingContext(options) {
  const { existing, identity, changes, invalidate, reason } = options;
  assertWorkingContext(existing);
  assertSameIdentity(existing.execution.identity, identity);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) ||
    Object.keys(changes).some((key) => !['objective', 'requirements', 'riskFlags', 'invariants', 'validations'].includes(key))) {
    throw new Error('Invalid amendment changes');
  }
  const next = structuredClone(existing);
  if (changes.objective !== undefined) {
    if (typeof changes.objective !== 'string' || !changes.objective.trim() || Buffer.byteLength(changes.objective) > 400) {
      throw new Error('Invalid amendment objective');
    }
    next.objective = changes.objective.trim();
  }
  if (changes.requirements !== undefined) {
    const patch = changes.requirements;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some((key) => !['add', 'remove'].includes(key)) ||
      ['add', 'remove'].some((key) => patch[key] !== undefined && !Array.isArray(patch[key]))) throw new Error('Invalid requirements patch');
    for (const spec of patch.remove ?? []) if (!next.requirements.some((item) => `${item.kind}:${item.id}` === spec)) {
      throw new Error(`Unknown amendment requirement: ${spec}`);
    }
    next.requirements = next.requirements.filter((item) => !(patch.remove ?? []).includes(`${item.kind}:${item.id}`));
    for (const spec of unique(patch.add)) {
      if (next.requirements.some((item) => `${item.kind}:${item.id}` === spec)) throw new Error(`Duplicate amendment requirement: ${spec}`);
      next.requirements.push(requirementFromSpec(spec));
    }
  }
  for (const field of ['riskFlags', 'invariants', 'validations']) if (changes[field] !== undefined) {
    if (!Array.isArray(changes[field]) || changes[field].some((item) => typeof item !== 'string' || !item)) {
      throw new Error(`Invalid amendment ${field}`);
    }
    next[field] = unique(changes[field]);
  }
  const definition = (state) => [state.objective, state.requirements.map((item) => `${item.kind}:${item.id}`).sort(),
    ...['riskFlags', 'invariants', 'validations'].map((field) => [...state[field]].sort())];
  if (stable(definition(existing)) === stable(definition(next))) throw new Error('NO_MATERIAL_AMENDMENT');
  if (typeof reason !== 'string' || !reason.trim() || Buffer.byteLength(reason) > 240) throw new Error('Amendment reason required');
  const map = next.contextMap;
  const available = { artifacts: next.artifacts.map((item) => item.spec),
    requirements: existing.requirements.map((item) => `${item.kind}:${item.id}`),
    evidence: map?.evidence.map((item) => item.id) ?? [], validations: map?.validation.checks.map((item) => item.id) ?? [],
    capabilities: unique([...(map?.capabilities.required ?? []), ...(map?.capabilities.optional ?? []),
      ...(map?.knownGood.map((item) => item.capability).filter(Boolean) ?? [])]), graphify: map?.repositories ?? [] };
  const affected = invalidate ?? available;
  if (!affected || Object.keys(affected).sort().join() !== Object.keys(available).sort().join() ||
    Object.keys(available).some((key) => !Array.isArray(affected[key]) || affected[key].some((id) => !available[key].includes(id)))) {
    throw new Error('Amendment requires a complete, valid invalidation scope');
  }
  for (const item of next.artifacts) if (affected.artifacts.includes(item.spec)) invalidateWorkingProof(item, 'DIFF_BEFORE_FILE');
  for (const item of next.requirements) if (affected.requirements.includes(`${item.kind}:${item.id}`)) invalidateWorkingProof(item, 'PENDING');
  const repositories = options.repositories ?? [{ id: 'wayper', root: options.root ?? ROOT, logicalRoot: '.' }];
  const current = captureRepositories(repositories);
  // Repository membership changes would require ownership migration, outside this phase.
  repositoryChanges(next.currentRepositories, current);
  next.revisionHistory.push(structuredClone(next.execution));
  next.execution = { identity: { ...identity, revision: identity.revision + 1 }, baseline: baselineFor(current) };
  next.goalId = goalReference(next.execution.identity);
  next.learningDelta.push({ revision: next.execution.identity.revision, reason: reason.trim() });
  if (map) {
    invalidateMapProofs(map, { ...affected, artifacts: affected.artifacts.map((spec) => {
      const artifact = next.artifacts.find((item) => item.spec === spec);
      return `${artifact.repository}:${artifact.path}${artifact.start === null ? '' : `#L${artifact.start}-L${artifact.end}`}`;
    }) }, 'GOAL_AMENDED');
    map.execution = structuredClone(next.execution); map.goalId = next.goalId;
    map.router = null; map.taskFingerprint = null; map.routerFingerprint = null;
    map.capabilities.knownGood = map.capabilities.knownGood.filter((id) => !affected.capabilities.includes(id));
    for (const item of map.knownGood) item.validatedAtGoal = next.goalId;
  }
  const refreshed = refreshWorkingContext({ ...options, existing: next, identity: next.execution.identity,
    objective: next.objective, requirements: [], riskFlags: [], invariants: [], validations: [], specs: [] });
  refreshed.contextDecision = contextDecision(refreshed);
  return refreshed;
}

function countArtifacts(root, specs) {
  return specs.reduce((total, spec) => {
    const artifact = fingerprintArtifact(root, spec);
    return { bytes: total.bytes + artifact.bytes, tokenProxy: total.tokenProxy + artifact.tokenProxy };
  }, { bytes: 0, tokenProxy: 0 });
}

function containsAll(after = [], before = []) {
  const set = new Set(after);
  return before.every((item) => set.has(item));
}

export function evaluateBenchmarks(suite, root = ROOT) {
  if (suite.schemaVersion !== 1 || !Array.isArray(suite.cases)) throw new Error('Unsupported context eval schema');
  return suite.cases.map((item) => {
    const before = countArtifacts(root, item.before.artifacts);
    const after = countArtifacts(root, item.after.artifacts);
    const budget = TASK_BUDGETS[item.taskClass];
    const checks = {
      reduced: after.tokenProxy < before.tokenProxy,
      withinBudget: after.tokenProxy <= budget.contextTokenCeiling || Boolean(item.budgetEscalationReason),
      riskPreserved: containsAll(item.after.riskFlags, item.before.riskFlags),
      invariantsPreserved: containsAll(item.after.invariants, item.before.invariants),
      validationsPreserved: containsAll(item.after.validations, item.before.validations),
      testsPreserved: containsAll(item.after.tests, item.before.tests),
    };
    const reduction = before.tokenProxy
      ? (before.tokenProxy - after.tokenProxy) / before.tokenProxy
      : 0;
    return { id: item.id, pass: Object.values(checks).every(Boolean), before, after, reduction, checks };
  });
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--') || index + 1 >= args.length) throw new Error(`Invalid argument: ${key}`);
    const name = key.slice(2);
    const value = args[index += 1];
    values[name] = values[name] === undefined ? value : [].concat(values[name], value);
  }
  return values;
}

const list = (value) => value === undefined ? [] : [].concat(value);

function statePath(root, args) {
  if (args.state) throw new Error('--state is unsupported; Working Context is canonical per Goal');
  return contextStatePath(root, args['goal-run-id']);
}

function readState(file) {
  return fs.existsSync(file) ? parseWorkingContext(fs.readFileSync(file, 'utf8')) : null;
}

export function readWorkingContext(root, args) {
  const state = readState(statePath(root, args));
  if (!state) throw new Error('Working Context missing; use explicit start');
  assertWorkingContext(state);
  assertSameIdentity(state.execution.identity, { schemaVersion: 1, threadId: args['thread-id'],
    goalRunId: args['goal-run-id'], revision: Number(args.revision) });
  return state;
}

function writeState(file, state) {
  assertWorkingContext(state);
  const previous = readState(file);
  if (previous) {
    assertWorkingContext(previous);
    const currentRevision = previous.execution.identity.revision;
    const nextRevision = state.execution.identity.revision;
    if (nextRevision === currentRevision) {
      assertSameExecution(previous.execution, state.execution);
    } else if (nextRevision !== currentRevision + 1 ||
      stable(state.revisionHistory.at(-1)) !== stable(previous.execution)) throw new Error('Invalid persisted revision transition');
    if (stable(state.revisionHistory.slice(0, currentRevision - 1)) !== stable(previous.revisionHistory)) {
      throw new Error('Historical baseline is immutable');
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, renderWorkingContext(state));
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function repositoryDefinitions(args, state) {
  const requested = list(args.repository);
  const specs = requested.length ? requested : (state?.contextMap?.repositories ?? ['wayper']).map((id) =>
    `${id}=${state?.contextMap?.repositoryState?.[id]?.logicalRoot ?? (id === 'wayper' ? '.' : `../${id}`)}`);
  return specs.map((spec) => {
    const separator = spec.indexOf('=');
    if (separator < 1 || separator === spec.length - 1) throw new Error(`Invalid repository: ${spec}`);
    const id = spec.slice(0, separator);
    const logicalRoot = spec.slice(separator + 1).replaceAll('\\', '/');
    return { id, logicalRoot, root: path.resolve(ROOT, logicalRoot) };
  });
}

function mapOptions(state, args, repositories, registry) {
  return {
    goalId: state.goalId,
    execution: state.execution,
    taskClass: state.taskClass,
    tokenCeiling: state.budget.contextTokenCeiling,
    budgetReason: args['budget-reason'],
    repositories,
    risks: state.riskFlags,
    invariants: state.invariants,
    validations: state.validations,
    workingArtifacts: state.artifacts,
    questions: list(args.question),
    phase: args.phase,
    registry,
  };
}

function refreshMap(state, args, repositories = repositoryDefinitions(args, state)) {
  const { registry } = loadCapabilityFiles();
  state.contextMap = refreshContextMap(state.contextMap, mapOptions(state, args, repositories, registry));
  const result = validateContextMap(state.contextMap, { repositoryDefinitions: repositories, registry });
  if (result.status !== 'VALID') throw new Error(result.errors.join('; '));
  state.contextDecision = contextDecision(state);
  return state;
}

function formatRefresh(state) {
  const counts = state.artifacts.reduce((all, item) => ({ ...all, [item.status]: (all[item.status] ?? 0) + 1 }), {});
  const delta = state.artifacts.filter((item) => ['DIFF_BEFORE_FILE', 'READ_REQUIRED'].includes(item.status));
  return [
    `WAYPER CONTEXT ${state.goalId}`,
    `GOAL_RUN_ID ${state.execution.identity.goalRunId}`,
    `REVISION ${state.execution.identity.revision}`,
    `BASELINE ${state.execution.baseline.fingerprint}`,
    ...Object.entries(counts).map(([status, count]) => `${status} ${count}`),
    ...delta.map((item) => `${item.status} ${item.spec}`),
    `CONTEXT_MAP v${state.contextMap.schemaVersion} ${state.contextMap.metrics.bytes} B / ${state.contextMap.metrics.tokenProxy} token proxy`,
    `DECISION ${state.contextDecision}`,
  ].join('\n');
}

function benchmark(root) {
  const suite = JSON.parse(fs.readFileSync(repoFile(root, BENCHMARK_PATH), 'utf8'));
  const results = evaluateBenchmarks(suite, root);
  const mapResults = evaluateContextMapCases(suite, root);
  const beforeBytes = results.reduce((sum, item) => sum + item.before.bytes, 0);
  const afterBytes = results.reduce((sum, item) => sum + item.after.bytes, 0);
  const before = results.reduce((sum, item) => sum + item.before.tokenProxy, 0);
  const after = results.reduce((sum, item) => sum + item.after.tokenProxy, 0);
  const status = [...results, ...mapResults].every((item) => item.pass) ? 'PASS' : 'FAIL';
  return {
    status,
    beforeBytes,
    afterBytes,
    beforeTokenProxy: before,
    afterTokenProxy: after,
    reduction: before ? (before - after) / before : 0,
    results,
    mapResults,
  };
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  if (command === 'benchmark') {
    const result = benchmark(ROOT);
    const mapBefore = result.mapResults.reduce((sum, item) => sum + item.withoutMapBytes, 0);
    const mapAfter = result.mapResults.reduce((sum, item) => sum + item.withMapBytes, 0);
    console.log(`CONTEXT EFFICIENCY ${result.status}\nbytes ${result.beforeBytes} -> ${result.afterBytes}\ntoken proxy ${result.beforeTokenProxy} -> ${result.afterTokenProxy} (-${(result.reduction * 100).toFixed(1)}%)\ncontext map ${mapBefore} -> ${mapAfter} B / ${result.mapResults.length} evals\n${result.results.map((item) => `${item.id} ${(item.reduction * 100).toFixed(1)}%`).join('\n')}`);
    process.exitCode = result.status === 'PASS' ? 0 : 1;
    return;
  }
  const args = parseArgs(rawArgs);
  if (args.state) throw new Error('--state is unsupported; Working Context is canonical per Goal');
  if (args['goal-id']) {
    if (!['inspect', 'validate'].includes(command) || !/^[A-Za-z0-9._-]+$/.test(args['goal-id'])) {
      throw new Error('LEGACY_UNVERIFIED: --goal-id is inspection-only; use explicit start or --goal-run-id');
    }
    const legacy = readState(path.join(ROOT, '.wayper-context', `${args['goal-id']}.md`));
    if (!legacy || legacy.schemaVersion !== 1) throw new Error('Legacy Working Context missing');
    console.log(JSON.stringify({ status: 'LEGACY_UNVERIFIED', decision: 'REVALIDATION_REQUIRED',
      ...(command === 'inspect' ? { state: legacy } : {}) }, null, 2));
    if (command === 'validate') process.exitCode = 1;
    return;
  }
  if (command === 'start') {
    if (args['goal-run-id'] || args.revision) throw new Error('Start always creates a new goalRunId at revision 1');
    const repositories = repositoryDefinitions(args);
    const state = refreshMap(startWorkingContext({ root: ROOT, repositories, threadId: args['thread-id'],
      objective: args.objective, taskClass: args.class, specs: list(args.track), requirements: list(args.requirement),
      riskFlags: list(args.risk), invariants: list(args.invariant), validations: list(args.validation) }), args, repositories);
    const file = contextStatePath(ROOT, state.execution.identity.goalRunId);
    if (fs.existsSync(file)) throw new Error('Goal run already exists');
    writeState(file, state);
    console.log(formatRefresh(state));
    return;
  }
  const file = statePath(ROOT, args);
  const current = readWorkingContext(ROOT, args);
  if (command === 'amend') {
    const repositories = repositoryDefinitions(args, current);
    const { registry } = loadCapabilityFiles();
    const state = refreshMap(amendWorkingContext({ root: ROOT, repositories, registry, existing: current,
      identity: current.execution.identity, taskClass: current.taskClass,
      changes: JSON.parse(args.changes), invalidate: args.invalidate ? JSON.parse(args.invalidate) : undefined,
      reason: args.reason }), args, repositories);
    writeState(file, state);
    console.log(formatRefresh(state));
    return;
  }
  if (command === 'refresh') {
    const repositories = repositoryDefinitions(args, current);
    let state = refreshWorkingContext({
      root: ROOT,
      repositories,
      existing: current,
      identity: current.execution.identity,
      objective: args.objective,
      taskClass: args.class ?? current?.taskClass,
      specs: list(args.track),
      requirements: list(args.requirement),
      riskFlags: list(args.risk),
      invariants: list(args.invariant),
      validations: list(args.validation),
    });
    state = refreshMap(state, args, repositories);
    writeState(file, state);
    console.log(formatRefresh(state));
    return;
  }
  if (command === 'prove') {
    if (!current) throw new Error(`Working Context missing: ${file}`);
    const repositories = repositoryDefinitions(args, current);
    const refreshed = refreshWorkingContext({ root: ROOT, repositories, existing: current,
      identity: current.execution.identity, taskClass: current.taskClass });
    let state = proveWorkingContext(refreshMap(refreshed, args, repositories), {
      artifact: args.artifact,
      requirement: args.requirement,
      evidence: args.evidence,
    }, { root: ROOT, repositories });
    state = refreshMap(state, args);
    writeState(file, state);
    console.log(`CONTEXT PROVEN ${args.artifact ?? args.requirement}\nDECISION ${state.contextDecision}`);
    return;
  }
  if (!current?.contextMap) throw new Error(`Context Map missing: ${file}`);
  const repositories = repositoryDefinitions(args, current);
  if (command === 'record') {
    let state = refreshMap(refreshWorkingContext({ root: ROOT, repositories, existing: current,
      identity: current.execution.identity, taskClass: current.taskClass }), args, repositories);
    const data = JSON.parse(args.data);
    let registry;
    if ((args.kind === 'known-good' && data.capability) || data.capabilityRefs?.length) {
      ({ registry } = loadCapabilityFiles());
    }
    state.contextMap = recordContextEntry(state.contextMap, args.kind, data, repositories, {
      tokenCeiling: state.budget.contextTokenCeiling,
      budgetReason: args['budget-reason'],
      phase: args.phase,
      registry,
    });
    state = refreshMap(state, args, repositories);
    writeState(file, state);
    console.log(`CONTEXT_MAP RECORDED ${args.kind}\n${state.contextMap.metrics.bytes} B / ${state.contextMap.metrics.tokenProxy} token proxy`);
    return;
  }
  if (command === 'router') {
    const { routeTask } = await import('./wayper-agent-router.mjs');
    let state = refreshMap(refreshWorkingContext({ root: ROOT, repositories, existing: current,
      identity: current.execution.identity, taskClass: current.taskClass }), args, repositories);
    const { registry } = loadCapabilityFiles();
    state.contextMap = integrateRouterOutput(state.contextMap, routeTask(JSON.parse(args.data), registry), {
      tokenCeiling: state.budget.contextTokenCeiling,
      phase: args.phase,
      registry,
    });
    state = refreshMap(state, args, repositories);
    writeState(file, state);
    console.log(`CONTEXT_MAP ROUTER ${state.contextMap.router.mode} ${state.contextMap.routerFingerprint}`);
    return;
  }
  if (command === 'inspect') {
    const map = current.contextMap;
    console.log(JSON.stringify({ schemaVersion: map.schemaVersion, goalId: map.goalId,
      execution: current.execution, revisionHistory: current.revisionHistory,
      repositories: map.repositories, taskFingerprint: map.taskFingerprint,
      routerFingerprint: map.routerFingerprint, capabilities: map.capabilities,
      router: map.router, risks: map.risks, validation: map.validation, validationPlan: workingValidationStatus(current), metrics: map.metrics }, null, 2));
    return;
  }
  if (command === 'stats') {
    console.log(JSON.stringify(current.contextMap.metrics, null, 2));
    return;
  }
  if (command === 'evidence') {
    console.log(JSON.stringify(current.contextMap.evidence, null, 2));
    return;
  }
  if (command === 'gaps') {
    console.log(JSON.stringify(current.contextMap.proofGaps, null, 2));
    return;
  }
  if (command === 'validate') {
    const { registry } = loadCapabilityFiles();
    const result = validateContextMap(current.contextMap, { repositoryDefinitions: repositories, registry });
    console.log(`CONTEXT_MAP ${result.status}${result.errors.length ? `\n${result.errors.join('\n')}` : ''}`);
    process.exitCode = result.status === 'VALID' ? 0 : 1;
    return;
  }
  throw new Error('Usage: wayper-context.mjs start|amend|refresh|prove|record|router|inspect|stats|evidence|gaps|validate|benchmark');
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    await main();
  } catch (error) {
    console.error(`WAYPER CONTEXT TOOLING_ERROR\n${error.message}`);
    process.exitCode = 2;
  }
}
