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
  if (state.schemaVersion !== 1 || !state.goalId || !Array.isArray(state.artifacts)) {
    throw new Error('Unsupported Working Context schema');
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

export function contextDecision(state) {
  const requirements = state.requirements ?? [];
  const requirementsProven = requirements.length > 0 && requirements.every(
    (item) => ['SATISFIED', 'NOT_APPLICABLE'].includes(item.status) && item.evidence?.length,
  );
  const artifactsProven = state.artifacts.length > 0
    && state.artifacts.every((item) => PROVEN.has(item.status));
  if (!requirementsProven || !artifactsProven) return 'CONTINUE_CONTEXT';
  const map = state.contextMap;
  if (!map) return 'STOP_WHEN_PROVEN';
  const checks = map.validation?.checks ?? [];
  const checksProven = checks.every(
    (item) => ['PASS', 'NOT_APPLICABLE'].includes(item.status) && item.evidence,
  );
  const provenChecks = new Set(checks.filter((item) => ['PASS', 'NOT_APPLICABLE'].includes(item.status) && item.evidence)
    .map((item) => item.id));
  const declaredValidationsProven = (state.validations ?? []).every((id) => provenChecks.has(id));
  const assurancesProven = [
    ...(state.riskFlags ?? []).map((item) => `risk:${item}`),
    ...(state.invariants ?? []).map((item) => `invariant:${item}`),
  ].every((id) => provenChecks.has(id));
  const graphifyProven = Object.values(map.graphify).every((item) =>
    item.decision !== 'REQUIRED_BY_STRUCTURAL_UNCERTAINTY' || item.status === 'CURRENT');
  const unresolved = map.proofGaps.some((item) => item.status !== 'RESOLVED') ||
    map.knownGood.some((item) => item.status !== 'KNOWN_GOOD_UNCHANGED');
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

function newState(goalId, taskClass) {
  const budget = TASK_BUDGETS[taskClass];
  if (!budget) throw new Error(`Unknown task class: ${taskClass}`);
  return {
    schemaVersion: 1,
    goalId,
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

function requirementFromSpec(spec) {
  const separator = spec.indexOf(':');
  if (separator < 1 || separator === spec.length - 1) throw new Error(`Invalid requirement: ${spec}`);
  return { kind: spec.slice(0, separator), id: spec.slice(separator + 1), status: 'PENDING', evidence: [] };
}

export function refreshWorkingContext({
  root = ROOT,
  repositories,
  existing,
  goalId,
  taskClass,
  specs = [],
  requirements = [],
  riskFlags = [],
  invariants = [],
  validations = [],
}) {
  const state = existing && existing.goalId === goalId ? structuredClone(existing) : newState(goalId, taskClass);
  if (!TASK_BUDGETS[taskClass]) throw new Error(`Unknown task class: ${taskClass}`);
  state.taskClass = taskClass;
  state.budget = TASK_BUDGETS[taskClass];
  const previous = new Map(state.artifacts.map((item) => [item.spec, item]));
  const targets = specs.length ? unique(specs) : [...previous.keys()];
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
    if (!knownRequirements.has(spec)) knownRequirements.set(spec, requirementFromSpec(spec));
  }
  state.requirements = [...knownRequirements.values()];
  state.riskFlags = unique([...(state.riskFlags ?? []), ...riskFlags]);
  state.invariants = unique([...(state.invariants ?? []), ...invariants]);
  state.validations = unique([...(state.validations ?? []), ...validations]);
  state.artifacts = [...refreshed.values()].sort((left, right) => left.spec.localeCompare(right.spec));
  state.contextDecision = contextDecision(state);
  return state;
}

export function proveWorkingContext(state, { artifact, requirement, evidence }) {
  if (Boolean(artifact) === Boolean(requirement)) {
    throw new Error('Choose exactly one of --artifact or --requirement');
  }
  const proof = String(evidence ?? '').trim();
  if (!proof || Buffer.byteLength(proof) > 400 ||
    !(/(?:^|\s)[\w./-]+(?:#L\d+(?:-L\d+)?|:\d+)(?:\s|$)/.test(proof) ||
      /\b(?:PASS|FAIL|BLOCKED|NOT_APPLICABLE)\b/.test(proof))) {
    throw new Error('Evidence must reference a source range or an observed validation result');
  }
  const next = structuredClone(state);
  if (artifact) {
    const item = next.artifacts.find((candidate) => candidate.spec === artifact);
    if (!item) throw new Error(`Unknown artifact: ${artifact}`);
    item.status = 'PROVEN';
    item.evidence = unique([...(item.evidence ?? []), proof]);
    item.invalidatedEvidence = [];
  } else if (requirement) {
    const item = next.requirements.find((candidate) => `${candidate.kind}:${candidate.id}` === requirement);
    if (!item) throw new Error(`Unknown requirement: ${requirement}`);
    item.status = 'SATISFIED';
    item.evidence = unique([...(item.evidence ?? []), proof]);
  } else throw new Error('Choose --artifact or --requirement');
  next.contextDecision = contextDecision(next);
  return next;
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
  if (!/^[A-Za-z0-9._-]+$/.test(args['goal-id'] ?? '')) throw new Error('Safe --goal-id is required');
  return path.join(root, '.wayper-context', `${args['goal-id']}.md`);
}

function readState(file) {
  return fs.existsSync(file) ? parseWorkingContext(fs.readFileSync(file, 'utf8')) : null;
}

function writeState(file, state) {
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
  const file = statePath(ROOT, args);
  const current = readState(file);
  if (command === 'refresh') {
    const repositories = repositoryDefinitions(args, current);
    let state = refreshWorkingContext({
      root: ROOT,
      repositories,
      existing: current,
      goalId: args['goal-id'],
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
    let state = proveWorkingContext(current, {
      artifact: args.artifact,
      requirement: args.requirement,
      evidence: args.evidence,
    });
    state = refreshMap(state, args);
    writeState(file, state);
    console.log(`CONTEXT PROVEN ${args.artifact ?? args.requirement}\nDECISION ${state.contextDecision}`);
    return;
  }
  if (!current?.contextMap) throw new Error(`Context Map missing: ${file}`);
  const repositories = repositoryDefinitions(args, current);
  if (command === 'record') {
    let state = structuredClone(current);
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
    let state = structuredClone(current);
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
      repositories: map.repositories, taskFingerprint: map.taskFingerprint,
      routerFingerprint: map.routerFingerprint, capabilities: map.capabilities,
      router: map.router, risks: map.risks, validation: map.validation, metrics: map.metrics }, null, 2));
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
  throw new Error('Usage: wayper-context.mjs refresh|prove|record|router|inspect|stats|evidence|gaps|validate|benchmark');
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    await main();
  } catch (error) {
    console.error(`WAYPER CONTEXT TOOLING_ERROR\n${error.message}`);
    process.exitCode = 2;
  }
}
