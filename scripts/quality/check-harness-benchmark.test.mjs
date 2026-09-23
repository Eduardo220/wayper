import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addWorktree, deterministicFalseCompletion, digest, productFingerprint, readSuite, removeWorktree, reportSanity,
  resultFingerprint, significance, suiteFingerprint, validateResult, validateSuite } from '../wayper-harness-benchmark.mjs';
import { classifyAttempt, isUsageLimit, OUTPUT_SCHEMA, parseCandidateOutput, runAgentic, runProcess, singleTrial,
  terminalClass } from '../wayper-harness-benchmark-agentic.mjs';

const suite = readSuite();

test('BM1 BM2 BM3 candidates use isolated worktrees, equal product source and isolated runtime', () => {
  const first = addWorktree(suite.candidates.V1.sha, 'v1');
  const second = addWorktree(suite.candidates.V2.sha, 'v2');
  try {
    assert.notEqual(first.directory, second.directory);
    assert.notEqual(first.runtime, second.runtime);
    assert.equal(fs.realpathSync(first.directory) === fs.realpathSync(second.directory), false);
    assert.equal(productFingerprint(suite.candidates.V1.sha), productFingerprint(suite.candidates.V2.sha));
    fs.writeFileSync(path.join(first.runtime, 'only-v1'), 'v1');
    assert.equal(fs.existsSync(path.join(second.runtime, 'only-v1')), false);
  } finally { removeWorktree(first); removeWorktree(second); }
});

test('BM4 suite and ground truth are fingerprinted before trials', () => {
  const before = digest(fs.readFileSync(new URL('../../docs/ai/benchmarks/harness-v1-v2/suite.json', import.meta.url)));
  assert.equal(suiteFingerprint(suite), suite.fingerprint);
  assert.equal(validateSuite(suite).status, 'PASS');
  assert.equal(digest(fs.readFileSync(new URL('../../docs/ai/benchmarks/harness-v1-v2/suite.json', import.meta.url))), before);
});

test('BM5 candidate identity is exact and historical order is proven', () => {
  const checked = validateSuite(suite);
  assert.match(suite.candidates.V1.sha, /^[a-f0-9]{40}$/);
  assert.match(suite.candidates.V2.sha, /^[a-f0-9]{40}$/);
  assert.notEqual(suite.candidates.V1.sha, suite.candidates.V2.sha);
  assert.match(checked.productFingerprint, /^sha256:/);
});

function result(extra = {}) {
  const value = {
    benchmarkVersion: suite.benchmarkVersion, suiteFingerprint: suite.fingerprint, scenarioId: 'A1', artifactId: 'AR-neutral',
    candidate: 'V1', candidateSha: suite.candidates.V1.sha, trialId: 'A1-T1', tier: 'A', risk: 'LOW',
    model: suite.model.name, effort: suite.model.effort, outcome: 'UNSUPPORTED', correct: null, failureClasses: [],
    humanInterventions: 0, attempts: 1, validationCoverage: 'UNKNOWN', contextMetrics: { contextBytes: 'UNKNOWN' },
    timeMetrics: { wallClockDurationMs: 1, activeExecutionDurationMs: 1 },
    tokenMetrics: { inputTokens: 'UNKNOWN', outputTokens: 'UNKNOWN', totalTokens: 'UNKNOWN', tokenProxy: 'UNKNOWN' },
    safety: { falseCompletion: false, falseBlock: false, unauthorizedMutation: false, externalWorkDamage: false,
      crossRepoLeakage: false, staleMemoryUsedAsTruth: false }, artifactRefs: [], evidenceRefs: [],
    infrastructureRetries: 0, incomplete: false, startedAt: '2026-09-14T19:00:00.000Z', ...extra,
  };
  value.fingerprint = resultFingerprint(value);
  return value;
}

test('BM6 result tampering is detected', () => {
  const valid = result(); assert.equal(validateResult(valid, suite), true);
  assert.throws(() => validateResult({ ...valid, outcome: 'PASS' }, suite), /fingerprint/);
});

test('BM7 trial output schema is closed and bounded', () => {
  assert.equal(OUTPUT_SCHEMA.additionalProperties, false);
  assert.equal(OUTPUT_SCHEMA.properties.summary.maxLength, 1200);
  assert.ok(OUTPUT_SCHEMA.properties.validation.maxItems <= 20);
});

test('BM8 UNKNOWN remains UNKNOWN and UNSUPPORTED is not failure', () => {
  const sanity = reportSanity([result()]);
  assert.equal(sanity.unknownPreserved, true);
  assert.equal(sanity.unsupportedExcludedFromFailures, true);
});

test('BM9 interrupted trial is incomplete, not a candidate failure', () => {
  const interrupted = result({ outcome: 'TIMEOUT', incomplete: true, correct: null });
  interrupted.fingerprint = resultFingerprint(interrupted);
  assert.equal(interrupted.correct, null);
  assert.deepEqual(interrupted.failureClasses, []);
});

test('BM10 infrastructure retry is separate from Harness attempts', () => {
  const retried = result({ infrastructureRetries: 1, attempts: 'UNKNOWN' });
  retried.fingerprint = resultFingerprint(retried);
  assert.equal(retried.infrastructureRetries, 1);
  assert.equal(retried.attempts, 'UNKNOWN');
});

async function processFixture(script, { timeoutMs = 2_000, controller } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-bench-runner-test-'));
  const stdoutPath = path.join(root, 'stdout.log'); const stderrPath = path.join(root, 'stderr.log');
  try {
    const run = await runProcess(process.execPath, ['-e', script], { cwd: root, timeoutMs, stdoutPath, stderrPath,
      signal: controller?.signal, killGraceMs: 50 });
    return { run, stdout: fs.readFileSync(stdoutPath, 'utf8'), stderr: fs.readFileSync(stderrPath, 'utf8') };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('agentic runner preserves successful stdout/stderr and candidate failure stays candidate-owned', async () => {
  const fixture = await processFixture('process.stdout.write("ok"); process.stderr.write("warn");');
  assert.equal(classifyAttempt({ run: fixture.run }).outcome, 'CANDIDATE_RESULT');
  assert.equal(fixture.stdout, 'ok'); assert.equal(fixture.stderr, 'warn');
  assert.equal(terminalClass(classifyAttempt({ run: fixture.run }), { correct: true }), 'CANDIDATE_SUCCESS');
  assert.equal(terminalClass(classifyAttempt({ run: fixture.run }), { correct: false }), 'CANDIDATE_FAILURE');
});

test('agentic runner classifies timeout, SIGKILL and interruption distinctly', async () => {
  const timedOut = await processFixture('setInterval(() => {}, 1000);', { timeoutMs: 30 });
  assert.equal(classifyAttempt({ run: timedOut.run }).outcome, 'TIMEOUT');
  const killed = await processFixture('process.kill(process.pid, "SIGKILL");');
  assert.deepEqual(classifyAttempt({ run: killed.run }), {
    outcome: 'BENCHMARK_INFRA_FAILURE', retryable: true, stage: 'CODEX_EXEC', cause: 'PROCESS_SIGNAL' });
  assert.equal(killed.run.signal, 'SIGKILL');
  const controller = new AbortController(); setTimeout(() => controller.abort(), 30);
  const interrupted = await processFixture('setInterval(() => {}, 1000);', { controller });
  assert.equal(classifyAttempt({ run: interrupted.run }).cause, 'PROCESS_INTERRUPTED');
  assert.equal(classifyAttempt({ run: interrupted.run }).retryable, false);
});

test('agentic runner treats malformed structured output as infrastructure failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-bench-output-test-')); const output = path.join(root, 'final.json');
  try {
    fs.writeFileSync(output, '{not-json');
    const parsed = parseCandidateOutput(output); const classified = classifyAttempt({ run: { status: 0 }, outputError: parsed.error });
    assert.equal(classified.outcome, 'BENCHMARK_INFRA_FAILURE'); assert.equal(classified.stage, 'RESULT_PARSE');
    assert.match(classified.cause, /^OUTPUT_MALFORMED:/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('agentic runner preserves Codex usage-limit cause without retrying it', () => {
  const message = "You've hit your usage limit. Try again later.";
  const classified = classifyAttempt({ run: { status: 1, stdout: `${JSON.stringify({ type: 'error', message })}\n`, stderr: '' } });
  assert.equal(classified.outcome, 'BENCHMARK_INFRA_FAILURE'); assert.equal(classified.retryable, false);
  assert.equal(classified.cause, `CODEX_USAGE_LIMIT: ${message}`);
  assert.equal(isUsageLimit({ terminalClass: 'BENCHMARK_INFRA_FAILURE', infrastructureDiagnostic: classified }), true);
});

test('usage-limit resume does not consume the automatic infrastructure retry budget', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-bench-quota-resume-test-'));
  const trialRoot = path.join(root, 'B1-T1-V1');
  const records = [
    { attempt: 1, startedAt: '2026-09-21T18:45:15.746Z', classification: {
      outcome: 'BENCHMARK_INFRA_FAILURE', retryable: true, stage: 'CODEX_EXEC', cause: 'NON_ZERO_EXIT' } },
    { attempt: 2, startedAt: '2026-09-21T18:45:15.746Z', classification: {
      outcome: 'BENCHMARK_INFRA_FAILURE', retryable: false, stage: 'CODEX_EXEC', cause: 'CODEX_USAGE_LIMIT: synthetic limit' } },
  ];
  try {
    records.forEach((record) => {
      const attemptRoot = path.join(trialRoot, `attempt-${record.attempt}`); fs.mkdirSync(attemptRoot, { recursive: true });
      fs.writeFileSync(path.join(attemptRoot, 'attempt.json'), JSON.stringify(record));
    });
    const isolatedSuite = structuredClone(suite); isolatedSuite.budgets.maxInfrastructureRetries = 1;
    const resumed = await singleTrial(isolatedSuite, suite.scenarios.B[0], 'V1', 1, { runRoot: root,
      adapters: { addWorktree: () => { throw new Error('synthetic worktree failure'); } } });
    assert.equal(resumed.infrastructureRetries, 1);
    assert.equal(fs.existsSync(path.join(trialRoot, 'attempt-3', 'attempt.json')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('agentic runner records worktree setup failure with diagnostics and no Harness retry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-bench-worktree-test-'));
  const isolatedSuite = structuredClone(suite); isolatedSuite.budgets.maxInfrastructureRetries = 0;
  try {
    const row = await singleTrial(isolatedSuite, suite.scenarios.B[0], 'V1', 1, { runRoot: root,
      adapters: { addWorktree: () => { throw new Error('synthetic worktree failure'); } } });
    assert.equal(row.outcome, 'BENCHMARK_INFRA_FAILURE'); assert.equal(row.terminalClass, 'BENCHMARK_INFRA_FAILURE');
    assert.equal(row.infrastructureRetries, 0); assert.equal(row.attempts, 'UNKNOWN');
    assert.equal(row.infrastructureDiagnostic.stage, 'WORKTREE_SETUP');
    assert.match(row.infrastructureDiagnostic.cause, /synthetic worktree failure/);
    const stdout = row.infrastructureDiagnostic.stdout;
    assert.equal(stdout.bytes, fs.statSync(stdout.path).size);
    assert.equal(stdout.hash, `sha256:${crypto.createHash('sha256').update(fs.readFileSync(stdout.path)).digest('hex')}`);
    assert.equal(fs.existsSync(path.join(root, 'B1-T1-V1', 'attempt-1', 'attempt.json')), true);
    isolatedSuite.budgets.maxInfrastructureRetries = 1;
    const retried = await singleTrial(isolatedSuite, suite.scenarios.B[0], 'V1', 1, { runRoot: root,
      adapters: { addWorktree: () => { throw new Error('synthetic worktree failure'); } } });
    assert.equal(retried.infrastructureRetries, 1);
    assert.equal(fs.existsSync(path.join(root, 'B1-T1-V1', 'attempt-2', 'attempt.json')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('agentic runner checkpoints usage limits and resumes without rerunning completed trials', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-bench-resume-test-'));
  const usageFailure = result({ scenarioId: 'B1', trialId: 'B1-T1', tier: 'B', outcome: 'BENCHMARK_INFRA_FAILURE',
    correct: null, terminalClass: 'BENCHMARK_INFRA_FAILURE', incomplete: true,
    infrastructureDiagnostic: { cause: 'CODEX_USAGE_LIMIT: synthetic limit' } });
  usageFailure.fingerprint = resultFingerprint(usageFailure);
  try {
    await assert.rejects(runAgentic({ persist: false, only: ['B1'], artifactsRoot: root,
      trialRunner: async () => usageFailure }), /resume with --resume=/);
    const [runId] = fs.readdirSync(root); const checkpointPath = path.join(root, runId, 'checkpoint.json');
    const blocked = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    assert.equal(blocked.status, 'INFRASTRUCTURE_BLOCKED'); assert.equal(blocked.completed.length, 0);
    blocked.startedAt = null; fs.writeFileSync(checkpointPath, JSON.stringify(blocked));
    let calls = 0;
    const rows = await runAgentic({ persist: false, artifactsRoot: root, resumeRunId: runId,
      trialRunner: async (_suite, scenario, candidate, trial) => {
        calls++;
        const row = result({ scenarioId: scenario.id, trialId: `${scenario.id}-T${trial}`, tier: 'B', candidate,
          candidateSha: suite.candidates[candidate].sha, outcome: 'COMPLETE', correct: true, terminalClass: 'CANDIDATE_SUCCESS' });
        row.fingerprint = resultFingerprint(row); return row;
      } });
    assert.equal(calls, 2); assert.equal(rows.length, 2);
    const completed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    assert.equal(completed.status, 'COMPLETE'); assert.equal(typeof completed.startedAt, 'string');
    assert.equal(typeof completed.resumedAt, 'string');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('report sanity keeps false completion visible and n=1 non-significant', () => {
  const falseCompletion = result({ outcome: 'COMPLETE', correct: false,
    safety: { ...result().safety, falseCompletion: true } });
  falseCompletion.fingerprint = resultFingerprint(falseCompletion);
  assert.equal(reportSanity([falseCompletion]).falseCompletions, 1);
  const falseProof = suite.scenarios.A.find((scenario) => scenario.id === 'A3');
  assert.equal(deterministicFalseCompletion(falseProof, { status: 'FAIL' }), true);
  assert.equal(deterministicFalseCompletion(falseProof, { status: 'PASS' }), false);
  assert.equal(significance([1]).claim, 'INSUFFICIENT_SAMPLE');
});

test('suite fixes 24 A, 12 B, 23 C and 36 paired agentic trials', () => {
  const checked = validateSuite(suite);
  assert.deepEqual(checked.scenarios, { A: 24, B: 12, C: 23 });
  assert.equal(checked.expectedAgenticTrials, 36);
  assert.equal(suite.scenarios.B.filter((item) => item.repetitions === 3).length, 3);
});
