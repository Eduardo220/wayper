import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, resultFingerprint } from './wayper-harness-benchmark.mjs';
import { isUsageLimit, singleTrial } from './wayper-harness-benchmark-agentic.mjs';
import { readFrozen } from './wayper-harness-holdout.mjs';
import { scoreHoldout } from './wayper-harness-holdout-score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(ROOT, '.wayper-context/benchmark-runs/diagnostic-replay');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const runnerHashes = () => Object.fromEntries(['wayper-harness-benchmark-agentic.mjs',
  'wayper-harness-telemetry.mjs', 'wayper-harness-diagnostic.mjs'].map((name) => [name, hash(path.join(HERE, name))]));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};

export function diagnosticWorklist(suite, repetitions = 3) {
  assert.ok(repetitions === 3 || repetitions === 5, 'DIAGNOSTIC_REPETITIONS');
  const tasks = [];
  for (let trial = 1; trial <= repetitions; trial++) for (const id of ['H10', 'H11']) {
    const scenario = suite.scenarios.B.find((item) => item.id === id);
    assert.ok(scenario, `MISSING_SCENARIO:${id}`);
    for (const candidate of (trial + (id === 'H11' ? 1 : 0)) % 2 ? ['V1', 'V2'] : ['V2', 'V1']) {
      tasks.push({ scenario, trial, candidate });
    }
  }
  return tasks;
}

export function validateDiagnosticCheckpoint(checkpoint, { runId, freeze, runnerSha, telemetryHash, fileHashes, repetitions }) {
  assert.equal(checkpoint.kind, 'DIAGNOSTIC_REPLAY');
  assert.equal(checkpoint.runId, runId);
  assert.deepEqual(checkpoint.freeze, freeze);
  assert.equal(checkpoint.runnerSha, runnerSha);
  assert.equal(checkpoint.telemetryHash, telemetryHash);
  if (fileHashes) assert.deepEqual(checkpoint.fileHashes, fileHashes);
  assert.equal(checkpoint.repetitions, repetitions);
  assert.notEqual(checkpoint.status, 'COMPLETE', 'DIAGNOSTIC_ALREADY_COMPLETE');
  for (const row of checkpoint.completed) {
    assert.equal(row.suiteFingerprint, freeze.suiteFingerprint);
    assert.equal(row.candidateSha, freeze.candidates[row.candidate]);
    assert.equal(row.fingerprint, resultFingerprint(row));
    assert.ok(fs.existsSync(path.join(ROOT, row.rawArtifacts, 'result.json')));
    assert.equal(row.telemetry?.runKind, 'DIAGNOSTIC_REPLAY');
    assert.ok(Array.isArray(row.telemetry.attempts) && row.telemetry.attempts.length > 0);
    for (const ref of row.telemetry.attempts) {
      assert.equal(hash(ref.path), ref.hash.slice(7));
      const trace = JSON.parse(fs.readFileSync(ref.path, 'utf8'));
      assert.equal(trace.runKind, 'DIAGNOSTIC_REPLAY');
      assert.equal(trace.runId, runId);
      assert.equal(trace.candidateSha, row.candidateSha);
    }
  }
  return true;
}

export async function runDiagnostic({ resumeRunId = null, repetitions = 3, trialRunner = singleTrial } = {}) {
  const { suite, freeze } = readFrozen();
  const runnerSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const telemetryHash = hash(path.join(HERE, 'wayper-harness-telemetry.mjs'));
  const fileHashes = runnerHashes();
  const runId = resumeRunId ?? `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  assert.match(runId, /^[A-Za-z0-9-]+$/);
  const runRoot = path.join(RAW, runId); const checkpointPath = path.join(runRoot, 'checkpoint.json');
  if (!resumeRunId) assert.equal(fs.existsSync(runRoot), false, 'RUN_ID_EXISTS');
  let checkpoint = resumeRunId ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : {
    kind: 'DIAGNOSTIC_REPLAY', runId, status: 'RUNNING', freeze, runnerSha, telemetryHash, fileHashes,
    repetitions, completed: [], startedAt: new Date().toISOString(),
  };
  if (resumeRunId) validateDiagnosticCheckpoint(checkpoint, { runId, freeze, runnerSha, telemetryHash, fileHashes, repetitions });
  write(checkpointPath, checkpoint);
  const completed = new Set(checkpoint.completed.map((row) => `${row.trialId}-${row.candidate}`));
  for (const task of diagnosticWorklist(suite, repetitions)) {
    assert.deepEqual(runnerHashes(), fileHashes, 'DIAGNOSTIC_RUNNER_CHANGED');
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), runnerSha, 'DIAGNOSTIC_HEAD_CHANGED');
    assert.deepEqual(readFrozen().freeze, freeze, 'DIAGNOSTIC_FREEZE_CHANGED');
    const key = `${task.scenario.id}-T${task.trial}-${task.candidate}`;
    if (completed.has(key)) continue;
    checkpoint = { ...checkpoint, status: 'RUNNING', current: key, updatedAt: new Date().toISOString() };
    write(checkpointPath, checkpoint);
    const result = await trialRunner(suite, task.scenario, task.candidate, task.trial,
      { runRoot, scorer: scoreHoldout, kind: 'DIAGNOSTIC_REPLAY' });
    if (result.terminalClass === 'BENCHMARK_INFRA_FAILURE' || result.terminalClass === 'TIMEOUT') {
      checkpoint = { ...checkpoint, status: isUsageLimit(result) ? 'INFRASTRUCTURE_BLOCKED' :
        result.terminalClass === 'TIMEOUT' ? 'INCOMPLETE_TIMEOUT' : 'INFRASTRUCTURE_BLOCKED',
      blockedResult: result, updatedAt: new Date().toISOString() };
      write(checkpointPath, checkpoint);
      return checkpoint;
    }
    checkpoint.completed.push(result); completed.add(key);
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
  const resumeRunId = process.argv.find((arg) => arg.startsWith('--resume='))?.slice(9) ?? null;
  const repetitions = Number(process.argv.find((arg) => arg.startsWith('--repetitions='))?.slice(14) ?? 3);
  runDiagnostic({ resumeRunId, repetitions }).then((checkpoint) => {
    console.log(`DIAGNOSTIC_REPLAY ${checkpoint.status} ${checkpoint.completed.length}/${repetitions * 4} run=${checkpoint.runId}`);
    if (checkpoint.status !== 'COMPLETE') process.exitCode = 2;
  }).catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
