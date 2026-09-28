import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  GRAPHIFY_DECISIONS,
  ROUTER_DISPATCH_INVARIANT,
  ROUTER_MODE,
  ROUTER_SELECTION_DECISIONS,
  ROUTER_VERSION,
  createTaskFingerprint,
  evaluateShadowEvals,
  routeTask,
  validateRouterSelectionReceipt,
  validateShadowEvals,
} from './wayper-agent-router.mjs';
import { loadCapabilityFiles } from './quality/check-capability-routing.mjs';

const { registry } = loadCapabilityFiles();
const CAPABILITIES = registry.capabilities.map((item) => item.id);

function input(overrides = {}) {
  return {
    schemaVersion: 1,
    goalId: 'router-test',
    operation: 'TEST_OPERATION',
    repositories: ['wayper'],
    changedFiles: [],
    candidatePaths: [],
    riskFlags: [],
    knownCapabilities: ['active-run-lifecycle'],
    knownGoodCapabilities: [],
    capabilityAssessmentComplete: true,
    structuralUncertainty: false,
    taskClass: 'BUG',
    orchestrationMode: 'S1',
    executionIntent: 'READ_ONLY_SPECIALIST',
    signals: [],
    ...overrides,
  };
}

function profile(id, capabilities, extra = {}) {
  return {
    id,
    repositories: ['wayper'],
    domain: 'RUN_RUNTIME',
    capabilities,
    estimatedContextCost: { tokens: 10 },
    ...extra,
  };
}

function withProfiles(profiles) {
  return { ...structuredClone(registry), agentProfiles: profiles };
}

test('AR1 all 18 declared shadow evals pass without LLM calls', () => {
  const result = evaluateShadowEvals();
  assert.equal(result.status, 'PASS');
  assert.equal(result.cases, 18);
  assert.equal(result.performance.llmCalls, 0);
});

test('AR2 repeatability: identical and reordered facts produce byte-identical output', () => {
  const task = input({
    knownCapabilities: ['durable-run-save', 'active-run-lifecycle'],
    riskFlags: ['OFFLINE_STORAGE', 'CONCURRENCY'],
    changedFiles: ['src/b.js', 'src/a.js'],
  });
  const reordered = { ...task,
    knownCapabilities: [...task.knownCapabilities].reverse(),
    riskFlags: [...task.riskFlags].reverse(),
    changedFiles: [...task.changedFiles].reverse() };
  assert.equal(JSON.stringify(routeTask(task, registry)), JSON.stringify(routeTask(task, registry)));
  assert.equal(JSON.stringify(routeTask(task, registry)), JSON.stringify(routeTask(reordered, registry)));
});

test('AR3 fingerprint is versioned and requires provenance for behavioral signals', () => {
  const fingerprint = createTaskFingerprint(input());
  assert.equal(fingerprint.routerVersion, ROUTER_VERSION);
  assert.match(fingerprint.hash, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => createTaskFingerprint(input({
    signals: [{ type: 'keyword', value: 'race' }],
  })), /require provenance/);
});

test('AR4 invalid registry and unknown capability fail closed', () => {
  assert.throws(() => routeTask(input(), { ...registry, schemaVersion: 99 }), /Unsupported/);
  assert.throws(() => routeTask(input({ knownCapabilities: ['missing-capability'] }), registry), /Unknown capability/);
});

test('AR4b dangling capability and profile references in evals fail closed', () => {
  const evals = JSON.parse(fs.readFileSync('docs/ai/agent-router-shadow-evals.json', 'utf8'));
  const state = {
    capabilities: new Map(registry.capabilities.map((item) => [item.id, item])),
    agentProfiles: new Map(registry.agentProfiles.map((item) => [item.id, item])),
  };
  const missingCapability = structuredClone(evals);
  missingCapability.cases[0].expected.forbiddenCapabilities.push('missing-capability');
  assert.throws(() => validateShadowEvals(missingCapability, state), /Unknown capability/);
  const missingProfile = structuredClone(evals);
  missingProfile.cases[0].expected.forbiddenProfiles.push('missing-profile');
  assert.throws(() => validateShadowEvals(missingProfile, state), /Unknown profile/);
});

test('AR5 missing and zero specialist return an explicit non-operational result', () => {
  const result = routeTask(input(), withProfiles([]));
  assert.equal(result.recommendation.status, 'NO_OPERATIONAL_PROFILE_AVAILABLE');
  assert.deepEqual(result.selectedProfiles, []);
  assert.deepEqual(result.coverage.required.uncovered, ['active-run-lifecycle']);
  assert.equal(result.requiresModelJudgment, false);
  assert.equal(result.selectionReceipt.decision, ROUTER_SELECTION_DECISIONS.BEHAVIORAL_FALLBACK);
});

test('AR6 path matching is repository-scoped and explainable', () => {
  const custom = withProfiles([
    profile('path_owner', ['active-run-lifecycle'], { paths: ['wayper:src/owner/**'] }),
  ]);
  const result = routeTask(input({ candidatePaths: ['src/owner/runtime.js'] }), custom);
  assert.deepEqual(result.candidateProfiles[0].matches.path, ['wayper:src/owner/runtime.js']);
  assert.deepEqual(result.selectedProfiles.map((item) => item.id), ['path_owner']);
});

test('AR7 site-only routing excludes mobile profiles and cross-repo stays isolated', () => {
  const site = routeTask(input({
    repositories: ['wayper-site'],
    knownCapabilities: [],
    changedFiles: ['src/app/page.tsx'],
  }), registry);
  assert.equal(site.candidateProfiles.length, 0);
  assert.ok(site.excludedProfiles.every((item) => item.reason === 'REPOSITORY_MISMATCH'));
  const cross = routeTask(input({
    repositories: ['wayper', 'wayper-site'],
    knownCapabilities: ['harness-routing'],
  }), registry);
  assert.equal(cross.graphifyDecision, GRAPHIFY_DECISIONS.TARGETED_RECOMMENDED);
  assert.deepEqual(cross.repositories, ['wayper', 'wayper-site']);
});

test('AR8 declared exclusions prevent selection', () => {
  const custom = withProfiles([
    profile('excluded_owner', ['active-run-lifecycle'], { exclusions: ['ui only'] }),
  ]);
  const result = routeTask(input({
    signals: [{ type: 'exclusion', value: 'UI only change', provenance: { source: 'USER_TASK' } }],
  }), custom);
  assert.deepEqual(result.selectedProfiles, []);
  assert.equal(result.excludedProfiles[0].reason, 'EXCLUSION_MATCH');
});

test('AR9 conflicts are deterministic and leave an explicit judgment residual', () => {
  const custom = withProfiles([
    profile('a_owner', ['active-run-lifecycle'], { conflicts: ['b_owner'] }),
    profile('b_owner', ['durable-run-save']),
  ]);
  const result = routeTask(input({
    knownCapabilities: ['active-run-lifecycle', 'durable-run-save'],
  }), custom);
  assert.deepEqual(result.selectedProfiles.map((item) => item.id), ['a_owner']);
  assert.ok(result.excludedProfiles.some((item) => item.id === 'b_owner' && item.reason === 'CONFLICT'));
  assert.equal(result.requiresModelJudgment, true);
  assert.equal(result.selectionReceipt.decision, ROUTER_SELECTION_DECISIONS.BEHAVIORAL_FALLBACK);
});

test('AR10 prerequisites are selected before the profile that requires them', () => {
  const custom = withProfiles([
    profile('prerequisite', ['weekly-ranking']),
    profile('specialist', ['active-run-lifecycle'], { prerequisites: ['prerequisite'] }),
  ]);
  const result = routeTask(input(), custom);
  assert.deepEqual(result.selectedProfiles.map((item) => item.id), ['prerequisite', 'specialist']);
  assert.equal(result.selectedProfiles[0].selectionReason, 'PREREQUISITE_FOR:specialist');
});

test('AR11 validators remain declared evidence and are never executed by the router', () => {
  const validator = 'scripts/quality/check-capability-routing.mjs';
  const custom = withProfiles([profile('validated', ['active-run-lifecycle'], { validators: [validator] })]);
  const result = routeTask(input(), custom);
  assert.deepEqual(result.selectedProfiles[0].validators, [validator]);
});

test('AR12 known-good evidence lowers score but never removes required coverage', () => {
  const custom = withProfiles([profile('known_good_owner', ['active-run-lifecycle'])]);
  const result = routeTask(input({
    knownGoodCapabilities: ['active-run-lifecycle'],
    questionsExistingBehavior: true,
  }), custom);
  assert.deepEqual(result.coverage.required.covered, ['active-run-lifecycle']);
  assert.ok(result.candidateProfiles[0].scoreComponents.knownGoodPenalty < 0);
});

test('AR13 overlap is marked ALREADY_COVERED instead of selecting a redundant profile', () => {
  const custom = withProfiles([
    profile('a_owner', ['active-run-lifecycle']),
    profile('b_owner', ['active-run-lifecycle']),
  ]);
  const result = routeTask(input(), custom);
  assert.deepEqual(result.selectedProfiles.map((item) => item.id), ['a_owner']);
  assert.ok(result.excludedProfiles.some((item) => item.id === 'b_owner' && item.reason === 'ALREADY_COVERED'));
});

test('AR14 greedy set-cover prefers one profile that covers two requirements', () => {
  const custom = withProfiles([
    profile('all_owner', ['active-run-lifecycle', 'durable-run-save']),
    profile('lifecycle_owner', ['active-run-lifecycle']),
    profile('save_owner', ['durable-run-save']),
  ]);
  const result = routeTask(input({
    knownCapabilities: ['active-run-lifecycle', 'durable-run-save'],
  }), custom);
  assert.deepEqual(result.selectedProfiles.map((item) => item.id), ['all_owner']);
});

test('AR15 many relevant profiles are selected by coverage with no MAX_SELECTED_AGENTS cap', () => {
  const capabilities = CAPABILITIES.slice(0, 14);
  const custom = withProfiles(capabilities.map((capability, index) =>
    profile(`owner_${String(index).padStart(2, '0')}`, [capability])));
  const result = routeTask(input({ knownCapabilities: capabilities }), custom);
  assert.equal(result.selectedProfiles.length, 14);
  assert.doesNotMatch(fs.readFileSync('scripts/wayper-agent-router.mjs', 'utf8'), /MAX_SELECTED_AGENTS/);
});

test('AR16 Graphify is a decision only: known paths skip it, uncertainty requires it', () => {
  assert.equal(routeTask(input({ candidatePaths: ['src/known.js'] }), registry).graphifyDecision,
    GRAPHIFY_DECISIONS.NOT_NEEDED);
  assert.equal(routeTask(input({ structuralUncertainty: true }), registry).graphifyDecision,
    GRAPHIFY_DECISIONS.REQUIRED);
  const supplied = routeTask(input({
    structuralUncertainty: true,
    graphifyResult: {
      repository: 'wayper',
      repositoryFingerprint: 'sha256:repo-scope',
      dependencySignals: [{ capability: 'durable-run-save', provenance: { source: 'GRAPH_QUERY' } }],
    },
  }), registry);
  assert.equal(supplied.graphifyDecision, GRAPHIFY_DECISIONS.NOT_NEEDED);
  assert.deepEqual(supplied.optionalCapabilities.map((item) => item.id), ['durable-run-save']);
  const crossRepo = routeTask(input({
    repositories: ['wayper', 'wayper-site'],
    structuralUncertainty: true,
    graphifyResults: [
      { repository: 'wayper', repositoryFingerprint: 'mobile', dependencySignals: [] },
      { repository: 'wayper-site', repositoryFingerprint: 'site', dependencySignals: [] },
    ],
  }), registry);
  assert.equal(crossRepo.graphifyDecision, GRAPHIFY_DECISIONS.NOT_NEEDED);
  assert.deepEqual(crossRepo.taskFingerprint.facts.graphifyResults.map((item) => item.repository),
    ['wayper', 'wayper-site']);
});

test('AR17 ambiguous residual is explicit when capability assessment is incomplete', () => {
  const result = routeTask(input({
    knownCapabilities: [],
    capabilityAssessmentComplete: false,
  }), registry);
  assert.equal(result.requiresModelJudgment, true);
  assert.ok(result.ambiguities.some((item) => item.code === 'CAPABILITY_JUDGMENT_REQUIRED'));
});

test('AR18 shadow comparison separates behavioral and deterministic selections', () => {
  const result = routeTask(input({
    riskFlags: ['LIFECYCLE'],
    actualBehavioralSelection: {
      profiles: ['wayper_concurrency_reviewer'],
      capabilities: ['active-run-lifecycle'],
      estimatedContextCost: 900,
    },
  }), registry);
  assert.equal(result.shadowComparison.status, 'AVAILABLE');
  assert.deepEqual(result.shadowComparison.onlyBehavioralProfiles, ['wayper_concurrency_reviewer']);
  assert.deepEqual(result.shadowComparison.onlyDeterministicProfiles, ['wayper_mobile_lifecycle_reviewer']);
});

test('AR19 complete unambiguous read-only coverage receives selective authority without spawning', () => {
  const result = routeTask(input(), registry);
  assert.equal(result.mode, ROUTER_MODE);
  assert.equal(result.selectionReceipt.decision, ROUTER_SELECTION_DECISIONS.ROUTER_SELECTED);
  assert.equal(result.selectionReceipt.reason, 'COMPLETE_UNAMBIGUOUS_READ_ONLY_COVERAGE');
  assert.equal(result.selectionReceipt.dispatchInvariant, ROUTER_DISPATCH_INVARIANT);
  assert.deepEqual(result.recommendation.profileIds, result.selectionReceipt.profileIds);
  assert.equal(validateRouterSelectionReceipt(result.selectionReceipt, { registry }).status, 'VALID');
  assert.equal('spawn' in result, false);
});

test('AR20 malformed repository paths and mixed Graphify results fail closed', () => {
  assert.throws(() => routeTask(input({ changedFiles: ['../secret'] }), registry), /Invalid changedFile/);
  assert.throws(() => routeTask(input({
    graphifyResult: {
      repository: 'wayper-site',
      repositoryFingerprint: 'mixed',
      dependencySignals: [],
    },
  }), registry), /repository-scoped/);
});

test('AR21 architectural, critical, writer, non-specialist and judgment residuals stay behavioral', () => {
  const cases = [
    [{ taskClass: 'ARCHITECTURAL' }, 'TASK_CLASS_REQUIRES_BEHAVIORAL_GATE'],
    [{ taskClass: 'CRITICAL_RUNTIME' }, 'TASK_CLASS_REQUIRES_BEHAVIORAL_GATE'],
    [{ executionIntent: 'WRITER' }, 'WRITER_REQUIRES_BEHAVIORAL_GATE'],
    [{ executionIntent: 'NONE', orchestrationMode: 'S0' }, 'NO_SPECIALIST_REQUESTED'],
    [{ repositories: ['wayper', 'wayper-site'] }, 'CROSS_REPO_SCOPE_REQUIRES_BEHAVIORAL_GATE'],
    [{ capabilityAssessmentComplete: false }, 'CAPABILITY_ASSESSMENT_INCOMPLETE'],
    [{ structuralUncertainty: true }, 'STRUCTURAL_JUDGMENT_REQUIRED'],
    [{ orchestrationMode: 'S3' }, 'ORCHESTRATION_MODE_REQUIRES_BEHAVIORAL_GATE'],
  ];
  for (const [overrides, reason] of cases) {
    const receipt = routeTask(input(overrides), registry).selectionReceipt;
    assert.equal(receipt.decision, ROUTER_SELECTION_DECISIONS.BEHAVIORAL_FALLBACK);
    assert.equal(receipt.reason, reason);
    assert.deepEqual(receipt.profileIds, []);
  }
});

test('AR22 router receipts are closed, deterministic and cannot authorize another profile', () => {
  const result = routeTask(input(), registry);
  assert.equal(JSON.stringify(routeTask(input(), registry).selectionReceipt), JSON.stringify(result.selectionReceipt));
  const forged = { ...result.selectionReceipt, profileIds: ['wayper_geospatial_reviewer'] };
  assert.equal(validateRouterSelectionReceipt(forged, { registry }).status, 'INVALID');
  assert.equal(validateRouterSelectionReceipt(result.selectionReceipt, { registry,
    agentId: 'wayper_geospatial_reviewer' }).status, 'INVALID');
});

test('AR23 new native-role specialists pass the existing selective safety gates', () => {
  const cases = [
    ['wayper_auth_security_reviewer', ['firebase-auth'], ['AUTH_SECURITY']],
    ['wayper_accessibility_reviewer', ['screen-ui-accessibility'], ['ACCESSIBILITY']],
    ['wayper_diagnostics_privacy_reviewer', ['sentry-monitoring'], []],
    ['wayper_progression_rules_reviewer', ['xp-progression', 'weekly-ranking'], ['PRODUCT_RULE']],
  ];
  for (const [id, knownCapabilities, riskFlags] of cases) {
    const result = routeTask(input({ taskClass: 'BOUNDED', knownCapabilities, riskFlags }), registry);
    assert.deepEqual(result.selectedProfiles.map((item) => item.id), [id]);
    assert.equal(result.selectionReceipt.decision, ROUTER_SELECTION_DECISIONS.ROUTER_SELECTED);
    assert.equal(validateRouterSelectionReceipt(result.selectionReceipt, { registry, agentId: id }).status, 'VALID');
  }
});

test('AR24 known generic tooling capability remains without a custom profile', () => {
  const result = routeTask(input({ taskClass: 'BOUNDED', knownCapabilities: ['test-build'],
    riskFlags: ['BUILD_TOOLING'] }), registry);
  assert.deepEqual(result.selectedProfiles, []);
  assert.deepEqual(result.coverage.required.uncovered, ['test-build']);
  assert.equal(result.selectionReceipt.decision, ROUTER_SELECTION_DECISIONS.BEHAVIORAL_FALLBACK);
});
