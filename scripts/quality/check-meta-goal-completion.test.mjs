import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateBudgetControl,
  evaluateCompletion,
  GOAL_BUDGET_POLICY,
  loadEvalSuite,
  runEvalSuite,
} from './check-meta-goal-completion.mjs';

test('MGC1 all completion and shadow evals pass', () => {
  const results = runEvalSuite();
  assert.equal(results.length, 52);
  assert.equal(results.filter((item) => item.kind === 'COMPLETION').length, 20);
  assert.equal(results.filter((item) => item.kind === 'SHADOW').length, 12);
  assert.equal(results.filter((item) => item.kind === 'BUDGET').length, 20);
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

test('MGC7 changed scope derives mandatory validation', () => {
  const { baseRun } = loadEvalSuite();
  const result = evaluateCompletion({
    ...baseRun,
    scope: 'RUN_TRACKING_CRITICAL',
    validation: baseRun.validation,
  });
  assert.equal(result.eligible, false);
  assert.match(result.gaps.join('\n'), /VALIDATION_MISSING:CONCURRENCY/);
  assert.match(result.gaps.join('\n'), /VALIDATION_MISSING:STATE_TRANSITIONS/);
});

test('MGC8 hard budget is immediate and immutable', () => {
  const result = runEvalSuite().find((item) => item.id === 'BUD08');
  assert.equal(result.goalResult, 'GOAL_BUDGET_EXHAUSTED');
  assert.equal(result.repeatConfirmation, 0);
  assert.equal(result.allowNewSubstantiveWork, false);
  assert.equal(result.nativeGoalStatus, 'blocked');
  assert.equal(result.nativeBlockedIsApiAdaptation, true);
  assert.equal(result.nativeLifecycleTerminationAction, 'BLOCK_ONCE');
  assert.equal(result.goalResumeAllowed, false);
});

test('MGC9 one central soft-limit policy preserves mandatory work', () => {
  assert.equal(GOAL_BUDGET_POLICY.softLimitRatio, 0.85);
  const results = runEvalSuite();
  assert.equal(results.find((item) => item.id === 'BUD04').allowRequestedWork, false);
  assert.equal(results.find((item) => item.id === 'BUD11').allowRequestedWork, true);
});

test('MGC10 every semantic checkpoint is recognized without a hook', () => {
  const { baseBudgetRun } = loadEvalSuite();
  for (const checkpoint of GOAL_BUDGET_POLICY.checkpoints) {
    const result = evaluateBudgetControl({ ...baseBudgetRun, checkpoint });
    assert.equal(result.checkpointRecognized, true);
    assert.equal(result.newHookRequired, false);
  }
});

test('MGC11 post-terminal usage stays separate from substantive work', () => {
  const result = runEvalSuite().find((item) => item.id === 'BUD13');
  assert.equal(result.postTerminalTokenDelta, 30);
  assert.equal(result.postTerminalTokenAccountingReady, true);
  assert.equal(result.substantivePostTerminalWork, false);
  assert.equal(result.endToEndTokenBudgetEnforcementReady, false);
});
