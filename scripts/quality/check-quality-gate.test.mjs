import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeLintJson,
  classifyCommand,
  formatQuality,
  parseUnifiedDiff,
  synthesizeQuality,
} from './check-quality-gate.mjs';

const ROOT = '/repo';
const BASELINE = {
  version: 1,
  bugSignalRules: ['react-hooks/rules-of-hooks', 'import/export'],
  bugSignalsByFileRuleMessage: {
    'src/runtime.js|import/export|duplicate export': 1,
  },
  warningsByFileRule: {
    'src/legacy.js|no-unused-vars': 1,
    'src/runtime.js|import/export': 1,
  },
};
const PASS = { status: 'pass', detail: '' };

function report(messages = []) {
  return JSON.stringify([
    { filePath: `${ROOT}/src/legacy.js`, messages: messages.legacy ?? [] },
    { filePath: `${ROOT}/src/runtime.js`, messages: messages.runtime ?? [] },
  ]);
}

const unused = {
  severity: 1,
  ruleId: 'no-unused-vars',
  line: 3,
  column: 1,
  message: 'unused',
};
const duplicateExport = {
  severity: 1,
  ruleId: 'import/export',
  line: 8,
  column: 1,
  message: 'duplicate export',
};

function lint(messages = { legacy: [unused], runtime: [duplicateExport] }, ranges = {}) {
  return analyzeLintJson(report(messages), BASELINE, ranges, ROOT);
}

function result(lintResult = lint(), overrides = {}) {
  return synthesizeQuality({
    lint: lintResult,
    size: overrides.size ?? PASS,
    architecture: overrides.architecture ?? PASS,
    diff: overrides.diff ?? PASS,
  });
}

test('QG1 unchanged legacy warnings pass without becoming debt for the task', () => {
  const quality = result();
  assert.equal(quality.status, 'PASS');
  assert.equal(quality.lint.currentWarnings, 2);
  assert.equal(quality.lint.newWarningCount, 0);
});

test('QG2 a new general warning is visible and non-blocking debt', () => {
  const quality = result(lint({ legacy: [unused, unused], runtime: [duplicateExport] }));
  assert.equal(quality.status, 'PASS_WITH_DEBT');
  assert.equal(quality.lint.newWarningCount, 1);
});

test('QG3 a new lint error blocks', () => {
  const error = { ...unused, severity: 2, ruleId: 'no-undef', message: 'missing is not defined' };
  const quality = result(lint({ legacy: [unused, error], runtime: [duplicateExport] }));
  assert.equal(quality.status, 'FAIL');
  assert.deepEqual(quality.blocking, ['NEW_LINT_ERRORS']);
});

test('QG4 a new bug signal blocks', () => {
  const secondExport = { ...duplicateExport, line: 12 };
  const quality = result(
    lint({ legacy: [unused], runtime: [duplicateExport, secondExport] })
  );
  assert.equal(quality.status, 'FAIL');
  assert.equal(quality.lint.newBugSignalCount, 1);
});

test('QG4b a line shift alone does not create a bug signal', () => {
  const movedExport = { ...duplicateExport, line: 9 };
  const quality = result(lint({ legacy: [unused], runtime: [movedExport] }));
  assert.equal(quality.status, 'PASS');
  assert.equal(quality.lint.newWarningCount, 0);
  assert.equal(quality.lint.newBugSignalCount, 0);
});

test('QG5 a touched baseline bug signal requires evidence', () => {
  const quality = result(lint(undefined, { 'src/runtime.js': [[8, 8]] }));
  assert.equal(quality.status, 'INCONCLUSIVE');
  assert.equal(quality.lint.touchedBugSignals.length, 1);
});

test('QG6 a size regression blocks', () => {
  assert.equal(result(lint(), { size: { status: 'fail', detail: 'growth' } }).status, 'FAIL');
});

test('QG7 an architecture regression blocks', () => {
  const quality = result(lint(), {
    architecture: { status: 'fail', detail: 'new owner bypass' },
  });
  assert.equal(quality.status, 'FAIL');
});

test('QG8 malformed ESLint JSON is rejected', () => {
  assert.throws(() => analyzeLintJson('{', BASELINE, {}, ROOT), SyntaxError);
  assert.throws(() => analyzeLintJson('{}', BASELINE, {}, ROOT), /must be an array/);
});

test('QG9 tool failure is inconclusive when no confirmed blocker exists', () => {
  const toolFailure = classifyCommand({
    error: new Error('spawn failed'),
    status: null,
    signal: null,
    stdout: '',
    stderr: '',
  });
  assert.equal(result(lint(), { size: toolFailure }).status, 'INCONCLUSIVE');
});

test('QG10 diff-check failure blocks', () => {
  assert.equal(result(lint(), { diff: { status: 'fail', detail: 'whitespace' } }).status, 'FAIL');
});

test('QG11 unified diff exposes only new-side touched lines', () => {
  const ranges = parseUnifiedDiff(
    '+++ b/src/runtime.js\n@@ -7,2 +7,3 @@\n-old\n+new\n+++ /dev/null\n@@ -1 +0,0 @@'
  );
  assert.deepEqual(ranges, { 'src/runtime.js': [[7, 9]] });
});

test('QG12 compact, details and JSON modes stay machine-readable', () => {
  const quality = result();
  const debt = result(lint({ legacy: [unused, unused], runtime: [duplicateExport] }));
  assert.match(formatQuality(quality), /^QUALITY GATE PASS\n/);
  assert.doesNotMatch(formatQuality(quality), /src\/legacy/);
  assert.match(formatQuality(debt, { details: true }), /NEW src\/legacy\.js\|no-unused-vars \+1/);
  assert.equal(JSON.parse(formatQuality(quality, { json: true })).status, 'PASS');
});
