import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildCheckPlan,
  checkUntrackedFiles,
  classifyChangedScope,
  formatBackstop,
  hookResponse,
  relevantQualityTests,
  runBackstop,
} from './check-completion-backstop.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./check-completion-backstop.mjs', import.meta.url));

const run = (status = 0, stdout = '') => ({
  status,
  stdout,
  stderr: '',
  signal: null,
});

const quality = (status = 'PASS', extra = {}) => run(
  ['PASS', 'PASS_WITH_DEBT'].includes(status) ? 0 : 1,
  JSON.stringify({ status, ...extra })
);

const qualityRunner = (result) => (check) => check.id === 'quality' ? result : run();

test('HB1 changed scope is deterministic and conservative', () => {
  assert.equal(classifyChangedScope([]), 'NO_CHANGES');
  assert.equal(classifyChangedScope(['README.md']), 'DOCS_ONLY');
  assert.equal(classifyChangedScope(['docs/ai/harness-v1.md']), 'HARNESS_ONLY');
  assert.equal(classifyChangedScope(['src/App.js']), 'PRODUCT_SOURCE');
  assert.equal(classifyChangedScope(['src/App.test.js']), 'TESTS');
  assert.equal(classifyChangedScope(['scripts/quality/check-code-size.mjs']), 'QUALITY_TOOLING');
  assert.equal(classifyChangedScope(['package.json']), 'PACKAGE_CONFIG');
  assert.equal(classifyChangedScope(['android/app/build.gradle']), 'NATIVE_ANDROID');
  assert.equal(classifyChangedScope(['README.md', 'src/App.js']), 'MIXED');
});

test('HB2 no changes skip and docs avoid product gates', () => {
  assert.deepEqual(buildCheckPlan('NO_CHANGES', []), []);
  const docs = buildCheckPlan('DOCS_ONLY', ['README.md']);
  assert.deepEqual(docs.map((check) => check.id), ['untracked-diff', 'diff']);
});

test('HB3 product, tests, config and native changes select the FAST gate', () => {
  for (const scope of ['PRODUCT_SOURCE', 'TESTS', 'PACKAGE_CONFIG', 'NATIVE_ANDROID', 'MIXED']) {
    assert.equal(buildCheckPlan(scope, ['src/App.js']).at(-1).id, 'quality');
  }
});

test('HB4 quality tooling selects only directly associated tests', () => {
  assert.deepEqual(
    relevantQualityTests([
      '.codex/hooks.json',
      'scripts/quality/check-code-size.mjs',
      'scripts/quality/architecture-baseline.json',
      'eslint.config.js',
    ]),
    [
      'scripts/quality/check-architecture.test.mjs',
      'scripts/quality/check-code-size.test.mjs',
      'scripts/quality/check-completion-backstop.test.mjs',
      'scripts/quality/check-quality-gate.test.mjs',
    ]
  );
  assert.deepEqual(relevantQualityTests(['docs/ai/architecture-boundaries.md']), []);
});

test('HB5 unchanged legacy debt remains a pass', () => {
  const result = runBackstop({
    root: '/repo',
    files: ['src/App.js'],
    runner: qualityRunner(quality('PASS_WITH_DEBT')),
  });
  assert.equal(result.status, 'PASS');
});

test('HB6 deterministic quality failures block with one actionable command', () => {
  const result = runBackstop({
    root: '/repo',
    files: ['src/App.js'],
    runner: qualityRunner(quality('FAIL', { blocking: ['ARCHITECTURE_REGRESSION'] })),
  });
  assert.equal(result.status, 'FAIL');
  assert.match(formatBackstop(result), /ARCHITECTURE_REGRESSION/);
  assert.match(formatBackstop(result), /npm run quality:gate -- --details/);
});

test('HB7 new bug signals, size and architecture failures remain quality-owned', () => {
  for (const blocker of ['NEW_BUG_SIGNALS', 'SIZE_REGRESSION', 'ARCHITECTURE_REGRESSION']) {
    const result = runBackstop({
      root: '/repo',
      files: ['src/App.js'],
      runner: qualityRunner(quality('FAIL', { blocking: [blocker] })),
    });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.detail, blocker);
  }
});

test('HB8 malformed output and process failures are tooling errors', () => {
  const malformed = runBackstop({
    root: '/repo',
    files: ['src/App.js'],
    runner: () => run(0, 'not-json'),
  });
  const crashed = runBackstop({
    root: '/repo',
    files: ['src/App.js'],
    runner: () => ({ ...run(null), error: new Error('spawn failed') }),
  });
  const timedOut = runBackstop({
    root: '/repo',
    files: ['src/App.js'],
    runner: () => ({ ...run(null), signal: 'SIGTERM' }),
  });
  const inconsistent = runBackstop({
    root: '/repo',
    files: ['src/App.js'],
    runner: qualityRunner({ ...quality('PASS'), status: 1 }),
  });
  assert.equal(malformed.status, 'TOOLING_ERROR');
  assert.equal(crashed.status, 'TOOLING_ERROR');
  assert.equal(timedOut.status, 'TOOLING_ERROR');
  assert.equal(inconsistent.status, 'TOOLING_ERROR');
});

test('HB9 inconclusive review evidence blocks while tool failure stays distinct', () => {
  const review = runBackstop({
    root: '/repo',
    files: ['src/App.js'],
    runner: qualityRunner(quality('INCONCLUSIVE', { toolFailures: [] })),
  });
  const tooling = runBackstop({
    root: '/repo',
    files: ['src/App.js'],
    runner: qualityRunner(quality('INCONCLUSIVE', { toolFailures: ['lint'] })),
  });
  assert.equal(review.status, 'FAIL');
  assert.equal(tooling.status, 'TOOLING_ERROR');
});

test('HB10 hook success is silent and failure feedback is compact', () => {
  assert.equal(hookResponse({ status: 'PASS' }), '');
  assert.equal(hookResponse({ status: 'SKIP' }), '');
  const response = hookResponse({
    status: 'FAIL',
    detail: 'SIZE_REGRESSION',
    retry: 'npm run quality:size -- --details',
  });
  assert.equal(JSON.parse(response).decision, 'block');
  assert.ok(Buffer.byteLength(response) < 220);
  assert.ok(Buffer.byteLength(hookResponse({
    status: 'TOOLING_ERROR',
    detail: 'x'.repeat(1_000),
    retry: 'npm run quality:backstop',
  })) < 250);
});

test('HB11 an active Stop continuation never creates an infinite loop', () => {
  assert.equal(hookResponse({ status: 'FAIL' }, true), '');
});

test('HB12 targeted test failures block before the aggregate gate', () => {
  const result = runBackstop({
    root: '/repo',
    files: ['scripts/quality/check-code-size.mjs'],
    runner: (check) => check.id === 'quality-tests' ? run(1) : quality(),
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.detail, 'quality-tests failed');
});

test('HB13 untracked whitespace is checked without staging or mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-backstop-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, 'clean.md'), 'clean\n');
    assert.equal(checkUntrackedFiles(root, 5_000).status, 0);
    fs.writeFileSync(path.join(root, 'bad.md'), 'bad   \n');
    assert.equal(checkUntrackedFiles(root, 5_000).status, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('HB14 hook tooling errors keep stderr quiet and feedback compact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-backstop-nonrepo-'));
  try {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--hook'], {
      cwd: root,
      encoding: 'utf8',
      input: JSON.stringify({ cwd: root, stop_hook_active: false }),
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).decision, 'block');
    assert.match(result.stdout, /QUALITY BACKSTOP TOOLING_ERROR/);
    assert.ok(Buffer.byteLength(result.stdout) < 250);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
