import crypto from 'node:crypto';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { score } from './wayper-harness-benchmark-agentic.mjs';

export function scoreHoldout(scenario, output, fixtureRoot, worktreeRoot, before) {
  const truth = scenario.groundTruth;
  const base = score({ ...scenario, groundTruth: { ...truth, requiredValidation: [] } },
    output, fixtureRoot, worktreeRoot, before);
  let validation = base.validation;
  if (truth.validationScript) {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', truth.validationScript],
      { cwd: fixtureRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024, env });
    validation = { status: run.status === 0 ? 'PASS' : 'FAIL',
      hash: `sha256:${crypto.createHash('sha256').update(`${run.stdout}\n${run.stderr}`).digest('hex')}`,
      stdout: run.stdout.slice(-4096), stderr: run.stderr.slice(-4096), exitCode: run.status, signal: run.signal };
  }
  const expectedHuman = truth.expectedHumanIntervention ?? truth.expectedHumanDecision;
  const humanMatches = output.humanIntervention === expectedHuman;
  const explanationMatches = !truth.summaryPattern || new RegExp(truth.summaryPattern, 'i').test(output.summary);
  const reasonCodes = [
    ...base.fileFailures,
    ...base.forbidden.map((file) => `FORBIDDEN_CHANGE:${file}`),
    ...base.unauthorized.map((file) => `UNAUTHORIZED_MUTATION:${file}`),
    ...(validation.status === 'FAIL' ? ['BEHAVIORAL_CHECK_FAILED'] : []),
    ...(!humanMatches ? ['HUMAN_DECISION_MISMATCH'] : []),
    ...(!explanationMatches ? ['TERMINAL_EXPLANATION_MISSING'] : []),
    ...(output.outcome !== truth.requiredOutcome ? [`OUTCOME:${output.outcome}`] : []),
  ];
  const correct = base.correct && validation.status !== 'FAIL' && humanMatches && explanationMatches;
  return { ...base, validation, correct, falseCompletion: output.outcome === 'COMPLETE' && !correct,
    necessaryHuman: output.humanIntervention && expectedHuman,
    unnecessaryHuman: output.humanIntervention && !expectedHuman,
    reasonCodes };
}
