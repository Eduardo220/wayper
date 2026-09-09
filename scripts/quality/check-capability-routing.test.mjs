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

test('CR10 copy-only entry loads no design reference', () => {
  const fixture = evals.cases.find((item) => item.id === 'CR6_TRIVIAL_NO_EXPANSION');
  const result = composeContext(registry, fixture);
  assert.deepEqual(result.capabilities, []);
  assert.deepEqual(result.assets, []);
});

test('CR11 schema v2 preserves the 56-capability routing catalog', () => {
  const state = validateRegistry(registry, ROOT);
  const covered = new Set([...state.agentProfiles.values()].flatMap((item) => item.capabilities));
  assert.equal(registry.schemaVersion, 2);
  assert.equal(state.capabilities.size, 56);
  assert.equal(state.agentProfiles.size, 8);
  assert.equal(covered.size, 30);
});

test('CR12 registry rejects dangling profile capability and skill references', () => {
  const missingCapability = structuredClone(registry);
  missingCapability.agentProfiles[0].capabilities.push('missing-capability');
  assert.throws(
    () => validateRegistry(missingCapability, ROOT),
    /Unknown capability in agent profile/
  );

  const missingSkill = structuredClone(registry);
  missingSkill.agentProfiles[0].skills.push('missing-skill');
  assert.throws(() => validateRegistry(missingSkill, ROOT), /Unknown skill in agent profile/);
});

test('CR13 registry rejects invalid or duplicate profiles', () => {
  const invalid = structuredClone(registry);
  invalid.agentProfiles[0].domain = 'MISSING_DOMAIN';
  assert.throws(() => validateRegistry(invalid, ROOT), /Invalid or duplicate agent profile/);

  const duplicate = structuredClone(registry);
  duplicate.agentProfiles.push(structuredClone(duplicate.agentProfiles[0]));
  assert.throws(() => validateRegistry(duplicate, ROOT), /Invalid or duplicate agent profile/);
});

test('CR14 registry rejects missing TOML and invalid native role references', () => {
  const missingToml = structuredClone(registry);
  missingToml.agentProfiles[0].tomlProfile = '.codex/agents/missing.toml';
  assert.throws(() => validateRegistry(missingToml, ROOT), /Missing file/);

  const invalidRole = structuredClone(registry);
  invalidRole.agentProfiles[0].nativeRole = 'architect';
  assert.throws(() => validateRegistry(invalidRole, ROOT), /Invalid native role/);
});

test('CR15 registry rejects dangling conflicts, prerequisites, and validators', () => {
  for (const field of ['conflicts', 'prerequisites']) {
    const invalid = structuredClone(registry);
    invalid.agentProfiles[0][field] = ['missing-profile'];
    assert.throws(() => validateRegistry(invalid, ROOT), new RegExp(`Unknown ${field}`));
  }

  const invalidValidator = structuredClone(registry);
  invalidValidator.agentProfiles[0].validators = ['scripts/quality/missing-validator.mjs'];
  assert.throws(() => validateRegistry(invalidValidator, ROOT), /Missing file/);
});

test('CR16 registry rejects duplicate capabilities and dangling asset references', () => {
  const duplicate = structuredClone(registry);
  duplicate.capabilities.push(structuredClone(duplicate.capabilities[0]));
  assert.throws(() => validateRegistry(duplicate, ROOT), /Invalid or duplicate capability/);

  const missingAsset = structuredClone(registry);
  missingAsset.capabilities[0].asset = 'reference:missing';
  assert.throws(() => validateRegistry(missingAsset, ROOT), /Invalid or duplicate capability/);
});

test('CR17 registry rejects an unknown router repository', () => {
  const invalid = structuredClone(registry);
  invalid.agentProfiles[0].repositories = ['mixed-workspace'];
  assert.throws(() => validateRegistry(invalid, ROOT), /Invalid repositories/);
});

test('CR18 new profiles are scoped, native read-only and add no capability overlap', () => {
  const existingIds = new Set([
    'wayper_concurrency_reviewer',
    'wayper_geospatial_reviewer',
    'wayper_mobile_lifecycle_reviewer',
    'wayper_persistence_reviewer',
  ]);
  const newIds = [
    'wayper_accessibility_reviewer',
    'wayper_auth_security_reviewer',
    'wayper_diagnostics_privacy_reviewer',
    'wayper_progression_rules_reviewer',
  ];
  const state = validateRegistry(registry, ROOT);
  const claimed = new Set([...existingIds].flatMap((id) => state.agentProfiles.get(id).capabilities));
  for (const id of newIds) {
    const profile = state.agentProfiles.get(id);
    assert.ok(profile.scope);
    assert.deepEqual(profile.repositories, ['wayper']);
    assert.equal(profile.nativeRole, 'explorer');
    assert.equal(profile.tomlProfile, undefined);
    assert.equal(profile.writePermission, 'none');
    assert.equal(profile.sandbox, 'read-only');
    assert.ok(profile.capabilities.every((capability) => !claimed.has(capability)));
    profile.capabilities.forEach((capability) => claimed.add(capability));
  }

  const invalid = structuredClone(registry);
  invalid.agentProfiles.find((item) => item.id === newIds[0]).scope = '';
  assert.throws(() => validateRegistry(invalid, ROOT), /Invalid scope/);
});
