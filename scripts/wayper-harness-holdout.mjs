import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { productFingerprint, resultFingerprint, ROOT, suiteFingerprint } from './wayper-harness-benchmark.mjs';
import { isUsageLimit, singleTrial } from './wayper-harness-benchmark-agentic.mjs';
import { scoreHoldout } from './wayper-harness-holdout-score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTROL = path.join(ROOT, 'docs/ai/benchmarks/harness-holdout');
const RAW = path.join(ROOT, '.wayper-context/benchmark-runs/holdout');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
};

export function readFrozen() {
  const freeze = JSON.parse(fs.readFileSync(path.join(CONTROL, 'freeze.json'), 'utf8'));
  assert.equal(sha256(path.join(CONTROL, 'suite.json')), freeze.suiteSha256, 'SUITE_CHANGED_AFTER_FREEZE');
  assert.equal(sha256(path.join(HERE, 'wayper-harness-holdout-score.mjs')), freeze.scorerSha256,
    'SCORER_CHANGED_AFTER_FREEZE');
  const suite = JSON.parse(fs.readFileSync(path.join(CONTROL, 'suite.json'), 'utf8'));
  assert.equal(suiteFingerprint(suite), suite.fingerprint, 'SUITE_FINGERPRINT_MISMATCH');
  assert.equal(suite.fingerprint, freeze.suiteFingerprint, 'FREEZE_FINGERPRINT_MISMATCH');
  assert.equal(suite.benchmarkVersion, 'HoldoutSuite V1');
  assert.equal(suite.profile, 'holdout');
  assert.equal(suite.model.name, 'gpt-6-sol');
  assert.equal(suite.model.effort, 'high');
  assert.equal(suite.model.runtime, 'codex-cli 0.155.1');
  assert.deepEqual(Object.keys(suite.candidates).sort(), ['V1', 'V2']);
  assert.equal(productFingerprint(suite.candidates.V1.sha), productFingerprint(suite.candidates.V2.sha));
  assert.equal(productFingerprint(suite.candidates.V1.sha), freeze.productFingerprint);
  assert.deepEqual(Object.fromEntries(Object.entries(suite.candidates).map(([id, value]) => [id, value.sha])), freeze.candidates);
  assert.equal(suite.budgets.maxRuntimeSeconds, freeze.timeoutSeconds);
  assert.equal(suite.scenarios.B.length, 12);
  assert.equal(new Set(suite.scenarios.B.map((s) => s.id)).size, 12);
  assert.equal(suite.scenarios.B.reduce((n, s) => n + 2 * s.repetitions, 0), 48);
  for (const scenario of suite.scenarios.B) {
    const truth = scenario.groundTruth;
    assert.match(scenario.id, /^H\d{2}$/);
    assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(scenario.risk));
    assert.equal(scenario.repetitions, ['HIGH', 'CRITICAL'].includes(scenario.risk) ? 3 : 1);
    for (const key of ['requiredOutcome', 'requiredChanges', 'forbiddenChanges', 'requiredEvidence',
      'requiredValidation', 'expectedBlockers', 'expectedHumanDecision', 'allowedUnknowns',
      'successConditions', 'failureConditions']) assert.ok(Object.hasOwn(truth, key), `${scenario.id}: ${key}`);
  }
  const cli = spawnSync('/home/eduardo/.codex/packages/standalone/releases/0.155.1-x86_64-unknown-linux-musl/bin/codex',
    ['--version'], { encoding: 'utf8' });
  assert.equal(cli.stdout.trim(), suite.model.runtime, 'CODEX_RUNTIME_MISMATCH');
  assert.equal(spawnSync('bwrap', ['--version'], { encoding: 'utf8' }).status, 0, 'BWRAP_UNAVAILABLE');
  return { suite, freeze };
}

function worklist(suite) {
  const scenarios = suite.scenarios.B;
  const tasks = [];
  for (let trial = 1; trial <= 3; trial++) for (let index = 0; index < scenarios.length; index++) {
    const scenario = scenarios[index];
    if (trial > scenario.repetitions) continue;
    const order = (index + trial) % 2 ? ['V1', 'V2'] : ['V2', 'V1'];
    for (const candidate of order) tasks.push({ scenario, trial, candidate });
  }
  return tasks;
}

export async function runHoldout(resumeRunId = null) {
  const { suite, freeze } = readFrozen();
  const runId = resumeRunId ?? `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  assert.match(runId, /^[A-Za-z0-9-]+$/);
  const runRoot = path.join(RAW, runId);
  if (!resumeRunId) assert.equal(fs.existsSync(runRoot), false, 'RUN_ID_EXISTS');
  const checkpointPath = path.join(runRoot, 'checkpoint.json');
  let checkpoint = resumeRunId ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : {
    runId, status: 'RUNNING', suiteFingerprint: suite.fingerprint,
    freeze, completed: [], startedAt: new Date().toISOString(),
  };
  assert.equal(checkpoint.runId, runId);
  assert.equal(checkpoint.suiteFingerprint, suite.fingerprint);
  assert.deepEqual(checkpoint.freeze, freeze);
  assert.notEqual(checkpoint.status, 'COMPLETE', 'RUN_ALREADY_COMPLETE');
  for (const row of checkpoint.completed) {
    assert.equal(row.suiteFingerprint, suite.fingerprint);
    assert.equal(row.candidateSha, suite.candidates[row.candidate].sha);
    assert.equal(row.fingerprint, resultFingerprint(row));
    assert.ok(fs.existsSync(path.join(ROOT, row.rawArtifacts, 'result.json')));
  }
  const completed = new Set(checkpoint.completed.map((row) => `${row.trialId}-${row.candidate}`));
  write(checkpointPath, checkpoint);
  for (const task of worklist(suite)) {
    const key = `${task.scenario.id}-T${task.trial}-${task.candidate}`;
    if (completed.has(key)) continue;
    checkpoint = { ...checkpoint, status: 'RUNNING', current: key, updatedAt: new Date().toISOString() };
    write(checkpointPath, checkpoint);
    const result = await singleTrial(suite, task.scenario, task.candidate, task.trial,
      { runRoot, scorer: scoreHoldout });
    if (result.terminalClass === 'BENCHMARK_INFRA_FAILURE') {
      checkpoint = { ...checkpoint, status: isUsageLimit(result) ? 'EXTERNAL_BLOCK' : 'INFRASTRUCTURE_BLOCKED',
        blockedResult: result, updatedAt: new Date().toISOString() };
      write(checkpointPath, checkpoint);
      console.log(`${key} ${checkpoint.status}: ${result.infrastructureDiagnostic?.cause}`);
      return checkpoint;
    }
    checkpoint.completed.push(result);
    completed.add(key);
    checkpoint = { ...checkpoint, blockedResult: null, updatedAt: new Date().toISOString() };
    write(checkpointPath, checkpoint);
    console.log(`${key} ${result.outcome} correct=${result.correct}`);
  }
  checkpoint = { ...checkpoint, status: 'COMPLETE', current: null, updatedAt: new Date().toISOString() };
  write(path.join(runRoot, 'results.json'), checkpoint.completed);
  write(checkpointPath, checkpoint);
  return checkpoint;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? 'validate';
  if (command === 'validate') {
    const { suite, freeze } = readFrozen();
    console.log(JSON.stringify({ status: 'PASS', fingerprint: suite.fingerprint, freeze,
      productFingerprint: productFingerprint(suite.candidates.V1.sha), trials: worklist(suite).length }, null, 2));
  } else if (command === 'run') {
    runHoldout(process.argv.find((arg) => arg.startsWith('--resume='))?.slice(9) ?? null)
      .then((checkpoint) => { console.log(`HOLDOUT ${checkpoint.status} ${checkpoint.completed.length}/48 run=${checkpoint.runId}`);
        if (checkpoint.status !== 'COMPLETE') process.exitCode = 2; })
      .catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
  } else throw new Error('Usage: holdout validate|run [--resume=RUN_ID]');
}
