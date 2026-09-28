import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyVetting,
  evaluateExternalSkillAcquisition,
  hasProvenCapabilityGap,
  INTERNAL_SEARCH,
  validateProvenance,
} from './check-external-skill-acquisition.mjs';

const provenGap = {
  neededCapability: 'x',
  whyExistingCapabilitiesAreInsufficient: 'searched and uncovered',
  requiredContext: ['owner'],
  requiredWorkflow: ['workflow'],
  requiredValidation: ['eval'],
  expectedReuse: 'repeated',
  internalSearch: INTERNAL_SEARCH,
};

test('all external acquisition evals and empty provenance pass', () => {
  const result = evaluateExternalSkillAcquisition();
  assert.equal(result.status, 'PASS');
  assert.equal(result.evals, 13);
  assert.equal(result.passed, 13);
  assert.equal(result.provenanceRecords, 0);
});

test('external discovery requires complete capability gap evidence', () => {
  assert.equal(hasProvenCapabilityGap(provenGap), true);
  assert.equal(hasProvenCapabilityGap({ ...provenGap, requiredValidation: [] }), false);
  assert.equal(hasProvenCapabilityGap({ ...provenGap, internalSearch: null }), false);
  assert.equal(hasProvenCapabilityGap({ ...provenGap, internalSearch: INTERNAL_SEARCH.slice(0, -1) }), false);
  assert.equal(
    hasProvenCapabilityGap({
      ...provenGap,
      internalSearch: [...INTERNAL_SEARCH.slice(0, -1), INTERNAL_SEARCH[0]],
    }),
    false
  );
});

test('highest risk class selects vetting strength', () => {
  assert.equal(classifyVetting([]), 'NONE');
  assert.equal(classifyVetting(['PURE_INSTRUCTION']), 'BASELINE');
  assert.equal(classifyVetting(['TOOL_USING']), 'ELEVATED');
  assert.equal(classifyVetting(['PURE_INSTRUCTION', 'EXECUTABLE']), 'STRONG');
});

test('active external provenance must link scope, capability and registry asset', () => {
  const registry = {
    capabilities: [{ id: 'external-x' }],
    assets: [{ id: 'skill:external-x', kind: 'SKILL', provenanceId: 'external-x@1' }],
  };
  const provenance = {
    schemaVersion: 1,
    policy: 'docs/ai/external-skill-acquisition.md',
    records: [{
      id: 'external-x@1',
      source: 'owner/repo',
      repository: 'https://example.com/owner/repo',
      skillId: 'external-x',
      refOrVersion: 'v1',
      contentHash: 'abc123',
      installedScope: 'PROJECT',
      vettedAt: '2026-08-24',
      status: 'PINNED',
      decision: 'USE_PROJECT',
      wayperEvalResult: 'PASS',
      riskClasses: ['PURE_INSTRUCTION'],
      capabilityIds: ['external-x'],
    }],
  };

  assert.equal(validateProvenance(provenance, registry), 1);
  assert.throws(
    () => validateProvenance(provenance, { ...registry, assets: [] }),
    /missing registry asset/
  );
});
