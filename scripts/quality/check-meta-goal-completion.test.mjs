import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateCompletion,
  loadEvalSuite,
  runEvalSuite,
} from './check-meta-goal-completion.mjs';

test('MGC1 all completion and shadow evals pass', () => {
  const results = runEvalSuite();
  assert.equal(results.length, 32);
  assert.equal(results.filter((item) => item.kind === 'COMPLETION').length, 20);
  assert.equal(results.filter((item) => item.kind === 'SHADOW').length, 12);
});

test('MGC2 FAST pass cannot hide a mandatory targeted test not run', () => {
  const result = runEvalSuite().find((item) => item.id === 'EGC02');
  assert.equal(result.eligible, false);
  assert.match(result.gaps.join('\n'), /VALIDATION_NOT_RUN:TARGETED/);
});

test('MGC3 treated material uncertainty remains explicit without blocking', () => {
  const { baseRun } = loadEvalSuite();
  const result = evaluateCompletion({
    ...baseRun,
    uncertainties: [{
      id: 'U1',
      severity: 'MATERIAL',
      status: 'OPEN',
      treatment: 'documented mitigation',
      impact: 'no material completion gap',
    }],
  });
  assert.equal(result.result, 'GOAL_SATISFIED');
});

test('MGC4 falsification failure continues execution', () => {
  const result = runEvalSuite().find((item) => item.id === 'EGC07');
  assert.equal(result.result, 'GOAL_RUNNING');
  assert.equal(result.stopReason, 'CONTINUE_AFTER_FALSIFICATION');
});

test('MGC5 Stop cannot own semantic completion', () => {
  const { baseRun } = loadEvalSuite();
  const result = evaluateCompletion({
    ...baseRun,
    stop: { ...baseRun.stop, semanticJudge: true },
  });
  assert.equal(result.eligible, false);
  assert.match(result.gaps.join('\n'), /STOP_OWNS_SEMANTIC_COMPLETION/);
});

test('MGC6 shadow produces no unexpected false negative', () => {
  const results = runEvalSuite().filter((item) => item.kind === 'SHADOW');
  assert.equal(results.filter((item) => item.oldResult === 'GOAL_SATISFIED' && item.result === 'GOAL_BLOCKED').length, 0);
});
