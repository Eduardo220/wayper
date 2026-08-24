import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

const QUALITY_TESTS = {
  size: 'scripts/quality/check-code-size.test.mjs',
  architecture: 'scripts/quality/check-architecture.test.mjs',
  gate: 'scripts/quality/check-quality-gate.test.mjs',
  backstop: 'scripts/quality/check-completion-backstop.test.mjs',
};

function isHarness(file) {
  return file === 'AGENTS.md'
    || file.startsWith('.agents/')
    || file.startsWith('.codex/')
    || file.startsWith('docs/ai/');
}

function isQualityTooling(file) {
  return file === 'eslint.config.js'
    || file.startsWith('scripts/quality/');
}

function isPackageConfig(file) {
  return /^(package(?:-lock)?\.json|app\.json|eas\.json|babel\.config\.[cm]?js|metro\.config\.[cm]?js)$/.test(file);
}

function isTest(file) {
  return file.includes('/__tests__/')
    || file.startsWith('__tests__/')
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function fileScope(file) {
  if (isQualityTooling(file)) return 'QUALITY_TOOLING';
  if (isHarness(file)) return 'HARNESS_ONLY';
  if (file.startsWith('android/')) return 'NATIVE_ANDROID';
  if (isPackageConfig(file)) return 'PACKAGE_CONFIG';
  if (isTest(file)) return 'TESTS';
  if (file.endsWith('.md')) return 'DOCS_ONLY';
  return 'PRODUCT_SOURCE';
}

export function classifyChangedScope(files) {
  if (!files.length) return 'NO_CHANGES';
  const scopes = new Set(files.map(fileScope));
  return scopes.size === 1 ? [...scopes][0] : 'MIXED';
}

export function relevantQualityTests(files) {
  const tests = new Set();
  for (const file of files) {
    if (file !== '.codex/hooks.json' && !isQualityTooling(file)) continue;
    if (file === '.codex/hooks.json' || file.includes('completion-backstop')) {
      tests.add(QUALITY_TESTS.backstop);
    }
    if (file.includes('code-size') || file.endsWith('code-size-baseline.json')) {
      tests.add(QUALITY_TESTS.size);
    }
    if (file.includes('architecture') || file.endsWith('architecture-baseline.json')) {
      tests.add(QUALITY_TESTS.architecture);
    }
    if (
      file.includes('quality-gate')
      || file.endsWith('lint-baseline.json')
      || file === 'eslint.config.js'
    ) {
      tests.add(QUALITY_TESTS.gate);
    }
  }
  return [...tests].sort();
}

export function buildCheckPlan(scope, files) {
  if (scope === 'NO_CHANGES') return [];
  const checks = [{
    id: 'untracked-diff',
    command: 'git',
    args: [],
    timeout: 10_000,
    retry: 'git status --short && git diff --check',
  }];
  const tests = relevantQualityTests(files);
  if (tests.length) {
    checks.push({
      id: 'quality-tests',
      command: process.execPath,
      args: ['--test', ...tests],
      timeout: 30_000,
      retry: `node --test ${tests.join(' ')}`,
    });
  }
  if (scope === 'DOCS_ONLY' || scope === 'HARNESS_ONLY') {
    checks.push({
      id: 'diff',
      command: 'git',
      args: ['diff', '--check', 'HEAD', '--'],
      timeout: 10_000,
      retry: 'git diff --check',
    });
  } else {
    checks.push({
      id: 'quality',
      command: 'npm',
      args: ['run', '--silent', 'quality:gate', '--', '--json'],
      timeout: 60_000,
      retry: 'npm run quality:gate -- --details',
    });
  }
  return checks;
}

function gitRoot(cwd = process.cwd()) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
  }).trim();
}

function changedFiles(root) {
  const tracked = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', 'HEAD', '--'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000 }
  );
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000 }
  );
  return [...new Set(`${tracked}\n${untracked}`.split('\n').filter(Boolean))].sort();
}

function defaultRunner(check, root) {
  if (check.id === 'untracked-diff') return checkUntrackedFiles(root, check.timeout);
  return spawnSync(check.command, check.args, {
    cwd: root,
    encoding: 'utf8',
    timeout: check.timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
}

export function checkUntrackedFiles(root, timeout) {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    }).split('\n').filter(Boolean);
  } catch (error) {
    return { error, status: null, signal: null, stdout: '', stderr: '' };
  }
  for (const file of files) {
    const run = spawnSync(
      'git',
      [
        'diff',
        '--no-index',
        '--check',
        '--',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
        file,
      ],
      { cwd: root, encoding: 'utf8', timeout }
    );
    if (run.error || run.signal || run.status === null) return run;
    if (run.status > 1) return { ...run, status: 1 };
  }
  return { status: 0, signal: null, stdout: '', stderr: '' };
}

function qualityOutcome(run, check) {
  let report;
  try {
    report = JSON.parse(run.stdout.trim());
  } catch {
    return {
      status: 'TOOLING_ERROR',
      detail: 'quality gate returned malformed JSON',
      retry: check.retry,
    };
  }
  if (report.status === 'FAIL') {
    return {
      status: 'FAIL',
      detail: report.blocking?.[0] ?? 'quality gate failed',
      retry: check.retry,
    };
  }
  if (report.status === 'INCONCLUSIVE') {
    const tooling = report.type === 'TOOL_FAILURE' || report.toolFailures?.length;
    return {
      status: tooling ? 'TOOLING_ERROR' : 'FAIL',
      detail: tooling ? 'quality gate tooling failure' : 'quality evidence is inconclusive',
      retry: check.retry,
    };
  }
  if (!['PASS', 'PASS_WITH_DEBT'].includes(report.status)) {
    return {
      status: 'TOOLING_ERROR',
      detail: 'quality gate returned an unknown status',
      retry: check.retry,
    };
  }
  if (run.status !== 0) {
    return {
      status: 'TOOLING_ERROR',
      detail: `quality gate exited ${run.status} after reporting ${report.status}`,
      retry: check.retry,
    };
  }
  return { status: 'PASS' };
}

function checkOutcome(run, check) {
  if (run.error || run.signal || run.status === null) {
    return {
      status: 'TOOLING_ERROR',
      detail: run.error?.message ?? run.signal ?? `${check.id} returned no status`,
      retry: check.retry,
    };
  }
  if (check.id === 'quality') return qualityOutcome(run, check);
  if (run.status !== 0) {
    return { status: 'FAIL', detail: `${check.id} failed`, retry: check.retry };
  }
  return { status: 'PASS' };
}

export function runBackstop({ root, files, runner = defaultRunner }) {
  const scope = classifyChangedScope(files);
  const plan = buildCheckPlan(scope, files);
  if (!plan.length) return { status: 'SKIP', scope };
  for (const check of plan) {
    const outcome = checkOutcome(runner(check, root), check);
    if (outcome.status !== 'PASS') return { ...outcome, scope };
  }
  return { status: 'PASS', scope };
}

export function formatBackstop(result) {
  if (result.status === 'PASS') return `QUALITY BACKSTOP PASS\nscope: ${result.scope}`;
  if (result.status === 'SKIP') return 'QUALITY BACKSTOP SKIP';
  const detail = String(result.detail ?? 'unknown failure')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return [
    `QUALITY BACKSTOP ${result.status}`,
    detail,
    `run: ${result.retry}`,
  ].join('\n');
}

export function hookResponse(result, stopHookActive = false) {
  if (stopHookActive || ['PASS', 'SKIP'].includes(result.status)) return '';
  return JSON.stringify({ decision: 'block', reason: formatBackstop(result) });
}

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
  });
}

async function main() {
  const hookMode = process.argv.includes('--hook');
  let payload = {};
  try {
    if (hookMode) payload = JSON.parse(await readStdin());
    if (payload.stop_hook_active) return;
    const root = gitRoot(payload.cwd);
    const result = runBackstop({ root, files: changedFiles(root) });
    if (hookMode) {
      process.stdout.write(hookResponse(result));
    } else {
      console.log(formatBackstop(result));
      process.exitCode = result.status === 'FAIL' ? 1 : result.status === 'TOOLING_ERROR' ? 2 : 0;
    }
  } catch (error) {
    const result = {
      status: 'TOOLING_ERROR',
      detail: error.message,
      retry: 'npm run quality:backstop',
    };
    if (hookMode) process.stdout.write(hookResponse(result, payload.stop_hook_active));
    else {
      console.log(formatBackstop(result));
      process.exitCode = 2;
    }
  }
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) await main();
