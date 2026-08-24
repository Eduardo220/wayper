import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const EVALS_PATH = path.join(ROOT, 'docs/ai/meta-goal-completion-evals.json');
const SHADOW_ASSESSMENTS = new Set([
  'NO_REGRESSION',
  'OLD_FALSE_POSITIVE',
  'HONEST_STATE_REFINEMENT',
]);
const TERMINAL_RESULTS = new Set([
  'GOAL_BUDGET_EXHAUSTED',
  'GOAL_BLOCKED',
  'GOAL_PARTIALLY_SATISFIED',
  'GOAL_SATISFIED',
]);
export const GOAL_BUDGET_POLICY = Object.freeze({
  softLimitRatio: 0.85,
  checkpoints: Object.freeze([
    'GOAL_START',
    'BEFORE_NEW_SLICE',
    'BEFORE_OPTIONAL_SPECIALIST',
    'BEFORE_EXPENSIVE_VALIDATION',
    'BEFORE_FULL_TEST_SUITE',
    'BEFORE_BUILD',
    'BEFORE_FINAL_FALSIFICATION',
    'AFTER_MAJOR_EXECUTION_PHASE',
    'BEFORE_OPTIONAL_FOLLOWUP',
  ]),
});
const REQUIRED_VALIDATIONS = {
  NO_CHANGE: [],
  DOCS_ONLY: ['MARKDOWN', 'LINKS'],
  PRODUCT_SOURCE: ['FAST', 'SEMANTIC'],
  CORE_PRODUCT_OWNER: ['FAST', 'SEMANTIC', 'TARGETED', 'ADJACENT_OWNER'],
  RUN_TRACKING_CRITICAL: ['FAST', 'SEMANTIC', 'TARGETED', 'CONCURRENCY', 'STATE_TRANSITIONS'],
  NATIVE_ANDROID: ['FAST', 'SEMANTIC', 'NATIVE_CONFIG'],
  HARNESS_INFRASTRUCTURE: [
    'OLD_EVALS',
    'NEW_EVALS',
    'BACKSTOP_TESTS',
    'SEMANTIC',
    'CONTEXT',
    'HOOKS',
    'DIFF',
  ],
};

function merge(base, override) {
  if (Array.isArray(override) || override === null || typeof override !== 'object') {
    return override === undefined ? base : override;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) result[key] = merge(base?.[key], value);
  return result;
}

function hasEvidence(item) {
  return Array.isArray(item.evidence) && item.evidence.length > 0;
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function enforcementMode(requested, effective, propagation, nativeEnforcement, observed) {
  const native = propagation === 'PASS'
    && isNumber(effective)
    && nativeEnforcement === 'SUPPORTED';
  const harness = isNumber(requested) && isNumber(observed);
  if (native && harness) return 'HYBRID';
  if (native) return 'NATIVE';
  if (harness) return 'HARNESS';
  if (isNumber(observed)) return 'OBSERVATIONAL_ONLY';
  return 'UNAVAILABLE';
}

function propagationReadiness(status) {
  if (status === 'PASS') return 'YES';
  if (status === 'UNSUPPORTED') return 'UNSUPPORTED';
  return 'NO';
}

export function evaluateBudgetControl(run) {
  const runtime = run.runtime ?? {};
  const accounting = run.accounting ?? {};
  const requestedTokenBudget = run.requestedTokenBudget ?? 'UNKNOWN';
  const requestedDurationSeconds = run.requestedDurationSeconds ?? 'UNKNOWN';
  const effectiveTokenBudget = runtime.effectiveTokenBudget ?? 'UNKNOWN';
  const effectiveDurationSeconds = runtime.effectiveDurationSeconds ?? 'UNKNOWN';
  const tokenPropagationStatus = runtime.tokenBudgetPropagation ?? 'UNKNOWN';
  const durationPropagationStatus = runtime.durationBudgetPropagation ?? 'UNKNOWN';
  const tokenEnforcementMode = enforcementMode(
    requestedTokenBudget,
    effectiveTokenBudget,
    tokenPropagationStatus,
    runtime.nativeTokenEnforcement,
    accounting.tokensUsed,
  );
  const durationEnforcementMode = enforcementMode(
    requestedDurationSeconds,
    effectiveDurationSeconds,
    durationPropagationStatus,
    runtime.nativeDurationEnforcement,
    accounting.elapsedSeconds,
  );
  const tokenCeiling = ['NATIVE', 'HYBRID'].includes(tokenEnforcementMode)
    ? effectiveTokenBudget
    : tokenEnforcementMode === 'HARNESS' ? requestedTokenBudget : 'UNKNOWN';
  const durationCeiling = ['NATIVE', 'HYBRID'].includes(durationEnforcementMode)
    ? effectiveDurationSeconds
    : durationEnforcementMode === 'HARNESS' ? requestedDurationSeconds : 'UNKNOWN';
  const tokenHard = isNumber(tokenCeiling)
    && isNumber(accounting.tokensUsed)
    && accounting.tokensUsed >= tokenCeiling;
  const durationHard = isNumber(durationCeiling)
    && isNumber(accounting.elapsedSeconds)
    && accounting.elapsedSeconds >= durationCeiling;
  const tokenSoft = isNumber(tokenCeiling)
    && isNumber(accounting.tokensUsed)
    && accounting.tokensUsed >= tokenCeiling * GOAL_BUDGET_POLICY.softLimitRatio;
  const durationSoft = isNumber(durationCeiling)
    && isNumber(accounting.elapsedSeconds)
    && accounting.elapsedSeconds >= durationCeiling * GOAL_BUDGET_POLICY.softLimitRatio;
  const previousGoalResult = run.previousGoalResult;
  const terminalImmutable = TERMINAL_RESULTS.has(previousGoalResult);
  const hardLimitExceeded = tokenHard || durationHard || previousGoalResult === 'GOAL_BUDGET_EXHAUSTED';
  const budgetState = hardLimitExceeded ? 'HARD_LIMIT' : tokenSoft || durationSoft ? 'SOFT_LIMIT' : 'NORMAL';

  let goalResult = 'GOAL_RUNNING';
  let stopReason = 'WORK_REMAINS';
  if (terminalImmutable) {
    goalResult = previousGoalResult;
    stopReason = run.previousStopReason ?? 'TERMINAL_RESULT_IMMUTABLE';
  } else if (tokenHard || durationHard) {
    goalResult = 'GOAL_BUDGET_EXHAUSTED';
    if (tokenHard && durationHard) {
      stopReason = run.firstHardLimit === 'TOKEN'
        ? 'TOKEN_BUDGET_EXCEEDED'
        : run.firstHardLimit === 'DURATION'
          ? 'DURATION_BUDGET_EXCEEDED'
          : 'HARD_LIMIT_ORDER_UNKNOWN';
    } else stopReason = tokenHard ? 'TOKEN_BUDGET_EXCEEDED' : 'DURATION_BUDGET_EXCEEDED';
  } else if (run.completionEligible) {
    goalResult = 'GOAL_SATISFIED';
    stopReason = 'EVIDENCE_GATED_COMPLETION';
  } else if (run.externalBlocker) {
    goalResult = 'GOAL_BLOCKED';
    stopReason = run.externalBlocker;
  }

  const running = goalResult === 'GOAL_RUNNING';
  const allowOptionalWork = running && budgetState === 'NORMAL';
  const allowRequestedWork = running
    && budgetState !== 'HARD_LIMIT'
    && (budgetState === 'NORMAL' || run.workClass !== 'OPTIONAL');
  const tokenAccountingReady = isNumber(accounting.tokensUsed) && Boolean(accounting.tokenSource);
  const durationAccountingReady = isNumber(accounting.elapsedSeconds) && Boolean(accounting.durationSource);
  const tokenBudgetEnforcementReady = ['NATIVE', 'HARNESS', 'HYBRID'].includes(tokenEnforcementMode);
  const durationBudgetEnforcementReady = ['NATIVE', 'HARNESS', 'HYBRID'].includes(durationEnforcementMode);

  return {
    requestedTokenBudget,
    requestedDurationSeconds,
    effectiveTokenBudget,
    effectiveDurationSeconds,
    tokenPropagationStatus,
    durationPropagationStatus,
    tokenEnforcementMode,
    durationEnforcementMode,
    tokenAccountingReady,
    durationAccountingReady,
    tokenBudgetPropagationReady: propagationReadiness(tokenPropagationStatus),
    durationBudgetPropagationReady: propagationReadiness(durationPropagationStatus),
    tokenBudgetEnforcementReady,
    durationBudgetEnforcementReady,
    softBudgetControlReady: tokenBudgetEnforcementReady || durationBudgetEnforcementReady,
    irreversibleBudgetStopReady: true,
    terminalStatePrecedenceReady: true,
    softLimitRatio: GOAL_BUDGET_POLICY.softLimitRatio,
    budgetState,
    softLimitEntered: budgetState === 'SOFT_LIMIT',
    hardLimitExceeded,
    overshoot: tokenHard ? accounting.tokensUsed - tokenCeiling : 0,
    previousTokensUsed: accounting.previousTokensUsed ?? 'UNKNOWN',
    goalResult,
    stopReason,
    allowNewSubstantiveWork: running && budgetState !== 'HARD_LIMIT',
    allowOptionalWork,
    allowRequestedWork,
    repeatConfirmation: hardLimitExceeded ? 0 : null,
    terminalImmutable,
    checkpointRecognized: GOAL_BUDGET_POLICY.checkpoints.includes(run.checkpoint),
    newHookRequired: false,
    cheapPathPreserved: ['NO_CHANGE', 'DOCS_ONLY'].includes(run.scope),
    completionGatePreserved: goalResult !== 'GOAL_SATISFIED' || run.completionEligible === true,
  };
}

export function evaluateCompletion(run) {
  const blockers = [];
  const gaps = [];
  const criteria = run.successCriteria ?? [];

  if (!criteria.length) gaps.push('SUCCESS_CRITERIA_MISSING');
  if (run.originalCriteriaCount !== undefined && run.originalCriteriaCount !== criteria.length) {
    gaps.push('SCOPE_SHRINKING');
  }
  const currentCriterionIds = new Set(criteria.map((item) => item.id));
  if ((run.originalCriteriaIds ?? []).some((id) => !currentCriterionIds.has(id))) {
    gaps.push('SCOPE_SHRINKING');
  }
  for (const criterion of criteria) {
    if (criterion.status === 'SATISFIED' && !hasEvidence(criterion)) {
      gaps.push(`CRITERION_WITHOUT_EVIDENCE:${criterion.id}`);
    } else if (
      criterion.status === 'NOT_APPLICABLE'
      && !(criterion.reason && criterion.scopeEvidence)
    ) {
      gaps.push(`NOT_APPLICABLE_WITHOUT_REASON:${criterion.id}`);
    } else if (!['SATISFIED', 'NOT_APPLICABLE'].includes(criterion.status)) {
      gaps.push(`CRITERION_${criterion.status}:${criterion.id}`);
    }
  }

  for (const uncertainty of run.uncertainties ?? []) {
    if (uncertainty.status !== 'OPEN') continue;
    if (uncertainty.severity === 'BLOCKING') blockers.push(`BLOCKING_UNCERTAINTY:${uncertainty.id}`);
    if (
      uncertainty.severity === 'MATERIAL'
      && !(uncertainty.treatment && uncertainty.impact)
    ) gaps.push(`UNTREATED_MATERIAL_UNCERTAINTY:${uncertainty.id}`);
  }

  const validations = new Map((run.validation ?? []).map((item) => [item.id, item]));
  const scopes = Array.isArray(run.scope) ? run.scope : [run.scope];
  const requiredValidations = new Set();
  for (const scope of scopes) {
    if (!Object.hasOwn(REQUIRED_VALIDATIONS, scope)) gaps.push(`CHANGED_SCOPE_UNKNOWN:${scope}`);
    for (const id of REQUIRED_VALIDATIONS[scope] ?? []) requiredValidations.add(id);
  }
  for (const validation of validations.values()) {
    if (validation.required) requiredValidations.add(validation.id);
  }
  for (const id of requiredValidations) {
    const validation = validations.get(id);
    if (!validation) {
      gaps.push(`VALIDATION_MISSING:${id}`);
      continue;
    }
    if (validation.status === 'BLOCKED') blockers.push(`VALIDATION_BLOCKED:${validation.id}`);
    else if (validation.status !== 'PASS') gaps.push(`VALIDATION_${validation.status}:${validation.id}`);
    else if (!hasEvidence(validation)) gaps.push(`VALIDATION_WITHOUT_EVIDENCE:${validation.id}`);
  }

  for (const claim of run.claims ?? []) {
    if (claim.material && !hasEvidence(claim)) gaps.push(`CLAIM_WITHOUT_EVIDENCE:${claim.id}`);
  }

  if (run.accounting?.tokensUsed === undefined || !run.accounting?.source) {
    gaps.push('TOKEN_ACCOUNTING_MISSING');
  } else if ((run.accounting.tokensUsed === 'UNKNOWN') !== (run.accounting.source === 'UNAVAILABLE')) {
    gaps.push('TOKEN_ACCOUNTING_PROVENANCE_INVALID');
  }
  if (
    run.stop?.deterministic !== true
    || run.stop?.lightweight !== true
    || run.stop?.semanticJudge
    || run.stop?.goalSatisfiedJudge
    || run.stop?.sliceController
    || run.stop?.specialistRouter
  ) {
    gaps.push('STOP_OWNS_SEMANTIC_COMPLETION');
  }

  const falsification = run.falsification ?? {};
  if (!falsification.performed) gaps.push('FALSIFICATION_NOT_RUN');
  else if (falsification.result !== 'PASS') gaps.push('FALSIFICATION_FAILED');
  if ((falsification.findings ?? []).some(
    (finding) => finding.material || ['BLOCKING', 'MATERIAL'].includes(finding.severity)
  )) {
    gaps.push('MATERIAL_FALSIFICATION_FINDING');
  }

  const eligible = blockers.length === 0 && gaps.length === 0;
  let result = 'GOAL_RUNNING';
  let stopReason = 'WORK_REMAINS';
  if (eligible) {
    result = 'GOAL_SATISFIED';
    stopReason = 'EVIDENCE_GATED_COMPLETION';
  } else if (run.budget?.exhausted) {
    result = 'GOAL_BUDGET_EXHAUSTED';
    stopReason = 'BUDGET_EXHAUSTED_BEFORE_PROOF';
  } else if (blockers.length) {
    result = 'GOAL_BLOCKED';
    stopReason = blockers[0];
  } else if (!gaps.some((gap) => gap.startsWith('FALSIFICATION_')) && run.workExecuted) {
    result = 'GOAL_PARTIALLY_SATISFIED';
    stopReason = gaps[0] ?? 'PROOF_INCOMPLETE';
  } else if (gaps.includes('FALSIFICATION_FAILED')) {
    stopReason = 'CONTINUE_AFTER_FALSIFICATION';
  }

  return {
    eligible,
    result,
    stopReason,
    earlyCompletion: eligible && Boolean(run.budget?.remaining),
    blockers,
    gaps,
  };
}

export function loadEvalSuite(file = EVALS_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function runEvalSuite(suite = loadEvalSuite()) {
  assert.equal(suite.version, 2, 'unsupported Meta Goal eval schema');
  assert.ok(
    suite.baseRun && suite.baseBudgetRun && Array.isArray(suite.cases) && Array.isArray(suite.budgetCases),
    'missing Meta Goal eval inputs',
  );
  const ids = new Set();
  const results = [];
  for (const item of suite.cases) {
    assert.ok(item.id && !ids.has(item.id), `duplicate or missing eval id: ${item.id}`);
    ids.add(item.id);
    const run = merge(suite.baseRun, item.override ?? {});
    const actual = evaluateCompletion(run);
    assert.equal(actual.result, item.expected.result, `${item.id} result`);
    assert.equal(actual.eligible, item.expected.eligible, `${item.id} eligibility`);
    assert.equal(actual.earlyCompletion, item.expected.earlyCompletion, `${item.id} early completion`);
    if (item.kind === 'SHADOW') {
      assert.ok(item.oldResult && SHADOW_ASSESSMENTS.has(item.expectedAssessment), `${item.id} shadow metadata`);
      if (item.expectedAssessment === 'NO_REGRESSION') {
        assert.equal(actual.result, item.oldResult, `${item.id} unexpected regression`);
      } else if (item.expectedAssessment === 'OLD_FALSE_POSITIVE') {
        assert.equal(item.oldResult, 'GOAL_SATISFIED', `${item.id} invalid old false positive`);
        assert.notEqual(actual.result, 'GOAL_SATISFIED', `${item.id} false positive preserved`);
      } else {
        assert.notEqual(actual.result, item.oldResult, `${item.id} expected state refinement missing`);
      }
    }
    results.push({
      id: item.id,
      kind: item.kind,
      oldResult: item.oldResult,
      assessment: item.expectedAssessment,
      ...actual,
    });
  }
  for (const item of suite.budgetCases) {
    assert.ok(item.id && !ids.has(item.id), `duplicate or missing eval id: ${item.id}`);
    ids.add(item.id);
    const run = merge(suite.baseBudgetRun, item.override ?? {});
    const actual = evaluateBudgetControl(run);
    for (const [key, value] of Object.entries(item.expected)) {
      assert.deepEqual(actual[key], value, `${item.id} ${key}`);
    }
    results.push({ id: item.id, kind: 'BUDGET', ...actual });
  }
  return results;
}

export function formatResult(results, json = false) {
  const completion = results.filter((item) => item.kind === 'COMPLETION').length;
  const shadow = results.filter((item) => item.kind === 'SHADOW');
  const budget = results.filter((item) => item.kind === 'BUDGET').length;
  const differences = shadow.filter((item) => item.oldResult !== item.result).length;
  const unexpectedFalsePositives = shadow.filter(
    (item) => item.assessment === 'NO_REGRESSION'
      && item.oldResult !== 'GOAL_SATISFIED'
      && item.result === 'GOAL_SATISFIED'
  ).length;
  const unexpectedFalseNegatives = shadow.filter(
    (item) => item.assessment === 'NO_REGRESSION'
      && item.oldResult === 'GOAL_SATISFIED'
      && item.result !== 'GOAL_SATISFIED'
  ).length;
  const report = {
    status: 'PASS',
    evals: results.length,
    completion,
    shadow: shadow.length,
    budget,
    shadowDifferences: differences,
    unexpectedFalsePositives,
    unexpectedFalseNegatives,
  };
  if (json) return JSON.stringify(report);
  return [
    'META GOAL COMPLETION PASS',
    `${completion}/${completion} completion / ${shadow.length}/${shadow.length} shadow / ${budget}/${budget} budget evals`,
    `shadow differences ${differences} / unexpected false positives ${unexpectedFalsePositives} / false negatives ${unexpectedFalseNegatives}`,
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--json')) throw new Error('Usage: npm run quality:meta-goal -- [--json]');
  console.log(formatResult(runEvalSuite(), args.includes('--json')));
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) main();
