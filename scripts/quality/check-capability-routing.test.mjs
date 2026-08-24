import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROOT,
  composeContext,
  evaluateCapabilityRouting,
  loadCapabilityFiles,
  validateRegistry,
} from './check-capability-routing.mjs';

const { registry, evals } = loadCapabilityFiles();

test('CR1 registry and all declared capability evals pass', () => {
  const result = evaluateCapabilityRouting();
  assert.equal(result.status, 'PASS');
  assert.equal(result.passed, evals.cases.length);
  assert.equal(result.irrelevantSkillLoads, 0);
  assert.equal(result.missedCapabilities, 0);
});

test('CR2 suggested relationships never auto-load or recurse', () => {
  const result = composeContext(registry, {
    entryCapabilities: ['weekly-ranking'],
    dependencies: [{
      capability: 'xp-progression',
      classification: 'BEHAVIOR_RELEVANT',
      sourceConfirmed: true,
    }],
  });
  assert.deepEqual(result.capabilities, ['weekly-ranking', 'xp-progression']);
  assert.ok(!result.capabilities.includes('friends'));
  assert.ok(!result.capabilities.includes('deferred-post-run-processing'));
});

test('CR3 interface-only keeps the dependent asset body out', () => {
  const result = composeContext(registry, {
    entryCapabilities: ['weekly-ranking'],
    dependencies: [{
      capability: 'friends',
      classification: 'INTERFACE_ONLY',
      sourceConfirmed: true,
    }],
  });
  assert.deepEqual(result.interfaceOnly, ['friends']);
  assert.deepEqual(result.assets, ['reference:ranking-xp']);
});

test('CR4 source-confirmed owner-critical dependency composes two current skills', () => {
  const result = composeContext(registry, {
    entryCapabilities: ['active-run-recovery'],
    dependencies: [{
      capability: 'durable-run-save',
      classification: 'OWNER_CRITICAL',
      sourceConfirmed: true,
    }],
  });
  assert.deepEqual(result.ownerCritical, ['durable-run-save']);
  assert.deepEqual(result.skills, ['wayper-active-run', 'wayper-persistence-sync']);
});

test('CR5 unconfirmed dependency stays out', () => {
  const result = composeContext(registry, {
    entryCapabilities: ['weekly-ranking'],
    dependencies: [{
      capability: 'friends',
      classification: 'BEHAVIOR_RELEVANT',
      sourceConfirmed: false,
    }],
  });
  assert.deepEqual(result.capabilities, ['weekly-ranking']);
});

test('CR6 catalog simulation reaches 70 without persisting fake capabilities', () => {
  const fixture = evals.cases.find((item) => item.id === 'CR10_LARGE_CATALOG');
  const result = composeContext(registry, fixture);
  assert.equal(result.catalogSize, 70);
  assert.equal(result.capabilities.length, 2);
  assert.equal(registry.capabilities.length < 70, true);
});

test('CR7 uncovered requirement becomes a capability gap only after catalog routing', () => {
  const fixture = evals.cases.find((item) => item.id === 'CR12_CAPABILITY_GAP');
  const result = composeContext(registry, fixture);
  assert.equal(result.capabilityGap, true);
  assert.deepEqual(result.gaps, ['group-tournament-bracket']);
});

test('CR8 registry rejects unknown suggested capability', () => {
  const invalid = structuredClone(registry);
  invalid.capabilities[0].suggests.push('missing-capability');
  assert.throws(() => validateRegistry(invalid, ROOT), /Unknown suggested capability/);
});

test('CR9 registry rejects a skill id that diverges from SKILL metadata', () => {
  const invalid = structuredClone(registry);
  invalid.assets.find((item) => item.kind === 'SKILL').id = 'skill:wrong-name';
  assert.throws(() => validateRegistry(invalid, ROOT), /Skill asset id mismatch/);
});
