import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDesignRouting } from './check-design-routing.mjs';

test('design routing evals pass without design skill metadata', () => {
  const result = evaluateDesignRouting();
  assert.equal(result.status, 'PASS');
  assert.equal(result.evals, 12);
  assert.equal(result.designSkillMetadataBytes, 0);
  assert.equal(result.permanentContextDelta, 0);
  assert.equal(result.irrelevantSkillLoads, 0);
});

test('non-design cases load no design context', () => {
  const result = evaluateDesignRouting();
  for (const item of result.cases.filter((entry) => entry.mode === 'NONE')) {
    assert.deepEqual(item.actual.capabilities, []);
    assert.deepEqual(item.actual.assets, []);
  }
});

test('post-run context deduplicates the canonical design reference', () => {
  const item = evaluateDesignRouting().cases.find((entry) => entry.id === 'DR4_POST_RUN_REDESIGN');
  assert.deepEqual(item.actual.assets, ['reference:ui-design']);
});
