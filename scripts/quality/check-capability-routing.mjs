import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
export const REGISTRY_PATH = 'docs/ai/capability-registry.json';
export const EVALS_PATH = 'docs/ai/capability-routing-evals.json';
export const DEPENDENCY_CLASSES = new Set([
  'INTERFACE_ONLY',
  'BEHAVIOR_RELEVANT',
  'OWNER_CRITICAL',
]);

const unique = (items = []) => [...new Set(items)];
const sorted = (items = []) => unique(items).sort();
const sameSet = (left = [], right = []) =>
  JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

function resolveRepoPath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid repository path: ${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes repository: ${relativePath}`);
  }
  return resolved;
}

function requireFile(root, relativePath) {
  const resolved = resolveRepoPath(root, relativePath);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing file: ${relativePath}`);
  }
  return resolved;
}

export function parseSkillMetadata(source, relativePath) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!frontmatter) throw new Error(`Missing skill frontmatter: ${relativePath}`);
  const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !description) throw new Error(`Missing skill name/description: ${relativePath}`);
  return { name, description };
}

export function loadCapabilityFiles(root = ROOT) {
  const registryFile = requireFile(root, REGISTRY_PATH);
  const evalsFile = requireFile(root, EVALS_PATH);
  return {
    registry: JSON.parse(fs.readFileSync(registryFile, 'utf8')),
    evals: JSON.parse(fs.readFileSync(evalsFile, 'utf8')),
    registryBytes: fs.statSync(registryFile).size,
  };
}

export function validateRegistry(registry, root = ROOT) {
  if (
    registry?.schemaVersion !== 1 ||
    !Array.isArray(registry.domains) ||
    !Array.isArray(registry.assets) ||
    !Array.isArray(registry.capabilities)
  ) {
    throw new Error('Unsupported capability registry schema');
  }

  const domains = new Set(registry.domains);
  if (domains.size !== registry.domains.length || [...domains].some((item) => !item)) {
    throw new Error('Capability domains must be unique non-empty strings');
  }

  const assets = new Map();
  for (const asset of registry.assets) {
    if (!asset?.id || assets.has(asset.id) || !['SKILL', 'REFERENCE'].includes(asset.kind)) {
      throw new Error(`Invalid or duplicate capability asset: ${asset?.id}`);
    }
    const resolved = requireFile(root, asset.path);
    if (asset.kind === 'SKILL') {
      const metadata = parseSkillMetadata(fs.readFileSync(resolved, 'utf8'), asset.path);
      if (`skill:${metadata.name}` !== asset.id) {
        throw new Error(`Skill asset id mismatch: ${asset.id}`);
      }
    }
    assets.set(asset.id, asset);
  }

  const capabilities = new Map();
  for (const capability of registry.capabilities) {
    if (
      !capability?.id ||
      capabilities.has(capability.id) ||
      !domains.has(capability.domain) ||
      !assets.has(capability.asset) ||
      !Array.isArray(capability.suggests) ||
      unique(capability.suggests).length !== capability.suggests.length
    ) {
      throw new Error(`Invalid or duplicate capability: ${capability?.id}`);
    }
    capabilities.set(capability.id, capability);
  }
  for (const capability of capabilities.values()) {
    for (const suggested of capability.suggests) {
      if (!capabilities.has(suggested)) {
        throw new Error(`Unknown suggested capability: ${capability.id} -> ${suggested}`);
      }
    }
  }
  return { domains, assets, capabilities };
}

export function validateEvals(evals, registryState, root = ROOT) {
  if (evals?.schemaVersion !== 1 || !Array.isArray(evals.cases)) {
    throw new Error('Unsupported capability eval schema');
  }
  const ids = new Set();
  for (const item of evals.cases) {
    if (!item?.id || ids.has(item.id) || !registryState.domains.has(item.entryDomain)) {
      throw new Error(`Invalid or duplicate capability eval: ${item?.id}`);
    }
    ids.add(item.id);
    if (!Array.isArray(item.entryCapabilities) || !Array.isArray(item.dependencies)) {
      throw new Error(`Invalid capability eval inputs: ${item.id}`);
    }
    if (
      item.allowEmptyEntry !== undefined &&
      (item.allowEmptyEntry !== true || item.entryCapabilities.length !== 0)
    ) {
      throw new Error(`Invalid empty-entry exception in ${item.id}`);
    }
    let entryDomainMatched = false;
    for (const capability of item.entryCapabilities) {
      const entry = registryState.capabilities.get(capability);
      if (!entry) {
        throw new Error(`Unknown entry capability in ${item.id}: ${capability}`);
      }
      if (entry.domain === item.entryDomain) entryDomainMatched = true;
    }
    if (!entryDomainMatched && item.allowEmptyEntry !== true) {
      throw new Error(`Entry domain mismatch in ${item.id}`);
    }
    for (const dependency of item.dependencies) {
      if (
        !DEPENDENCY_CLASSES.has(dependency.classification) ||
        typeof dependency.sourceConfirmed !== 'boolean' ||
        !registryState.capabilities.has(dependency.capability)
      ) {
        throw new Error(`Invalid dependency in ${item.id}: ${dependency.capability}`);
      }
      if (dependency.sourceConfirmed) {
        const evidenceFile = requireFile(root, dependency.evidence);
        if (
          typeof dependency.evidencePattern !== 'string' ||
          !dependency.evidencePattern ||
          !fs.readFileSync(evidenceFile, 'utf8').includes(dependency.evidencePattern)
        ) {
          throw new Error(`Unconfirmed source evidence in ${item.id}: ${dependency.capability}`);
        }
      }
    }
    if (!Array.isArray(item.expected?.capabilities) || !Array.isArray(item.expected?.skills)) {
      throw new Error(`Missing expected working set in ${item.id}`);
    }
  }
}

function simulateCatalog(registry, targetSize) {
  if (targetSize === undefined) return registry;
  if (!Number.isInteger(targetSize) || targetSize < 0) {
    throw new Error(`Invalid simulated catalog size: ${targetSize}`);
  }
  if (targetSize <= registry.capabilities.length) return registry;
  const seed = registry.capabilities[0];
  if (!seed) throw new Error('Cannot simulate an empty capability catalog');
  const simulated = Array.from({ length: targetSize - registry.capabilities.length }, (_, index) => ({
    id: `simulation-only-${index + 1}`,
    domain: registry.domains[index % registry.domains.length],
    asset: seed.asset,
    suggests: [],
  }));
  return { ...registry, capabilities: [...registry.capabilities, ...simulated] };
}

function addAsset(loadedAssets, capability, registryState) {
  const asset = registryState.assets.get(capability.asset);
  loadedAssets.set(asset.id, asset);
}

export function composeContext(registry, item, root = ROOT) {
  const state = validateRegistry(simulateCatalog(registry, item.simulatedCatalogSize), root);
  const selected = new Set();
  const loadedAssets = new Map();
  const interfaceOnly = [];
  const ownerCritical = [];
  const gaps = [...(item.uncoveredRequirements ?? [])];

  for (const id of item.entryCapabilities ?? []) {
    const capability = state.capabilities.get(id);
    if (!capability) {
      gaps.push(id);
      continue;
    }
    selected.add(id);
    addAsset(loadedAssets, capability, state);
  }

  for (const dependency of item.dependencies ?? []) {
    if (!dependency.sourceConfirmed) continue;
    const capability = state.capabilities.get(dependency.capability);
    if (!capability) {
      gaps.push(dependency.capability);
      continue;
    }
    selected.add(capability.id);
    if (dependency.classification === 'INTERFACE_ONLY') {
      interfaceOnly.push(capability.id);
      continue;
    }
    addAsset(loadedAssets, capability, state);
    if (dependency.classification === 'OWNER_CRITICAL') ownerCritical.push(capability.id);
  }

  const skills = [...loadedAssets.values()]
    .filter((asset) => asset.kind === 'SKILL')
    .map((asset) => asset.id.slice('skill:'.length));
  const contextBytes = [...loadedAssets.values()].reduce(
    (total, asset) => total + fs.statSync(requireFile(root, asset.path)).size,
    0
  );

  return {
    capabilities: [...selected],
    skills,
    assets: [...loadedAssets.keys()],
    interfaceOnly,
    ownerCritical,
    capabilityGap: gaps.length > 0,
    gaps,
    catalogSize: state.capabilities.size,
    composedContextBytes: contextBytes,
  };
}

export function evaluateCase(registry, item, root = ROOT) {
  const actual = composeContext(registry, item, root);
  const expected = item.expected;
  const expectedSet = new Set(expected.capabilities);
  const actualSet = new Set(actual.capabilities);
  const truePositive = [...actualSet].filter((id) => expectedSet.has(id)).length;
  const excludedLoaded = (expected.excluded ?? []).filter((id) => actualSet.has(id));
  const missedCapabilities = expected.capabilities.filter((id) => !actualSet.has(id));
  const unexpectedCapabilities = actual.capabilities.filter((id) => !expectedSet.has(id));
  const irrelevantSkillLoads = actual.skills.filter((id) => !expected.skills.includes(id));
  const checks = {
    capabilities: sameSet(actual.capabilities, expected.capabilities),
    skills: sameSet(actual.skills, expected.skills),
    excluded: excludedLoaded.length === 0,
    interfaceOnly: sameSet(actual.interfaceOnly, expected.interfaceOnly ?? []),
    ownerCritical: sameSet(actual.ownerCritical, expected.ownerCritical ?? []),
    capabilityGap: actual.capabilityGap === expected.capabilityGap,
    catalogSize: expected.catalogSize === undefined || actual.catalogSize === expected.catalogSize,
  };
  return {
    id: item.id,
    pass: Object.values(checks).every(Boolean),
    checks,
    actual,
    precision: actualSet.size === 0 ? 1 : truePositive / actualSet.size,
    recall: expectedSet.size === 0 ? 1 : truePositive / expectedSet.size,
    irrelevantSkillLoads: irrelevantSkillLoads.length,
    missedCapabilities: missedCapabilities.length,
    excludedLoaded,
    unexpectedCapabilities,
  };
}

function skillCosts(registry, root) {
  let permanentDiscoveryBytes = 0;
  let onDemandSkillBodyBytes = 0;
  for (const asset of registry.assets.filter((item) => item.kind === 'SKILL')) {
    const resolved = requireFile(root, asset.path);
    const source = fs.readFileSync(resolved, 'utf8');
    const metadata = parseSkillMetadata(source, asset.path);
    permanentDiscoveryBytes += Buffer.byteLength(metadata.name + metadata.description + resolved);
    onDemandSkillBodyBytes += Buffer.byteLength(source);
  }
  return { permanentDiscoveryBytes, onDemandSkillBodyBytes };
}

export function evaluateCapabilityRouting(root = ROOT) {
  const { registry, evals, registryBytes } = loadCapabilityFiles(root);
  const state = validateRegistry(registry, root);
  validateEvals(evals, state, root);
  const cases = evals.cases.map((item) => evaluateCase(registry, item, root));
  const selected = cases.reduce((total, item) => total + item.actual.capabilities.length, 0);
  const truePositives = cases.reduce((total, result, index) => {
    const expectedSet = new Set(evals.cases[index].expected.capabilities);
    return total + result.actual.capabilities.filter((id) => expectedSet.has(id)).length;
  }, 0);
  const expected = evals.cases.reduce((total, item) => total + item.expected.capabilities.length, 0);
  const skillsPerTask = cases.map((item) => item.actual.skills.length);
  const composedBytes = cases.map((item) => item.actual.composedContextBytes);
  return {
    status: cases.every((item) => item.pass) ? 'PASS' : 'FAIL',
    totalCapabilities: state.capabilities.size,
    activeSkills: [...state.assets.values()].filter((asset) => asset.kind === 'SKILL').length,
    registryBytes,
    ...skillCosts(registry, root),
    evals: cases.length,
    passed: cases.filter((item) => item.pass).length,
    routingPrecision: selected === 0 ? 1 : cases.reduce(
      (total, item) => total + item.precision * item.actual.capabilities.length,
      0
    ) / selected,
    routingRecall: expected === 0 ? 1 : truePositives / expected,
    irrelevantSkillLoads: cases.reduce((total, item) => total + item.irrelevantSkillLoads, 0),
    missedCapabilities: cases.reduce((total, item) => total + item.missedCapabilities, 0),
    skillsLoadedPerTask: skillsPerTask,
    composedContextBytes: composedBytes,
    cases,
  };
}

export function formatCapabilityRouting(result, { json = false } = {}) {
  if (json) return JSON.stringify(result);
  const average = (items) => items.reduce((sum, item) => sum + item, 0) / Math.max(1, items.length);
  return [
    `CAPABILITY ROUTING ${result.status}`,
    `${result.passed}/${result.evals} evals / ${result.totalCapabilities} capabilities / ${result.activeSkills} skills`,
    `registry ${result.registryBytes} B / discovery ${result.permanentDiscoveryBytes} B / skill bodies ${result.onDemandSkillBodyBytes} B`,
    `skills/task ${average(result.skillsLoadedPerTask).toFixed(2)} / context/task ${Math.round(average(result.composedContextBytes))} B`,
    `precision ${(result.routingPrecision * 100).toFixed(1)}% / recall ${(result.routingRecall * 100).toFixed(1)}% / irrelevant ${result.irrelevantSkillLoads} / missed ${result.missedCapabilities}`,
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--json')) {
    throw new Error('Usage: npm run quality:capabilities -- [--json]');
  }
  const result = evaluateCapabilityRouting();
  console.log(formatCapabilityRouting(result, { json: args.includes('--json') }));
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    await main();
  } catch (error) {
    console.error(`CAPABILITY ROUTING TOOLING_ERROR\n${error.message}`);
    process.exitCode = 2;
  }
}
