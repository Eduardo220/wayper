import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT,
  composeContext,
  loadCapabilityFiles,
  parseSkillMetadata,
  validateRegistry,
} from './check-capability-routing.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const EVALS_PATH = path.join(ROOT, 'docs/ai/design-routing-evals.json');
const DESIGN_PATH = path.join(ROOT, 'DESIGN.md');
const MODES = new Set(['NONE', 'OPERATE', 'EXPERIENCE']);

const sorted = (items = []) => [...new Set(items)].sort();
const sameSet = (left = [], right = []) =>
  JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

function validateEvals(evals, state) {
  if (evals?.schemaVersion !== 1 || !Array.isArray(evals.cases)) {
    throw new Error('Unsupported design routing eval schema');
  }

  const ids = new Set();
  for (const item of evals.cases) {
    if (!item?.id || ids.has(item.id) || !MODES.has(item.mode)) {
      throw new Error(`Invalid or duplicate design eval: ${item?.id}`);
    }
    ids.add(item.id);
    if (!Array.isArray(item.entryCapabilities) || !Array.isArray(item.expected?.capabilities)) {
      throw new Error(`Invalid design eval inputs: ${item.id}`);
    }
    if (!Array.isArray(item.expected.skills) || !Array.isArray(item.expected.excluded)) {
      throw new Error(`Invalid design eval expectations: ${item.id}`);
    }
    for (const id of item.entryCapabilities) {
      if (state.capabilities.get(id)?.domain !== 'UI_DESIGN') {
        throw new Error(`Non-design entry capability in ${item.id}: ${id}`);
      }
    }
    if (item.mode === 'NONE' && item.entryCapabilities.length > 0) {
      throw new Error(`NONE mode loads design context in ${item.id}`);
    }
  }
}

function designMetrics(registry, state) {
  const capabilities = [...state.capabilities.values()].filter(
    (item) => item.domain === 'UI_DESIGN'
  );
  const assetIds = new Set(capabilities.map((item) => item.asset));
  const assets = registry.assets.filter((item) => assetIds.has(item.id));
  const designSkills = assets.filter((item) => item.kind === 'SKILL');
  const registrySlice = { assets, capabilities };
  const designSkillMetadataBytes = designSkills.reduce((total, item) => {
    const resolved = path.resolve(ROOT, item.path);
    const metadata = parseSkillMetadata(fs.readFileSync(resolved, 'utf8'), item.path);
    return total + Buffer.byteLength(metadata.name + metadata.description + resolved);
  }, 0);

  return {
    designCapabilities: capabilities.length,
    designRegistryBytes: Buffer.byteLength(JSON.stringify(registrySlice)),
    designSkillMetadataBytes,
    designOnDemandBytes: fs.statSync(DESIGN_PATH).size,
    permanentContextDelta: designSkillMetadataBytes,
  };
}

export function evaluateDesignRouting() {
  const { registry } = loadCapabilityFiles();
  const state = validateRegistry(registry);
  const evals = JSON.parse(fs.readFileSync(EVALS_PATH, 'utf8'));
  validateEvals(evals, state);

  const cases = evals.cases.map((item) => {
    const actual = composeContext(registry, {
      entryCapabilities: item.entryCapabilities,
      dependencies: [],
    });
    const excludedLoaded = item.expected.excluded.filter((id) =>
      actual.capabilities.includes(id)
    );
    const checks = {
      capabilities: sameSet(actual.capabilities, item.expected.capabilities),
      skills: sameSet(actual.skills, item.expected.skills),
      excluded: excludedLoaded.length === 0,
      noDesignContext: item.mode !== 'NONE' || (
        actual.capabilities.length === 0 && actual.assets.length === 0
      ),
    };
    return {
      id: item.id,
      mode: item.mode,
      pass: Object.values(checks).every(Boolean),
      checks,
      actual,
      excludedLoaded,
    };
  });

  return {
    status: cases.every((item) => item.pass) ? 'PASS' : 'FAIL',
    evals: cases.length,
    passed: cases.filter((item) => item.pass).length,
    irrelevantSkillLoads: cases.reduce((total, item) => total + item.actual.skills.length, 0),
    ...designMetrics(registry, state),
    cases,
  };
}

export function formatDesignRouting(result, { json = false } = {}) {
  if (json) return JSON.stringify(result);
  return [
    `DESIGN ROUTING ${result.status}`,
    `${result.passed}/${result.evals} evals / ${result.designCapabilities} UI_DESIGN capabilities`,
    `registry ${result.designRegistryBytes} B / skill metadata ${result.designSkillMetadataBytes} B / on-demand ${result.designOnDemandBytes} B`,
    `permanent context delta ${result.permanentContextDelta} B / irrelevant skill loads ${result.irrelevantSkillLoads}`,
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--json')) {
    throw new Error('Usage: npm run quality:design -- [--json]');
  }
  const result = evaluateDesignRouting();
  console.log(formatDesignRouting(result, { json: args.includes('--json') }));
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    await main();
  } catch (error) {
    console.error(`DESIGN ROUTING TOOLING_ERROR\n${error.message}`);
    process.exitCode = 2;
  }
}
