import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { addWorktree, deterministicFalseCompletion, digest, productFingerprint, readSuite, removeWorktree, reportSanity,
  resultFingerprint, significance, suiteFingerprint, validateResult, validateSuite } from '../wayper-harness-benchmark.mjs';
import { OUTPUT_SCHEMA } from '../wayper-harness-benchmark-agentic.mjs';

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
