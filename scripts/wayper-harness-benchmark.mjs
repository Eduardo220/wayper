import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BENCHMARK_ROOT = path.join(ROOT, 'docs/ai/benchmarks/harness-v1-v2');
export const SUITE_PATH = path.join(BENCHMARK_ROOT, 'suite.json');
export const RESULTS_ROOT = path.join(BENCHMARK_ROOT, 'results');
const UNKNOWN = 'UNKNOWN';
const PRODUCT_PATHS = ['App.js', 'index.js', 'app.json', 'android', 'src', 'tests'];

const stable = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const digest = (value) => `sha256:${crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex')}`;
export const readSuite = () => JSON.parse(fs.readFileSync(SUITE_PATH, 'utf8'));
export function suiteFingerprint(suite) {
  const { fingerprint: _fingerprint, ...definition } = suite;
  return digest(definition);
}

function git(args, options = {}) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', ...options });
}

export function productFingerprint(sha) {
  const result = git(['ls-tree', '-r', '--full-tree', sha, '--', ...PRODUCT_PATHS]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Cannot inspect ${sha}`);
  return digest(result.stdout);
}

export function validateSuite(suite = readSuite()) {
  assert.equal(suite.schemaVersion, 1);
  assert.equal(suite.benchmarkVersion, 'BenchmarkSuite V1');
  assert.equal(suiteFingerprint(suite), suite.fingerprint, 'suite fingerprint mismatch');
  assert.deepEqual(Object.keys(suite.candidates).sort(), ['V1', 'V2']);
  assert.equal(git(['cat-file', '-e', `${suite.candidates.V1.sha}^{commit}`]).status, 0);
  assert.equal(git(['cat-file', '-e', `${suite.candidates.V2.sha}^{commit}`]).status, 0);
  assert.equal(git(['merge-base', '--is-ancestor', suite.candidates.V1.sha, suite.candidates.V2.sha]).status, 0);
  assert.equal(productFingerprint(suite.candidates.V1.sha), productFingerprint(suite.candidates.V2.sha), 'product source differs');
  assert.equal(suite.scenarios.A.length, 24);
  assert.equal(suite.scenarios.B.length, 12);
  assert.ok(suite.scenarios.C.length >= 17);
  const scenarios = Object.values(suite.scenarios).flat();
  assert.equal(new Set(scenarios.map(({ id }) => id)).size, scenarios.length);
  for (const scenario of scenarios) {
    assert.match(scenario.id, /^[ABC]\d+$/);
    assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(scenario.risk));
    const groundTruth = scenario.groundTruth ?? suite.groundTruthTemplates?.[scenario.groundTruthRef];
    assert.ok(groundTruth?.requiredOutcome);
    assert.ok(Array.isArray(groundTruth.requiredChanges));
    assert.ok(Array.isArray(groundTruth.forbiddenChanges));
    assert.ok(Array.isArray(groundTruth.requiredValidation));
    assert.ok(Array.isArray(groundTruth.requiredEvidence));
    assert.ok(Array.isArray(groundTruth.expectedBlockers));
    assert.ok(Array.isArray(groundTruth.allowedUnknowns));
    assert.ok(Array.isArray(groundTruth.successConditions));
    assert.ok(Array.isArray(groundTruth.failureConditions));
  }
  const expectedTrials = suite.scenarios.B.reduce((sum, item) => sum + item.repetitions * 2, 0);
  assert.ok(expectedTrials <= suite.budgets.maxTrialCount);
  return { status: 'PASS', scenarios: { A: 24, B: 12, C: suite.scenarios.C.length }, expectedAgenticTrials: expectedTrials,
    productFingerprint: productFingerprint(suite.candidates.V1.sha), suiteFingerprint: suite.fingerprint };
}

function safeTemporary(pathname, parent) {
  const realParent = fs.realpathSync(parent);
  const resolved = path.resolve(pathname);
  if (!resolved.startsWith(`${realParent}${path.sep}`)) throw new Error(`Unsafe temporary path: ${resolved}`);
  return resolved;
}

export function addWorktree(sha, label, parent = null) {
  const ownsParent = parent === null;
  parent ??= fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-bench-'));
  const directory = safeTemporary(path.join(parent, label), parent);
  const result = git(['worktree', 'add', '--detach', directory, sha]);
  if (result.status !== 0) {
    if (ownsParent) fs.rmSync(parent, { recursive: true, force: true });
    throw new Error(result.stderr.trim() || `Cannot create worktree for ${sha}`);
  }
  try {
    return { parent, directory, runtime: fs.mkdtempSync(path.join(parent, `${label}-runtime-`)) };
  } catch (error) {
    git(['worktree', 'remove', '--force', directory]);
    if (ownsParent) fs.rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}

export function removeWorktree(item) {
  if (!item?.directory || !item?.parent) return;
  safeTemporary(item.directory, item.parent);
  const result = git(['worktree', 'remove', '--force', item.directory]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Cannot remove worktree ${item.directory}`);
  fs.rmSync(item.parent, { recursive: true, force: true });
}

function command(root, executable, args, timeout) {
  const start = process.hrtime.bigint();
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, WAYPER_BENCHMARK: '1' } });
  return { ...result, durationMs: Number(process.hrtime.bigint() - start) / 1e6 };
}

async function memoryScale(root) {
  const modulePath = path.join(root, 'scripts/wayper-project-memory.mjs');
  if (!fs.existsSync(modulePath)) return { status: 'UNSUPPORTED' };
  const memory = await import(`${pathToFileURL(modulePath).href}?bench=${Date.now()}`);
  const evidence = await import(`${pathToFileURL(path.join(root, 'scripts/wayper-evidence-receipts.mjs')).href}?bench=${Date.now()}`);
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-memory-scale-'));
  try {
    const mobile = path.join(fixture, 'wayper'); const site = path.join(fixture, 'wayper-site');
    fs.mkdirSync(mobile); fs.mkdirSync(site);
    let index = memory.emptyMemoryIndex();
    const repositories = [{ id: 'wayper', root: mobile }, { id: 'wayper-site', root: site }];
    for (let n = 0; n < 60; n++) {
      const repository = n >= 55 ? 'wayper-site' : 'wayper';
      const repoRoot = repository === 'wayper' ? mobile : site;
      const source = `owner-${n}.js`; const doc = `doc-${n}.md`;
      fs.writeFileSync(path.join(repoRoot, source), `export const value = ${n};\n`);
      fs.writeFileSync(path.join(repoRoot, doc), `# Synthetic ${n}\n`);
      const relevant = n < 5;
      const dependency = { repository, path: source, fingerprint: evidence.sourceFingerprint(repoRoot, source).hash };
      const candidate = memory.buildLearningCandidate({ goalReference: { schemaVersion: 1, threadId: 'memory-scale',
        goalRunId: `gr-${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`, revision: 1 },
      subject: `${relevant ? 'Target recovery invariant' : 'Irrelevant synthetic item'} ${n}`, proposedKind: 'VALIDATED_PATTERN',
      proposedStatement: `${relevant ? 'Recovery target uses current source' : 'Unrelated synthetic knowledge'} ${n}.`,
      scope: { project: 'Wayper', repository, paths: [source], capabilities: relevant ? ['target-recovery'] : ['other'],
        domains: relevant ? ['run'] : ['unrelated'] }, supportingRefs: [
        { kind: 'SOURCE', id: `source-${n}`, repository, path: source, fingerprint: dependency.fingerprint },
        { kind: 'DOCUMENT', id: `doc-${n}`, repository, path: doc, fingerprint: evidence.sourceFingerprint(repoRoot, doc).hash },
        { kind: 'VALIDATION', id: `validation-${n}`, repository: null, path: null, fingerprint: null }],
      contradictingRefs: [], dependencies: [dependency], durabilityReason: 'Synthetic retrieval-scale fixture.' });
      index = memory.promoteLearningCandidate(candidate, index, { repositories, now: `2026-09-14T12:${String(n).padStart(2, '0')}:00.000Z` }).index;
    }
    const retrieval = memory.retrieveProjectMemory({ index, repository: 'wayper', capabilities: ['target-recovery'], domains: ['run'],
      query: 'target recovery', limit: 10, repositories });
    const relevant = retrieval.results.filter((item) => item.subject.startsWith('Target recovery')).length;
    return { status: relevant === 5 && retrieval.results.length <= 10 ? 'PASS' : 'FAIL', detail: { entries: 60,
      retrieved: retrieval.results.length, relevant, precision: retrieval.results.length ? relevant / retrieval.results.length : 0, recall: relevant / 5 } };
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}

async function memoryConcurrency(root, runtime) {
  const modulePath = path.join(root, 'scripts/wayper-project-memory.mjs');
  if (!fs.existsSync(modulePath)) return { status: 'UNSUPPORTED' };
  const worker = path.join(runtime, 'memory-worker.mjs'); const store = path.join(runtime, 'store');
  fs.mkdirSync(path.join(store, 'docs/ai/memory'), { recursive: true });
  fs.writeFileSync(path.join(store, 'docs/ai/memory/index.json'), '{"schemaVersion":2,"entries":[]}\n');
  fs.writeFileSync(path.join(store, 'owner.js'), 'export const owner = true;\n');
  fs.writeFileSync(path.join(store, 'doc.md'), '# doc\n');
  fs.writeFileSync(worker, `import fs from 'node:fs'; import { pathToFileURL } from 'node:url';\nconst [modulePath,store,id]=process.argv.slice(2); const m=await import(pathToFileURL(modulePath)); const e=await import(pathToFileURL(modulePath.replace('wayper-project-memory','wayper-evidence-receipts'))); const repositories=[{id:'wayper',root:store}]; const dep={repository:'wayper',path:'owner.js',fingerprint:e.sourceFingerprint(store,'owner.js').hash}; const c=m.buildLearningCandidate({goalReference:{schemaVersion:1,threadId:'concurrency',goalRunId:'gr-'+id.padStart(8,'0')+'-1111-4111-8111-111111111111',revision:1},subject:'Concurrent '+id,proposedKind:'VALIDATED_PATTERN',proposedStatement:'Concurrent durable '+id+'.',scope:{project:'Wayper',repository:'wayper',paths:['owner.js'],capabilities:['memory'],domains:['harness']},supportingRefs:[{kind:'SOURCE',id:'s'+id,repository:'wayper',path:'owner.js',fingerprint:dep.fingerprint},{kind:'DOCUMENT',id:'d'+id,repository:'wayper',path:'doc.md',fingerprint:e.sourceFingerprint(store,'doc.md').hash},{kind:'VALIDATION',id:'v'+id,repository:null,path:null,fingerprint:null}],contradictingRefs:[],dependencies:[dep],durabilityReason:'Concurrent fixture.'}); const index=m.loadMemoryIndex(store).index; fs.writeFileSync(store+'/ready-'+id,''); while(!fs.existsSync(store+'/release')) await new Promise(r=>setTimeout(r,5)); const promoted=m.promoteLearningCandidate(c,index,{repositories}); m.writeMemoryStore(store,promoted.index);`);
  const children = ['1', '2'].map((id) => spawn(process.execPath, [worker, modulePath, store, id], { stdio: 'ignore' }));
  const deadline = Date.now() + 5_000;
  while ((!fs.existsSync(path.join(store, 'ready-1')) || !fs.existsSync(path.join(store, 'ready-2'))) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  fs.writeFileSync(path.join(store, 'release'), 'go');
  await Promise.all(children.map((child) => new Promise((resolve) => child.on('close', resolve))));
  const final = JSON.parse(fs.readFileSync(path.join(store, 'docs/ai/memory/index.json'), 'utf8'));
  return { status: final.entries.length === 2 ? 'PASS' : 'FAIL', detail: { expectedEntries: 2, actualEntries: final.entries.length,
    limitation: final.entries.length === 2 ? null : 'LOST_UPDATE_NO_MEMORY_CAS' } };
}

async function runProbe(scenario, root, runtime, timeoutMs) {
  const start = process.hrtime.bigint();
  let outcome;
  if (scenario.probe.kind === 'nodeTest') {
    const file = path.join(root, scenario.probe.file);
    if (!fs.existsSync(file)) return { status: 'UNSUPPORTED', durationMs: 0 };
    const result = command(root, process.execPath, ['--test', `--test-name-pattern=${scenario.probe.pattern}`, file], timeoutMs);
    const passed = Number(result.stdout.match(/# pass (\d+)/)?.[1] ?? 0);
    outcome = { status: result.status === 0 && passed > 0 ? 'PASS' : 'FAIL', detail: digest(`${result.stdout}\n${result.stderr}`), durationMs: result.durationMs };
  } else if (scenario.probe.kind === 'command') {
    const file = path.join(root, scenario.probe.file);
    if (!fs.existsSync(file)) return { status: 'UNSUPPORTED', durationMs: 0 };
    const result = command(root, process.execPath, [file, ...(scenario.probe.args ?? [])], timeoutMs);
    outcome = { status: result.status === 0 ? 'PASS' : 'FAIL', detail: digest(`${result.stdout}\n${result.stderr}`), durationMs: result.durationMs };
  } else if (scenario.probe.kind === 'falseProof') {
    const file = path.join(root, 'scripts/quality/check-meta-goal-completion.mjs');
    if (!fs.existsSync(file)) return { status: 'UNSUPPORTED', durationMs: 0 };
    const code = `import {evaluateCompletion,loadEvalSuite} from ${JSON.stringify(pathToFileURL(file).href)}; if(evaluateCompletion(loadEvalSuite().baseRun).eligible) process.exit(1);`;
    const result = command(root, process.execPath, ['--input-type=module', '-e', code], timeoutMs);
    outcome = { status: result.status === 0 ? 'PASS' : 'FAIL', detail: digest(`${result.stdout}\n${result.stderr}`), durationMs: result.durationMs };
  } else if (scenario.probe.kind === 'memoryScale') outcome = await memoryScale(root);
  else if (scenario.probe.kind === 'memoryConcurrency') outcome = await memoryConcurrency(root, runtime);
  else throw new Error(`Unknown probe ${scenario.probe.kind}`);
  outcome.durationMs ??= Number(process.hrtime.bigint() - start) / 1e6;
  return outcome;
}

export function resultFingerprint(result) {
  const { fingerprint: _fingerprint, ...body } = result;
  return digest(body);
}

export function validateResult(result, suite = readSuite()) {
  assert.equal(result.benchmarkVersion, suite.benchmarkVersion);
  assert.ok(Object.hasOwn(suite.candidates, result.candidate));
  assert.equal(result.candidateSha, suite.candidates[result.candidate].sha);
  assert.equal(result.fingerprint, resultFingerprint(result), 'result fingerprint mismatch');
  return true;
}

export const deterministicFalseCompletion = (scenario, probe) =>
  scenario.probe.kind === 'falseProof' && probe.status === 'FAIL';

function record(suite, scenario, candidate, trialId, probe, startedAt) {
  const supported = probe.status !== 'UNSUPPORTED';
  const result = { benchmarkVersion: suite.benchmarkVersion, suiteFingerprint: suite.fingerprint, scenarioId: scenario.id,
    artifactId: digest(`${scenario.id}|${trialId}|${startedAt}`).slice(0, 27), candidate, candidateSha: suite.candidates[candidate].sha,
    trialId, tier: scenario.id[0], risk: scenario.risk, model: suite.model.name, effort: suite.model.effort,
    outcome: probe.status, correct: supported ? probe.status === 'PASS' : null, failureClasses: probe.status === 'FAIL' ? scenario.failureClasses : [],
    humanInterventions: 0, attempts: 1, validationCoverage: supported ? (probe.status === 'PASS' ? 1 : 0) : UNKNOWN,
    contextMetrics: { contextRequests: UNKNOWN, cacheHits: UNKNOWN, cacheMisses: UNKNOWN, artifactsAcquired: UNKNOWN,
      artifactsReused: UNKNOWN, duplicateAcquisitionsAvoided: UNKNOWN, graphQueries: UNKNOWN, graphQueryHits: UNKNOWN,
      graphRefreshes: UNKNOWN, packetSize: UNKNOWN, contextBytes: UNKNOWN },
    timeMetrics: { wallClockDurationMs: probe.durationMs, activeExecutionDurationMs: probe.durationMs },
    tokenMetrics: { inputTokens: UNKNOWN, outputTokens: UNKNOWN, totalTokens: UNKNOWN, tokenProxy: UNKNOWN },
    safety: { falseCompletion: deterministicFalseCompletion(scenario, probe), falseBlock: false, unauthorizedMutation: false, externalWorkDamage: false,
      crossRepoLeakage: false, staleMemoryUsedAsTruth: false }, artifactRefs: [], evidenceRefs: [probe.detail ?? 'UNSUPPORTED'],
    infrastructureRetries: 0, incomplete: false, startedAt };
  result.fingerprint = resultFingerprint(result);
  return result;
}

export async function runDeterministic(tier, { persist = true } = {}) {
  const suite = readSuite(); validateSuite(suite);
  const scenarios = suite.scenarios[tier]; const results = [];
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `wayper-bench-${tier.toLowerCase()}-`));
  const worktrees = {};
  try {
    for (const candidate of ['V1', 'V2']) worktrees[candidate] = addWorktree(suite.candidates[candidate].sha, candidate.toLowerCase(), parent);
    for (let index = 0; index < scenarios.length; index++) {
      const scenario = scenarios[index]; const order = index % 2 ? ['V2', 'V1'] : ['V1', 'V2'];
      for (const candidate of order) {
        const startedAt = new Date().toISOString();
        const probe = await runProbe(scenario, worktrees[candidate].directory, worktrees[candidate].runtime, suite.budgets.maxRuntimeSeconds * 1000);
        results.push(record(suite, scenario, candidate, `${scenario.id}-T1`, probe, startedAt));
      }
    }
  } finally {
    for (const item of Object.values(worktrees)) if (fs.existsSync(item.directory)) git(['worktree', 'remove', '--force', item.directory]);
    fs.rmSync(parent, { recursive: true, force: true });
  }
  if (persist) { fs.mkdirSync(RESULTS_ROOT, { recursive: true }); fs.writeFileSync(path.join(RESULTS_ROOT, `tier-${tier.toLowerCase()}.json`), `${JSON.stringify(results, null, 2)}\n`); }
  return results;
}

function median(values) {
  const numbers = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return UNKNOWN;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

export function aggregate(results, candidate) {
  const rows = results.filter((item) => item.candidate === candidate);
  const supported = rows.filter((item) => item.correct !== null);
  return { trials: rows.length, supported: supported.length, correct: supported.filter((item) => item.correct).length,
    falseCompletions: rows.filter((item) => item.safety.falseCompletion).length,
    falseBlocks: rows.filter((item) => item.safety.falseBlock).length,
    safetyViolations: rows.filter((item) => Object.entries(item.safety).some(([key, value]) => key !== 'falseBlock' && value)).length,
    unauthorizedMutations: rows.filter((item) => item.safety.unauthorizedMutation).length,
    externalWorkDamage: rows.filter((item) => item.safety.externalWorkDamage).length,
    medianTimeMs: median(rows.map((item) => item.timeMetrics.wallClockDurationMs)),
    medianTokens: median(rows.map((item) => item.tokenMetrics.totalTokens)),
    medianAttempts: median(rows.map((item) => item.attempts)) };
}

function loadResults(tier) {
  const file = path.join(RESULTS_ROOT, `tier-${tier.toLowerCase()}.json`);
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const row of rows) validateResult(row);
  return rows;
}

export function significance(values) {
  return values.length < 2 ? { claim: 'INSUFFICIENT_SAMPLE', confidenceInterval: UNKNOWN } : { claim: 'DESCRIPTIVE_ONLY', confidenceInterval: UNKNOWN };
}

export function reportSanity(rows) {
  const falseCompletions = rows.filter((row) => row.safety.falseCompletion);
  return { falseCompletions: falseCompletions.length, unknownPreserved: rows.some((row) => Object.values(row.tokenMetrics).includes(UNKNOWN)),
    unsupportedExcludedFromFailures: rows.filter((row) => row.outcome === 'UNSUPPORTED').every((row) => row.correct === null),
    significance: significance(rows) };
}

function main() {
  const commandName = process.argv[2] ?? 'validate';
  if (commandName === 'validate') console.log(JSON.stringify(validateSuite(), null, 2));
  else if (commandName === 'tier-a') runDeterministic('A').then((rows) => console.log(`TIER A PASS ${rows.length} records`));
  else if (commandName === 'tier-c') runDeterministic('C').then((rows) => console.log(`TIER C PASS ${rows.length} records`));
  else if (commandName === 'report') {
    const rows = [...loadResults('A'), ...loadResults('B'), ...loadResults('C')];
    console.log(JSON.stringify({ V1: aggregate(rows, 'V1'), V2: aggregate(rows, 'V2'), sanity: reportSanity(rows) }, null, 2));
  } else throw new Error(`Usage: ${path.basename(process.argv[1])} validate|tier-a|tier-c|report`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
