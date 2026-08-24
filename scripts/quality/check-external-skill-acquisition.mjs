import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
export const POLICY_PATH = 'docs/ai/external-skill-acquisition.md';
export const EVALS_PATH = 'docs/ai/external-skill-acquisition-evals.json';
export const PROVENANCE_PATH = 'docs/ai/external-skill-provenance.json';
export const REGISTRY_PATH = 'docs/ai/capability-registry.json';

export const GAP_FIELDS = [
  'neededCapability',
  'whyExistingCapabilitiesAreInsufficient',
  'requiredContext',
  'requiredWorkflow',
  'requiredValidation',
  'expectedReuse',
];
export const INTERNAL_SEARCH = [
  'TASK',
  'SOURCE',
  'OWNERS',
  'CAPABILITIES',
  'SKILLS',
  'REFERENCES',
  'TOOLING',
];
export const RISK_CLASSES = new Set([
  'PURE_INSTRUCTION',
  'TOOL_USING',
  'EXECUTABLE',
  'NETWORKED',
  'HOOK_INSTALLING',
  'CONFIG_MUTATING',
  'DEPENDENCY_INSTALLING',
]);
export const DECISIONS = new Set([
  'REJECT',
  'USE_TEMPORARILY',
  'USE_GLOBAL',
  'USE_PROJECT',
  'ADAPT_TO_WAYPER',
  'BUILD_OUR_OWN',
]);
const STRONG_RISKS = new Set([
  'EXECUTABLE',
  'NETWORKED',
  'HOOK_INSTALLING',
  'CONFIG_MUTATING',
  'DEPENDENCY_INSTALLING',
]);
const PRIVILEGED_MUTATION = new Set([
  'HOOK_INSTALLING',
  'CONFIG_MUTATING',
  'DEPENDENCY_INSTALLING',
]);
const ACTIVE_STATUSES = new Set(['ACTIVE', 'PINNED']);
const PROVENANCE_STATUSES = new Set([
  ...ACTIVE_STATUSES,
  'DISABLED',
  'DEPRECATED',
  'REMOVED',
  'REPLACED',
]);

const nonEmpty = (value) =>
  typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) && value.length > 0;
const sameSet = (left, right) =>
  Array.isArray(left) && Array.isArray(right) &&
  new Set(left).size === right.length && new Set(right).size === right.length &&
  [...new Set(left)].every((item) => right.includes(item));
const acquisitionResult = (externalDiscovery, decision, vettingLevel, reVettingRequired) => ({
  externalDiscovery,
  routerAuthority: 'WAYPER',
  decision,
  persistentPromotionAllowed: decision === 'USE_GLOBAL' || decision === 'USE_PROJECT',
  vettingLevel,
  reVettingRequired,
});

function repoFile(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid repository path: ${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`) || !fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing or escaping repository file: ${relativePath}`);
  }
  return resolved;
}

export function hasProvenCapabilityGap(gap) {
  return Boolean(
    gap &&
      GAP_FIELDS.every((field) => nonEmpty(gap[field])) &&
      sameSet(gap.internalSearch, INTERNAL_SEARCH)
  );
}

export function classifyVetting(riskClasses = []) {
  if (riskClasses.length === 0) return 'NONE';
  if (riskClasses.some((item) => STRONG_RISKS.has(item))) return 'STRONG';
  if (riskClasses.includes('TOOL_USING')) return 'ELEVATED';
  return 'BASELINE';
}

export function evaluateAcquisitionCase(item, gapProfiles) {
  const gap = item.gapProfile === null ? null : gapProfiles[item.gapProfile];
  const externalDiscovery = hasProvenCapabilityGap(gap);
  if (!externalDiscovery) {
    return acquisitionResult(false, null, 'NONE', false);
  }

  const candidate = item.candidate;
  if (!candidate) {
    return acquisitionResult(true, null, 'NONE', false);
  }
  const riskClasses = candidate.riskClasses ?? [];
  if (!Array.isArray(riskClasses) || riskClasses.some((item) => !RISK_CLASSES.has(item))) {
    throw new Error(`Invalid risk class in ${item.id}`);
  }
  const vettingLevel = classifyVetting(riskClasses);
  if (candidate.upstreamMaterialChange) {
    return acquisitionResult(true, null, vettingLevel, true);
  }

  let decision = 'USE_TEMPORARILY';
  if (candidate.suitable === false) decision = 'BUILD_OUR_OWN';
  else if (candidate.architectureConflict) decision = candidate.adaptable ? 'ADAPT_TO_WAYPER' : 'REJECT';
  else if (candidate.needsAdaptation) decision = candidate.adaptable ? 'ADAPT_TO_WAYPER' : 'REJECT';
  else if (riskClasses.some((item) => PRIVILEGED_MUTATION.has(item)) && !candidate.isolationProven) {
    decision = 'REJECT';
  }
  return acquisitionResult(true, decision, vettingLevel, false);
}

export function validateProvenance(provenance, registry, root = ROOT) {
  if (
    provenance?.schemaVersion !== 1 ||
    provenance.policy !== POLICY_PATH ||
    !Array.isArray(provenance.records)
  ) {
    throw new Error('Unsupported external skill provenance schema');
  }
  repoFile(root, provenance.policy);
  const capabilities = new Set(registry.capabilities.map((item) => item.id));
  const records = new Map();

  for (const record of provenance.records) {
    const required = [
      'id', 'source', 'repository', 'skillId', 'refOrVersion', 'installedScope',
      'vettedAt', 'status', 'decision', 'wayperEvalResult',
    ];
    if (
      required.some((field) => typeof record?.[field] !== 'string' || !record[field]) ||
      records.has(record.id) ||
      !PROVENANCE_STATUSES.has(record.status) ||
      !DECISIONS.has(record.decision) ||
      !['PROJECT', 'GLOBAL'].includes(record.installedScope) ||
      !Array.isArray(record.riskClasses) ||
      record.riskClasses.some((item) => !RISK_CLASSES.has(item)) ||
      !Array.isArray(record.capabilityIds) ||
      Boolean(record.contentHash) === Boolean(record.lockRef)
    ) {
      throw new Error(`Invalid external skill provenance record: ${record?.id}`);
    }
    if (record.contentHash && (typeof record.contentHash !== 'string' || !record.contentHash.trim())) {
      throw new Error(`Invalid external skill content hash: ${record.id}`);
    }
    if (record.lockRef) {
      const { path: lockPath, skill, hashField } = record.lockRef;
      if (![lockPath, skill, hashField].every((item) => typeof item === 'string' && item)) {
        throw new Error(`Invalid external skill lock ref: ${record.id}`);
      }
      const lock = JSON.parse(fs.readFileSync(repoFile(root, lockPath), 'utf8'));
      if (typeof lock?.skills?.[skill]?.[hashField] !== 'string' || !lock.skills[skill][hashField]) {
        throw new Error(`Unresolved external skill lock ref: ${record.id}`);
      }
    }
    if (
      ACTIVE_STATUSES.has(record.status) &&
      (record.capabilityIds.length === 0 || record.capabilityIds.some((item) => !capabilities.has(item)))
    ) {
      throw new Error(`Active external skill has invalid capabilities: ${record.id}`);
    }
    if (
      ACTIVE_STATUSES.has(record.status) &&
      !(
        (record.installedScope === 'PROJECT' && record.decision === 'USE_PROJECT') ||
        (record.installedScope === 'GLOBAL' && record.decision === 'USE_GLOBAL')
      )
    ) {
      throw new Error(`Active external skill scope/decision mismatch: ${record.id}`);
    }
    records.set(record.id, record);
  }

  const linked = new Set();
  for (const asset of registry.assets) {
    if (!asset.provenanceId) continue;
    const record = records.get(asset.provenanceId);
    if (asset.kind !== 'SKILL' || !record || !ACTIVE_STATUSES.has(record.status)) {
      throw new Error(`Invalid external skill registry link: ${asset.id}`);
    }
    linked.add(record.id);
  }
  for (const record of records.values()) {
    if (ACTIVE_STATUSES.has(record.status) && !linked.has(record.id)) {
      throw new Error(`Active external skill missing registry asset: ${record.id}`);
    }
  }
  return records.size;
}

export function evaluateExternalSkillAcquisition(root = ROOT) {
  const policyFile = repoFile(root, POLICY_PATH);
  const evalsFile = repoFile(root, EVALS_PATH);
  const provenanceFile = repoFile(root, PROVENANCE_PATH);
  const registryFile = repoFile(root, REGISTRY_PATH);
  const evals = JSON.parse(fs.readFileSync(evalsFile, 'utf8'));
  const provenance = JSON.parse(fs.readFileSync(provenanceFile, 'utf8'));
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  if (evals?.schemaVersion !== 1 || !evals.gapProfiles || !Array.isArray(evals.cases)) {
    throw new Error('Unsupported external skill acquisition eval schema');
  }

  const ids = new Set();
  const cases = evals.cases.map((item) => {
    if (!item?.id || ids.has(item.id) || !(item.gapProfile === null || evals.gapProfiles[item.gapProfile])) {
      throw new Error(`Invalid external skill acquisition eval: ${item?.id}`);
    }
    ids.add(item.id);
    const actual = evaluateAcquisitionCase(item, evals.gapProfiles);
    const pass = JSON.stringify(actual) === JSON.stringify(item.expected);
    return { id: item.id, pass, actual };
  });
  const provenanceRecords = validateProvenance(provenance, registry, root);
  return {
    status: cases.every((item) => item.pass) ? 'PASS' : 'FAIL',
    passed: cases.filter((item) => item.pass).length,
    evals: cases.length,
    provenanceRecords,
    policyBytes: fs.statSync(policyFile).size,
    evalBytes: fs.statSync(evalsFile).size,
    provenanceBytes: fs.statSync(provenanceFile).size,
    cases,
  };
}

export function formatExternalSkillAcquisition(result, { json = false } = {}) {
  if (json) return JSON.stringify(result);
  return [
    `EXTERNAL SKILL ACQUISITION ${result.status}`,
    `${result.passed}/${result.evals} evals / ${result.provenanceRecords} promoted external skills`,
    `policy ${result.policyBytes} B / evals ${result.evalBytes} B / provenance ${result.provenanceBytes} B`,
  ].join('\n');
}

function main() {
  const json = process.argv.slice(2).includes('--json');
  try {
    const result = evaluateExternalSkillAcquisition();
    console.log(formatExternalSkillAcquisition(result, { json }));
    process.exitCode = result.status === 'PASS' ? 0 : 1;
  } catch (error) {
    console.error(`EXTERNAL SKILL ACQUISITION FAIL\n${error.message}`);
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) main();
