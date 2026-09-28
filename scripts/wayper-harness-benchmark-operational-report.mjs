import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { BENCHMARK_ROOT, readProfileSuite, RESULTS_ROOT, validateResult, validateSuite } from './wayper-harness-benchmark.mjs';

const UNKNOWN = 'UNKNOWN';
const resultsPath = path.join(RESULTS_ROOT, 'operational', 'tier-b.json');
const reportPath = path.join(BENCHMARK_ROOT, 'operational-report.md');
const number = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : UNKNOWN;
const money = (value) => Number.isFinite(value) ? `$${value.toFixed(4)}` : UNKNOWN;
const ratio = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b > 0 ? `${(a / b).toFixed(2)}x` : UNKNOWN;
const median = (values) => {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return UNKNOWN;
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const total = (values) => values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : UNKNOWN;
const table = (headers, rows) => [
  `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.map((value) => String(value).replaceAll('|', '\\|')).join(' | ')} |`),
].join('\n');

// API-equivalent short-context estimate, not subscription billing or provider-observed cost.
export function estimatedCost(row) {
  const { inputTokens: input, cachedInputTokens: cached, cacheWriteInputTokens: written,
    outputTokens: output } = row.tokenMetrics;
  if (![input, cached, written, output].every(Number.isFinite) || input < cached + written) return UNKNOWN;
  return ((input - cached - written) * 2 + cached * 0.2 + written * 2.5 + output * 10) / 1_000_000;
}

function stats(rows, candidate) {
  const values = rows.filter((row) => row.candidate === candidate);
  const terminal = values.filter((row) => row.correct !== null);
  const correct = terminal.filter((row) => row.correct);
  const measuredTokens = values.map((row) => row.tokenMetrics.totalTokens).filter(Number.isFinite);
  const measuredCosts = values.map(estimatedCost).filter(Number.isFinite);
  return { trials: values.length, terminal: terminal.length, correct: correct.length,
    falseCompletion: values.filter((row) => row.safety.falseCompletion).length,
    falseBlock: values.filter((row) => row.safety.falseBlock).length,
    safety: values.filter((row) => Object.values(row.safety).some(Boolean)).length,
    autonomous: correct.filter((row) => row.humanInterventions === 0).length,
    necessaryHuman: total(values.map((row) => row.necessaryHumanInterventions)),
    unnecessaryHuman: total(values.map((row) => row.unnecessaryClarifications)),
    medianTokens: median(values.map((row) => row.tokenMetrics.totalTokens)),
    totalTokens: total(values.map((row) => row.tokenMetrics.totalTokens)),
    observedTokens: total(measuredTokens), tokenCoverage: `${measuredTokens.length}/${values.length}`,
    cachedTokens: total(values.map((row) => row.tokenMetrics.cachedInputTokens)),
    medianWallMs: median(values.map((row) => row.timeMetrics.wallClockDurationMs)),
    totalWallMs: total(values.map((row) => row.timeMetrics.wallClockDurationMs)),
    infraRetries: total(values.map((row) => row.infrastructureRetries)),
    harnessAttempts: median(values.map((row) => row.attempts)),
    cost: total(values.map(estimatedCost)), observedCost: total(measuredCosts),
    costCoverage: `${measuredCosts.length}/${values.length}`,
    infraFailures: values.filter((row) => row.outcome === 'BENCHMARK_INFRA_FAILURE').length,
    timeouts: values.filter((row) => row.outcome === 'TIMEOUT').length };
}

export function generateOperationalReport(rows, suite = readProfileSuite('operational', rows[0]?.codexRuntime ?? null)) {
  validateSuite(suite);
  rows.forEach((row) => validateResult(row, suite));
  const expectedKeys = new Set(suite.scenarios.B.flatMap((item) => Array.from({ length: item.repetitions }, (_, index) =>
    ['V1', 'V2'].map((candidate) => `${item.id}-T${index + 1}-${candidate}`)).flat()));
  const observedKeys = new Set(rows.map((row) => `${row.trialId}-${row.candidate}`));
  const expected = expectedKeys.size;
  const complete = rows.length === expected && rows.every((row) => !row.incomplete && row.correct !== null) &&
    observedKeys.size === expected && [...expectedKeys].every((key) => observedKeys.has(key));
  const byCandidate = Object.fromEntries(['V1', 'V2'].map((candidate) => [candidate, stats(rows, candidate)]));
  const paired = new Map();
  for (const row of rows) {
    const key = row.trialId; paired.set(key, { ...(paired.get(key) ?? {}), [row.candidate]: row });
  }
  const regressions = [...paired].filter(([, pair]) => pair.V1?.correct === true && pair.V2?.correct === false)
    .map(([trialId, pair]) => `${trialId}: V1 ${pair.V1.outcome}, V2 ${pair.V2.outcome}`);
  const sharedFailures = [...paired].filter(([, pair]) => pair.V1?.correct === false && pair.V2?.correct === false)
    .map(([trialId, pair]) => `${trialId}: both incorrect (V1 ${pair.V1.outcome}, V2 ${pair.V2.outcome})`);
  const unresolvedV2 = [...paired].flatMap(([trialId, pair]) => {
    if (!pair.V2) return [];
    const issues = [];
    if (pair.V1?.correct === true && pair.V2.outcome === 'TIMEOUT') issues.push('V2 TIMEOUT while V1 was correct; V2 correctness UNKNOWN');
    if (pair.V2.safety.falseBlock) issues.push('V2 false block');
    if (pair.V2.safety.falseCompletion) issues.push(pair.V1?.safety.falseCompletion
      ? 'false completion in both candidates' : 'V2 false completion');
    return issues.map((issue) => `${trialId}: ${issue}`);
  });
  const metrics = [
    ['Trials', 'trials'], ['Terminal scored', 'terminal'], ['Correct Goals', 'correct'],
    ['False completion', 'falseCompletion'], ['False blocks', 'falseBlock'], ['Safety violations', 'safety'],
    ['Correct without human help', 'autonomous'], ['Necessary human intervention', 'necessaryHuman'],
    ['Unnecessary human intervention', 'unnecessaryHuman'], ['Observed tokens, all attempts', 'totalTokens'],
    ['Measured token subtotal', 'observedTokens'], ['Token telemetry coverage', 'tokenCoverage'],
    ['Cached input tokens', 'cachedTokens'], ['Median tokens/trial', 'medianTokens'],
    ['Observed Codex wall ms, all attempts', 'totalWallMs'], ['Median wall ms/trial', 'medianWallMs'],
    ['Infrastructure retries', 'infraRetries'], ['Median Harness attempts', 'harnessAttempts'],
    ['API-equivalent estimated cost', 'cost'], ['API-equivalent cost/correct Goal', 'costPerCorrect'],
    ['Measured API-cost subtotal (lower bound)', 'observedCost'], ['Cost telemetry coverage', 'costCoverage'],
    ['Measured cost lower bound/correct Goal', 'observedCostPerCorrect'],
    ['BENCHMARK_INFRA_FAILURE', 'infraFailures'], ['TIMEOUT', 'timeouts'],
  ];
  for (const value of Object.values(byCandidate)) {
    value.costPerCorrect = value.correct && Number.isFinite(value.cost) ? value.cost / value.correct : UNKNOWN;
    value.observedCostPerCorrect = value.correct && Number.isFinite(value.observedCost)
      ? value.observedCost / value.correct : UNKNOWN;
  }
  const formatted = (key, value) => ['cost', 'costPerCorrect', 'observedCost', 'observedCostPerCorrect'].includes(key) ? money(value)
    : ['tokenCoverage', 'costCoverage'].includes(key) ? value : number(value);
  const riskRows = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((risk) => {
    const subset = rows.filter((row) => row.risk === risk);
    const v1 = stats(subset, 'V1'); const v2 = stats(subset, 'V2');
    return [risk, `${v1.correct}/${v1.terminal}`, `${v2.correct}/${v2.terminal}`,
      ratio(v2.medianTokens, v1.medianTokens), ratio(v2.medianWallMs, v1.medianWallMs),
      money(v1.correct && Number.isFinite(v1.cost) ? v1.cost / v1.correct : UNKNOWN),
      money(v2.correct && Number.isFinite(v2.cost) ? v2.cost / v2.correct : UNKNOWN)];
  });
  const lowRows = rows.filter((row) => row.risk === 'LOW');
  const lowV1 = stats(lowRows, 'V1'); const lowV2 = stats(lowRows, 'V2');
  const lines = [
    '# Harness V1 × V2 — operational / Sol / high', '',
    `- Status: **${complete ? 'COMPLETE' : 'BENCHMARK_INCONCLUSIVE'}** (${rows.length}/${expected} trials).`,
    `- Corpus coverage: ${rows.length}/${expected} terminal records; correctness UNKNOWN for ${rows.filter((row) => row.correct === null).length} trials.`,
    `- Profile: \`operational\`; fingerprint: \`${suite.fingerprint}\`; frozen source: \`${suite.historicalSuiteFingerprint}\`.`,
    `- V1: \`${suite.candidates.V1.sha}\`; V2: \`${suite.candidates.V2.sha}\`.`,
    `- Both: \`${suite.model.name}\` / \`${suite.model.effort}\` / \`${suite.model.runtime}\`.`,
    '- Corpus, GroundTruth, scoring and failure taxonomy are inherited byte-for-byte from the frozen suite; historical Astra/xhigh results are separate.',
    '- Raw stdout/stderr, command arguments, diagnostics and checkpoints: `.wayper-context/benchmark-runs/operational/` (local, not versioned).', '',
    '## Scoreboard', '', table(['Metric', 'V1', 'V2'], metrics.map(([label, key]) =>
      [label, formatted(key, byCandidate.V1[key]), formatted(key, byCandidate.V2[key])])), '',
    '## Risk proportionality', '', table(['Risk', 'V1 correct', 'V2 correct', 'V2/V1 tokens', 'V2/V1 wall time',
      'V1 cost/correct', 'V2 cost/correct'], riskRows), '',
    '## Future Proportionality Tuning input', '',
    `- LOW B1 (one pair): V2/V1 ${ratio(lowV2.medianTokens, lowV1.medianTokens)} tokens, ${ratio(
      lowV2.medianWallMs, lowV1.medianWallMs)} wall time and ${ratio(lowV2.cost / lowV2.correct,
      lowV1.cost / lowV1.correct)} estimated cost per correct Goal. This is an observed overhead signal, not a risk-class estimate.`,
    '- MEDIUM B2 timed out for V2 and B8 was a V2 false block; a complete token/cost ratio is UNKNOWN.',
    '- No proportionality tuning was applied.', '',
    '## Paired trials', '', table(['Trial', 'Risk', 'V1 outcome/correct', 'V2 outcome/correct'],
      [...paired].map(([trialId, pair]) => [trialId, pair.V1?.risk ?? pair.V2?.risk ?? UNKNOWN,
        pair.V1 ? `${pair.V1.outcome}/${pair.V1.correct}` : UNKNOWN,
        pair.V2 ? `${pair.V2.outcome}/${pair.V2.correct}` : UNKNOWN])), '',
    '## V2 regressions observed', '', ...(regressions.length ? regressions.map((item) => `- ${item}`) : ['- None in terminal paired trials.']), '',
    '## Shared failures', '', ...(sharedFailures.length ? sharedFailures.map((item) => `- ${item}`) : ['- None observed.']), '',
    '## V2 observed issues', '',
    ...(unresolvedV2.length ? unresolvedV2.map((item) => `- ${item}`) : ['- None observed.']), '',
    '## Interpretation limits', '',
    '- Descriptive comparison only: repetitions vary by scenario; every LOW/MEDIUM scenario has one paired trial, so ratios are not significance claims.',
    '- Harness context reuse and internal attempts remain UNKNOWN unless the candidate emits observable counters. Cached input tokens measure provider prompt caching, not Harness Working Context reuse.',
    '- A token subtotal with incomplete telemetry is a lower bound, not a total. External-work damage and host-global safety cannot be proven absent by this sandboxed corpus.',
    '- Cost uses published gpt-6-sol standard short-context API rates ($2/M uncached input, $0.20/M cached input, $2.50/M cache write, $10/M output). It is an API-equivalent estimate, not Codex subscription billing; long-context pricing and unobserved incomplete attempts can change actual cost.',
    '- CLI JSONL does not attest the provider-side model/effort; per-attempt invocation records prove explicit CLI flags and captured version, while successful execution proves CLI acceptance.',
    '- The four initial smoke attempts targeted exact candidate SHAs via git worktree add; direct HEAD receipts were added afterward and cover 33 subsequent attempts, including the quota retry.',
    '- Quota pauses the run as EXTERNAL_BLOCK; blocked attempts and raw logs remain in the checkpoint, never scored as candidate failures.',
    '- The observed LOW overhead signal above is input for later Proportionality Tuning; no tuning or candidate changes were made.', '',
    'Pricing: [OpenAI GPT-6 Sol model](https://developers.openai.com/api/docs/models/gpt-6-sol).',
  ];
  return `${lines.join('\n')}\n`;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const rows = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  fs.writeFileSync(reportPath, generateOperationalReport(rows));
  console.log(`OPERATIONAL BENCHMARK REPORT ${reportPath}`);
}
