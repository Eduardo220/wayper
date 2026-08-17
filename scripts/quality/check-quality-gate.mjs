import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const BASELINE_PATH = path.join(ROOT, 'scripts/quality/lint-baseline.json');

function validateBaseline(baseline) {
  if (
    baseline?.version !== 1 ||
    !Array.isArray(baseline.bugSignalRules) ||
    typeof baseline.bugSignalsByFileRuleMessage !== 'object' ||
    Object.values(baseline.bugSignalsByFileRuleMessage).some(
      (count) => !Number.isInteger(count) || count <= 0
    ) ||
    typeof baseline.warningsByFileRule !== 'object' ||
    Object.values(baseline.warningsByFileRule).some(
      (count) => !Number.isInteger(count) || count <= 0
    )
  ) {
    throw new Error('Unsupported lint baseline schema');
  }
}

function relativeFile(filePath, root = ROOT) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function warningKey(file, ruleId) {
  return `${file}|${ruleId ?? '<directive>'}`;
}

function bugSignalKey(item) {
  return `${item.file}|${item.ruleId}|${item.message}`;
}

function deltaEntries(current, baseline) {
  const keys = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  return [...keys]
    .map((key) => ({
      key,
      baseline: baseline[key] ?? 0,
      current: current[key] ?? 0,
      delta: (current[key] ?? 0) - (baseline[key] ?? 0),
    }))
    .filter((entry) => entry.delta !== 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function isTouched(file, line, touchedRanges) {
  return (touchedRanges[file] ?? []).some(([start, end]) => line >= start && line <= end);
}

export function parseUnifiedDiff(diff) {
  const ranges = {};
  let file;
  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ (?!\/dev\/null$)(?:b\/)?(.+)$/);
    if (fileMatch) {
      file = fileMatch[1];
      ranges[file] ??= [];
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!file || !hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count > 0) ranges[file].push([start, start + count - 1]);
  }
  return ranges;
}

export function analyzeLintJson(rawJson, baseline, touchedRanges = {}, root = ROOT) {
  validateBaseline(baseline);
  const report = JSON.parse(rawJson);
  if (!Array.isArray(report)) throw new Error('ESLint JSON must be an array');

  const errors = [];
  const warnings = [];
  const warningCounts = {};
  for (const result of report) {
    if (!Array.isArray(result?.messages) || typeof result.filePath !== 'string') {
      throw new Error('Malformed ESLint JSON result');
    }
    const file = relativeFile(result.filePath, root);
    for (const message of result.messages) {
      const item = {
        file,
        line: message.line ?? 0,
        column: message.column ?? 0,
        ruleId: message.ruleId,
        message: message.message,
      };
      if (message.severity === 2 || message.fatal) errors.push(item);
      if (message.severity !== 1) continue;
      warnings.push(item);
      const key = warningKey(file, message.ruleId);
      warningCounts[key] = (warningCounts[key] ?? 0) + 1;
    }
  }

  const deltas = deltaEntries(warningCounts, baseline.warningsByFileRule);
  const bugRules = new Set(baseline.bugSignalRules);
  const newWarnings = deltas.filter((entry) => entry.delta > 0);
  const resolvedWarnings = deltas.filter((entry) => entry.delta < 0);
  const currentBugSignals = warnings.filter((warning) => bugRules.has(warning.ruleId));
  const currentBugSignalCounts = {};
  for (const signal of currentBugSignals) {
    const key = bugSignalKey(signal);
    currentBugSignalCounts[key] = (currentBugSignalCounts[key] ?? 0) + 1;
  }
  const bugSignalDeltas = deltaEntries(
    currentBugSignalCounts,
    baseline.bugSignalsByFileRuleMessage
  );
  const newBugSignals = bugSignalDeltas.filter((entry) => entry.delta > 0);
  const resolvedBugSignals = bugSignalDeltas.filter((entry) => entry.delta < 0);
  const touchedBugSignals = warnings.filter(
    (warning) => bugRules.has(warning.ruleId) && isTouched(warning.file, warning.line, touchedRanges)
  );

  return {
    errors,
    baselineWarnings: Object.values(baseline.warningsByFileRule).reduce(
      (total, count) => total + count,
      0
    ),
    currentWarnings: warnings.length,
    newWarnings,
    resolvedWarnings,
    newWarningCount: newWarnings.reduce((total, entry) => total + entry.delta, 0),
    resolvedWarningCount: resolvedWarnings.reduce(
      (total, entry) => total - entry.delta,
      0
    ),
    newBugSignals,
    newBugSignalCount: newBugSignals.reduce((total, entry) => total + entry.delta, 0),
    resolvedBugSignalCount: resolvedBugSignals.reduce(
      (total, entry) => total - entry.delta,
      0
    ),
    touchedBugSignals,
  };
}

export function classifyCommand(result) {
  if (result.error || result.signal || result.status === null) {
    return { status: 'tool_failure', detail: result.error?.message ?? result.signal ?? 'no exit status' };
  }
  const status = result.status === 0 ? 'pass' : 'fail';
  return {
    status,
    detail: status === 'pass' ? '' : [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
  };
}

export function synthesizeQuality({ lint, size, architecture, diff }) {
  const checks = { size, architecture, diff };
  const blocking = [];
  const toolFailures = [];

  if (lint.errors.length) blocking.push('NEW_LINT_ERRORS');
  if (lint.newBugSignalCount) blocking.push('NEW_BUG_SIGNALS');
  for (const [name, result] of Object.entries(checks)) {
    if (result.status === 'fail') blocking.push(`${name.toUpperCase()}_REGRESSION`);
    if (result.status === 'tool_failure') toolFailures.push(name);
  }

  let status = 'PASS';
  if (blocking.length) status = 'FAIL';
  else if (toolFailures.length || lint.touchedBugSignals.length) status = 'INCONCLUSIVE';
  else if (lint.newWarningCount > lint.newBugSignalCount) status = 'PASS_WITH_DEBT';

  return { status, lint, checks, blocking, toolFailures };
}

function compactLine(result) {
  return [
    `lint: ${result.lint.errors.length} errors`,
    `${result.lint.baselineWarnings} -> ${result.lint.currentWarnings} warnings`,
    `${result.lint.newBugSignalCount} new bug signals`,
    `${Math.max(0, result.lint.newWarningCount - result.lint.newBugSignalCount)} other new`,
    `${result.lint.resolvedWarningCount} resolved`,
  ].join(' / ');
}

export function formatQuality(result, { details = false, json = false } = {}) {
  if (json) return JSON.stringify(result);
  const lines = [
    `QUALITY GATE ${result.status}`,
    compactLine(result),
    `size: ${result.checks.size.status === 'pass' ? '0 regressions' : result.checks.size.status}`,
    `architecture: ${result.checks.architecture.status === 'pass' ? '0 regressions' : result.checks.architecture.status}`,
    `diff: ${result.checks.diff.status === 'pass' ? 'clean' : result.checks.diff.status}`,
  ];
  if (!details) return lines.join('\n');

  for (const item of result.lint.errors) {
    lines.push(`ERROR ${item.file}:${item.line}:${item.column} ${item.ruleId ?? ''} ${item.message}`);
  }
  for (const item of result.lint.newWarnings) lines.push(`NEW ${item.key} +${item.delta}`);
  for (const item of result.lint.resolvedWarnings) lines.push(`RESOLVED ${item.key} ${item.delta}`);
  for (const item of result.lint.touchedBugSignals) {
    lines.push(`TOUCHED_BUG_SIGNAL ${item.file}:${item.line} ${item.ruleId}`);
  }
  for (const [name, check] of Object.entries(result.checks)) {
    if (check.status !== 'pass' && check.detail) lines.push(`${name.toUpperCase()} ${check.detail}`);
  }
  return lines.join('\n');
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ error, status: null, signal: null, stdout, stderr }));
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

async function executeQualityGate() {
  const eslintCli = path.join(ROOT, 'node_modules/eslint/bin/eslint.js');
  const [lintRun, sizeRun, architectureRun, diffCheckRun, diffRun] = await Promise.all([
    run(process.execPath, [eslintCli, '.', '--format', 'json']),
    run(process.execPath, [path.join(ROOT, 'scripts/quality/check-code-size.mjs')]),
    run(process.execPath, [path.join(ROOT, 'scripts/quality/check-architecture.mjs')]),
    run('git', ['diff', '--check', 'HEAD', '--']),
    run('git', ['diff', '--no-ext-diff', '--no-renames', '--unified=0', 'HEAD', '--']),
  ]);
  if (lintRun.error || lintRun.signal || ![0, 1].includes(lintRun.status)) {
    throw new Error(`ESLint tool failure: ${lintRun.error?.message ?? lintRun.signal ?? lintRun.status}`);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const lint = analyzeLintJson(lintRun.stdout, baseline, parseUnifiedDiff(diffRun.stdout));
  const diff = classifyCommand(diffCheckRun);
  if (diffRun.error || diffRun.signal || diffRun.status !== 0) {
    diff.status = 'tool_failure';
    diff.detail = diffRun.error?.message ?? diffRun.signal ?? diffRun.stderr;
  }
  return synthesizeQuality({
    lint,
    size: classifyCommand(sizeRun),
    architecture: classifyCommand(architectureRun),
    diff,
  });
}

function parseArgs(args) {
  if (args.some((arg) => !['--details', '--json'].includes(arg))) {
    throw new Error('Usage: npm run quality:gate -- [--details|--json]');
  }
  return { details: args.includes('--details'), json: args.includes('--json') };
}

async function main() {
  let options = {};
  try {
    options = parseArgs(process.argv.slice(2));
    const result = await executeQualityGate();
    console.log(formatQuality(result, options));
    process.exitCode = result.status === 'FAIL' ? 1 : result.status === 'INCONCLUSIVE' ? 2 : 0;
  } catch (error) {
    const failure = { status: 'INCONCLUSIVE', type: 'TOOL_FAILURE', message: error.message };
    console.log(options.json ? JSON.stringify(failure) : `QUALITY GATE INCONCLUSIVE\nTOOL_FAILURE: ${error.message}`);
    process.exitCode = 2;
  }
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) await main();
