import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { addWorktree, deterministicFalseCompletion, digest, productFingerprint, readProfileSuite, readSuite, removeWorktree, reportSanity, ROOT,
  resultFingerprint, significance, suiteFingerprint, validateResult, validateSuite } from '../wayper-harness-benchmark.mjs';
import { classifyAttempt, isUsageLimit, OUTPUT_SCHEMA, parseCandidateOutput, runAgentic, runProcess, singleTrial,
  terminalClass, usage } from '../wayper-harness-benchmark-agentic.mjs';
import { estimatedCost, generateOperationalReport } from '../wayper-harness-benchmark-operational-report.mjs';

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
  const suiteBytes = fs.readFileSync(new URL('../../docs/ai/benchmarks/harness-v1-v2/suite.json', import.meta.url));
  const before = digest(suiteBytes);
  assert.equal(crypto.createHash('sha256').update(suiteBytes).digest('hex'),
    '445af6fecdcedf42986caad0e469f1ca38f6ec3c2155519ac0da9458563b59b9');
  assert.equal(suiteFingerprint(suite), suite.fingerprint);
  assert.equal(validateSuite(suite).status, 'PASS');
  assert.equal(digest(fs.readFileSync(new URL('../../docs/ai/benchmarks/harness-v1-v2/suite.json', import.meta.url))), before);
});

test('operational profile changes only execution identity and cannot validate as historical', () => {
  const operational = readProfileSuite('operational');
  assert.equal(validateSuite(operational).status, 'PASS');
  assert.equal(operational.profile, 'operational');
  assert.equal(operational.model.name, 'gpt-6-sol'); assert.equal(operational.model.effort, 'high');
  assert.match(operational.model.runtime, /^codex-cli \d+\.\d+\.\d+/);
  assert.equal(operational.historicalSuiteFingerprint, suite.fingerprint);
  assert.notEqual(operational.fingerprint, suite.fingerprint);
  assert.deepEqual(operational.scenarios, suite.scenarios);
  assert.deepEqual(operational.groundTruthTemplates, suite.groundTruthTemplates);
  assert.deepEqual(operational.scoring, suite.scoring);
  const row = result({ profile: 'operational', codexRuntime: operational.model.runtime,
    suiteFingerprint: operational.fingerprint, model: operational.model.name, effort: operational.model.effort });
  row.fingerprint = resultFingerprint(row);
  assert.equal(validateResult(row, operational), true);
  assert.throws(() => validateResult(row, suite));
  assert.throws(() => readProfileSuite('unknown'), /UNKNOWN_BENCHMARK_PROFILE/);
});

test('PT benchmark tuned profile freezes one V2 SHA and rejects baseline reuse', () => {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const runtime = readProfileSuite('operational').model.runtime;
  const tuned = readProfileSuite('operational-tuned', runtime, sha);
  assert.equal(validateSuite(tuned).status, 'PASS');
  assert.deepEqual(tuned.scenarios, suite.scenarios);
  assert.deepEqual(tuned.groundTruthTemplates, suite.groundTruthTemplates);
  assert.deepEqual(tuned.scoring, suite.scoring);
  assert.equal(tuned.candidates.V2.sha, sha);
  assert.notEqual(tuned.fingerprint, readProfileSuite('operational', runtime).fingerprint);
  assert.throws(() => readProfileSuite('operational-tuned', runtime), /TUNED_CANDIDATE_SHA_REQUIRED/);
});

test('PT tuned runner executes V2 only and checkpoints the candidate fingerprint', async () => {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const tuned = readProfileSuite('operational-tuned', null, sha);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-tuned-runner-')); const calls = [];
  try {
    const rows = await runAgentic({ profile: 'operational-tuned', tunedSha: sha, persist: false, only: ['B1'], artifactsRoot: root,
      trialRunner: async (_suite, scenario, candidate, trial) => {
        calls.push(candidate);
        const row = result({ profile: tuned.profile, codexRuntime: tuned.model.runtime, suiteFingerprint: tuned.fingerprint,
          model: tuned.model.name, effort: tuned.model.effort, scenarioId: scenario.id, trialId: `${scenario.id}-T${trial}`,
          tier: 'B', candidate, candidateSha: sha, outcome: 'COMPLETE', correct: true });
        row.fingerprint = resultFingerprint(row); return row;
      } });
    assert.deepEqual(calls, ['V2']); assert.equal(rows.length, 1); assert.equal(validateResult(rows[0], tuned), true);
    const [runId] = fs.readdirSync(root);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(root, runId, 'checkpoint.json'), 'utf8'));
    assert.equal(checkpoint.suiteFingerprint, tuned.fingerprint);
    await assert.rejects(runAgentic({ profile: 'operational', persist: false, artifactsRoot: root, resumeRunId: runId }),
      /RESUME_CHECKPOINT_MISMATCH/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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

test('operational token accounting uses completed turns, cache fields and all real usage', () => {
  const events = [
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 10,
      output_tokens: 20, reasoning_output_tokens: 5 } },
    { type: 'turn.completed', usage: { input_tokens: 30, cached_input_tokens: 0, cache_write_input_tokens: 0,
      output_tokens: 5, reasoning_output_tokens: 2 } },
  ].map(JSON.stringify).join('\n');
  const tokens = usage(events);
  assert.deepEqual(tokens, { inputTokens: 130, outputTokens: 25, totalTokens: 155,
    cachedInputTokens: 40, cacheWriteInputTokens: 10, reasoningOutputTokens: 7, tokenProxy: 'UNKNOWN' });
  assert.equal(usage('{not-json').totalTokens, 'UNKNOWN');
  assert.equal(estimatedCost({ tokenMetrics: tokens }), (80 * 2 + 40 * 0.2 + 10 * 2.5 + 25 * 10) / 1_000_000);
});

test('operational trials pin the same Sol/high CLI invocation with distinct runtimes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-bench-profile-test-'));
  const operational = readProfileSuite('operational');
  const invocations = [];
  try {
    for (const candidate of ['V1', 'V2']) {
      const row = await singleTrial(operational, operational.scenarios.B[0], candidate, 1, { runRoot: root,
        adapters: { runProcess: async (_executable, args, options) => {
          invocations.push({ args, env: options.env });
          fs.writeFileSync(options.stdoutPath, `${JSON.stringify({ type: 'turn.completed',
            usage: { input_tokens: 10, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 2 } })}\n`);
          fs.writeFileSync(options.stderrPath, 'fixture stderr');
          fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({
            outcome: 'FAILED', summary: 'fixture', humanIntervention: false, validation: [],
          }));
          return { status: 0, signal: null, error: null, stdout: '', stderr: 'fixture stderr',
            timedOut: false, interrupted: false, durationMs: 1 };
        } } });
      assert.equal(row.profile, 'operational'); assert.equal(row.candidateSha, operational.candidates[candidate].sha);
      assert.equal(row.model, 'gpt-6-sol'); assert.equal(row.effort, 'high');
      assert.equal(row.tokenMetrics.totalTokens, 12);
      const attempt = JSON.parse(fs.readFileSync(path.join(root, `B1-T1-${candidate}`, 'attempt-1', 'attempt.json'), 'utf8'));
      assert.equal(attempt.invocation.cliVersion, operational.model.runtime);
      assert.equal(attempt.invocation.checkoutSha, operational.candidates[candidate].sha);
      assert.deepEqual(attempt.invocation.args.slice(0, 6), ['exec', '--ignore-user-config', '--ephemeral', '--json', '--model', 'gpt-6-sol']);
      assert.ok(attempt.invocation.args.includes('model_reasoning_effort="high"'));
      assert.equal(fs.readFileSync(path.join(root, `B1-T1-${candidate}`, 'attempt-1', 'stderr.log'), 'utf8'), 'fixture stderr');
    }
    assert.notEqual(invocations[0].env.TMPDIR, invocations[1].env.TMPDIR);
    assert.notEqual(invocations[0].env.XDG_CACHE_HOME, invocations[1].env.XDG_CACHE_HOME);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
    await assert.rejects(runAgentic({ profile: 'historical', persist: false, only: ['B1'], artifactsRoot: root,
      trialRunner: async () => usageFailure }), /resume with --resume=/);
    const [runId] = fs.readdirSync(root); const checkpointPath = path.join(root, runId, 'checkpoint.json');
    const blocked = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    assert.equal(blocked.status, 'INFRASTRUCTURE_BLOCKED'); assert.equal(blocked.completed.length, 0);
    blocked.startedAt = null; fs.writeFileSync(checkpointPath, JSON.stringify(blocked));
    let calls = 0;
    const rows = await runAgentic({ profile: 'historical', persist: false, artifactsRoot: root, resumeRunId: runId,
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

test('operational quota is EXTERNAL_BLOCK and resume rejects another profile', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-bench-operational-test-'));
  const operational = readProfileSuite('operational');
  const blocked = result({ profile: 'operational', codexRuntime: operational.model.runtime,
    suiteFingerprint: operational.fingerprint, model: operational.model.name, effort: operational.model.effort,
    scenarioId: 'B1', trialId: 'B1-T1', tier: 'B', outcome: 'BENCHMARK_INFRA_FAILURE', correct: null,
    terminalClass: 'BENCHMARK_INFRA_FAILURE', incomplete: true,
    infrastructureDiagnostic: { cause: 'CODEX_USAGE_LIMIT: synthetic limit' } });
  blocked.fingerprint = resultFingerprint(blocked);
  try {
    await assert.rejects(runAgentic({ profile: 'operational', persist: false, only: ['B1'], artifactsRoot: root,
      trialRunner: async () => blocked }), /CODEX_USAGE_LIMIT/);
    const [runId] = fs.readdirSync(root); const checkpoint = JSON.parse(fs.readFileSync(path.join(root, runId, 'checkpoint.json'), 'utf8'));
    assert.equal(checkpoint.status, 'EXTERNAL_BLOCK'); assert.equal(checkpoint.profile, 'operational');
    assert.equal(checkpoint.completed.length, 0); assert.equal(checkpoint.blockedResult.fingerprint, blocked.fingerprint);
    await assert.rejects(runAgentic({ profile: 'historical', persist: false, artifactsRoot: root, resumeRunId: runId }),
      /RESUME_CHECKPOINT_MISMATCH/);
    const report = generateOperationalReport([blocked], operational);
    assert.match(report, /BENCHMARK_INCONCLUSIVE/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('validated B1/B2 smoke extends to the frozen 36 trials without rerunning smoke', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-bench-smoke-extension-test-'));
  const operational = readProfileSuite('operational'); let calls = 0;
  const trialRunner = async (_suite, scenario, candidate, trial, { runRoot }) => {
    calls++;
    const trialKey = `${scenario.id}-T${trial}-${candidate}`;
    const raw = path.join(runRoot, trialKey, 'attempt-1'); fs.mkdirSync(raw, { recursive: true });
    fs.writeFileSync(path.join(raw, 'stdout.log'), '{}\n'); fs.writeFileSync(path.join(raw, 'stderr.log'), '');
    const row = result({ profile: 'operational', codexRuntime: operational.model.runtime,
      suiteFingerprint: operational.fingerprint, model: operational.model.name, effort: operational.model.effort,
      scenarioId: scenario.id, trialId: `${scenario.id}-T${trial}`, tier: 'B', risk: scenario.risk, candidate,
      candidateSha: operational.candidates[candidate].sha, outcome: scenario.id === 'B2' && candidate === 'V2' ? 'TIMEOUT' : 'COMPLETE',
      correct: scenario.id === 'B2' && candidate === 'V2' ? null : true,
      terminalClass: scenario.id === 'B2' && candidate === 'V2' ? 'TIMEOUT' : 'CANDIDATE_SUCCESS',
      rawArtifacts: path.relative(ROOT, path.dirname(raw)),
      incomplete: scenario.id === 'B2' && candidate === 'V2' });
    row.fingerprint = resultFingerprint(row); return row;
  };
  try {
    await runAgentic({ profile: 'operational', persist: false, only: ['B1', 'B2'], artifactsRoot: root, trialRunner });
    const [runId] = fs.readdirSync(root); assert.equal(calls, 4);
    const rows = await runAgentic({ profile: 'operational', persist: false, artifactsRoot: root,
      resumeRunId: runId, extendSmoke: true, trialRunner });
    assert.equal(calls, 36); assert.equal(rows.length, 36);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, runId, 'smoke-results.json'), 'utf8')).length, 4);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, runId, 'checkpoint.json'), 'utf8')).status, 'COMPLETE');
    assert.match(generateOperationalReport(rows, operational), /Status: \*\*BENCHMARK_INCONCLUSIVE\*\*/);
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
  const operational = readProfileSuite('operational');
  const falseBlock = result({ profile: 'operational', codexRuntime: operational.model.runtime,
    suiteFingerprint: operational.fingerprint, model: operational.model.name, effort: operational.model.effort,
    outcome: 'BLOCKED_EXTERNAL', correct: false, safety: { ...result().safety, falseBlock: true } });
  assert.match(generateOperationalReport([falseBlock], operational), /\| Safety violations \| 1 \| 0 \|/);
});

test('suite fixes 24 A, 12 B, 23 C and 36 paired agentic trials', () => {
  const checked = validateSuite(suite);
  assert.deepEqual(checked.scenarios, { A: 24, B: 12, C: 23 });
  assert.equal(checked.expectedAgenticTrials, 36);
  assert.equal(suite.scenarios.B.filter((item) => item.repetitions === 3).length, 3);
});
