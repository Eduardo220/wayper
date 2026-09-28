import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const BASELINE_PATH = path.join(ROOT, 'scripts/quality/code-size-baseline.json');
const ROOT_PRODUCTION_FILES = new Set(['App.js', 'googleAuth.js', 'index.js']);
const TEST_PATH = /(^|\/)(__fixtures__|__tests__)(\/|$)|\.(test|spec)\.(js|jsx|mjs)$/;
const SOURCE_EXTENSION = /\.(js|jsx|mjs)$/;
const linter = new Linter({ configType: 'flat' });

export function isProductionFile(file) {
  return (
    SOURCE_EXTENSION.test(file) &&
    !TEST_PATH.test(file) &&
    (ROOT_PRODUCTION_FILES.has(file) || file.startsWith('src/'))
  );
}

export function evaluateSizeBudget(current, baseline) {
  const failures = [];
  const improvements = [];
  const { exceptions = {}, legacy = {}, target } = baseline;

  for (const [file, exception] of Object.entries(exceptions)) {
    if (
      typeof exception?.reason !== 'string' ||
      exception.reason.trim() === '' ||
      !Number.isInteger(exception.max) ||
      exception.max <= target
    ) {
      failures.push({ file, type: 'INVALID_EXCEPTION' });
    }
  }

  let legacyOversized = 0;
  let exceptionCount = 0;

  for (const [file, lines] of Object.entries(current)) {
    if (lines <= target) {
      if (legacy[file] > target && lines < legacy[file]) {
        improvements.push({ file, baseline: legacy[file], current: lines });
      }
      continue;
    }

    const legacyLimit = legacy[file];
    const exceptionLimit = exceptions[file]?.max;

    if (legacyLimit !== undefined) {
      legacyOversized += 1;
      if (lines < legacyLimit) {
        improvements.push({ file, baseline: legacyLimit, current: lines });
      } else if (lines > legacyLimit) {
        if (exceptionLimit && lines <= exceptionLimit) {
          exceptionCount += 1;
        } else {
          failures.push({ file, type: 'LEGACY_REGRESSION', baseline: legacyLimit, current: lines });
        }
      }
      continue;
    }

    if (exceptionLimit && lines <= exceptionLimit) {
      exceptionCount += 1;
      continue;
    }

    failures.push({ file, type: 'NEW_FILE_OVER_BUDGET', target, current: lines });
  }

  for (const [file, lines] of Object.entries(legacy)) {
    if (!(file in current)) {
      improvements.push({ file, baseline: lines, current: 0 });
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    improvements,
    legacyOversized,
    exceptionCount,
  };
}

function readBaseline() {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  if (
    baseline.version !== 1 ||
    !Number.isInteger(baseline.target) ||
    baseline.countPolicy?.skipBlankLines !== true ||
    baseline.countPolicy?.skipComments !== true ||
    typeof baseline.legacy !== 'object' ||
    Object.values(baseline.legacy).some(
      (lines) => !Number.isInteger(lines) || lines <= baseline.target
    )
  ) {
    throw new Error('Unsupported code-size baseline schema');
  }
  return baseline;
}

function listProductionFiles() {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'App.js', 'googleAuth.js', 'index.js', 'src'],
    { cwd: ROOT, encoding: 'utf8' }
  )
    .split('\0')
    .filter(isProductionFile)
    .sort();
}

function measureMeaningfulLines(file, policy) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const messages = linter.verify(
    source,
    [
      {
        languageOptions: {
          ecmaVersion: 'latest',
          parserOptions: { ecmaFeatures: { jsx: true } },
          sourceType: 'module',
        },
        linterOptions: { noInlineConfig: true },
        rules: { 'max-lines': ['error', { max: 1, ...policy }] },
      },
    ],
    { filename: file }
  );
  const parseFailure = messages.find((message) => message.fatal);
  if (parseFailure) {
    throw new Error(`${file}: ${parseFailure.message}`);
  }
  const maxLinesMessage = messages.find((message) => message.ruleId === 'max-lines');
  return Number(maxLinesMessage?.message.match(/\((\d+)\)\. Maximum/)?.[1] ?? 0);
}

function formatFailure(failure) {
  if (failure.type === 'LEGACY_REGRESSION') {
    return `FAIL ${failure.file}\n  legacy ${failure.baseline} -> ${failure.current} (+${failure.current - failure.baseline})`;
  }
  if (failure.type === 'NEW_FILE_OVER_BUDGET') {
    return `FAIL ${failure.file}\n  new file ${failure.current} > target ${failure.target}`;
  }
  return `FAIL ${failure.file}\n  invalid exception: add a non-empty reason and max > target`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--details')) {
    console.error('Usage: npm run quality:size -- [--details]');
    process.exitCode = 1;
    return;
  }

  const baseline = readBaseline();
  const current = Object.fromEntries(
    listProductionFiles().map((file) => [file, measureMeaningfulLines(file, baseline.countPolicy)])
  );
  const result = evaluateSizeBudget(current, baseline);

  console.log(`CODE SIZE ${result.pass ? 'PASS' : 'FAIL'}`);
  console.log(`target: ${baseline.target} meaningful lines`);
  console.log(`legacy oversized: ${result.legacyOversized}`);
  console.log(`regressions: ${result.failures.filter((item) => item.type === 'LEGACY_REGRESSION').length}`);
  console.log(`new oversized: ${result.failures.filter((item) => item.type === 'NEW_FILE_OVER_BUDGET').length}`);
  console.log(`exceptions: ${result.exceptionCount}`);
  console.log(`improvements: ${result.improvements.length}`);

  if (args.includes('--details')) {
    for (const item of result.improvements) {
      console.log(`IMPROVED ${item.file} ${item.baseline} -> ${item.current}`);
    }
  }
  for (const failure of result.failures) {
    console.error(formatFailure(failure));
  }
  process.exitCode = result.pass ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  main();
}
