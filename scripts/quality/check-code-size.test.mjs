import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSizeBudget } from './check-code-size.mjs';

const baseline = {
  target: 350,
  legacy: { 'src/legacy.js': 7199 },
  exceptions: {},
};

test('accepts a new production file within target', () => {
  assert.equal(evaluateSizeBudget({ 'src/new.js': 200 }, baseline).pass, true);
});

test('rejects a new production file over target', () => {
  const result = evaluateSizeBudget({ 'src/new.js': 500 }, baseline);
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].type, 'NEW_FILE_OVER_BUDGET');
});

test('accepts and reports legacy improvement', () => {
  const result = evaluateSizeBudget({ 'src/legacy.js': 7180 }, baseline);
  assert.equal(result.pass, true);
  assert.deepEqual(result.improvements, [
    { file: 'src/legacy.js', baseline: 7199, current: 7180 },
  ]);
});

test('rejects legacy growth', () => {
  const result = evaluateSizeBudget({ 'src/legacy.js': 7300 }, baseline);
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].type, 'LEGACY_REGRESSION');
});

test('accepts a reviewed, bounded exception', () => {
  const result = evaluateSizeBudget(
    { 'src/cohesive.js': 400 },
    {
      ...baseline,
      exceptions: { 'src/cohesive.js': { max: 420, reason: 'Framework-owned table' } },
    }
  );
  assert.equal(result.pass, true);
  assert.equal(result.exceptionCount, 1);
});

test('rejects an exception without rationale', () => {
  const result = evaluateSizeBudget(
    { 'src/cohesive.js': 400 },
    { ...baseline, exceptions: { 'src/cohesive.js': { max: 420, reason: '' } } }
  );
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].type, 'INVALID_EXCEPTION');
});
