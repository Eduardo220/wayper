import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceHash, safeEvidencePath } from './wayper-evidence-receipts.mjs';
import { stable } from './wayper-context-identity.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VALIDATION_LEVELS = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
export const PLATFORMS = Object.freeze(['shared', 'android', 'ios', 'web']);
export const OPERATIONS = Object.freeze(['DOC_ONLY', 'TRIVIAL', 'CONFIG', 'TEST_ONLY', 'BUG_FIX', 'FEATURE', 'REFACTOR', 'ARCHITECTURAL', 'CRITICAL_RUNTIME']);
export const CLAIMS = Object.freeze(['RUNTIME', 'RENDERING', 'ASSISTIVE', 'PROCESS_DEATH', 'REMOTE_SERVICE', 'PHYSICAL_DEVICE', 'REAL_SCENARIO', 'WEBGL']);
const TASK_CLASSES = ['TRIVIAL', 'BOUNDED', 'BUG', 'INVESTIGATION', 'ARCHITECTURAL', 'CRITICAL_RUNTIME'];
export const PLAN_ID = /^VP-[a-f0-9]{64}$/;
export const REQUIREMENT_ID = /^VR-[a-f0-9]{24}$/;
export const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === keys.split(' ').sort().join('|');
export const bounded = (value, max = 240) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= max;
export const unique = (items, allowed, max = 64) => Array.isArray(items) && items.length <= max && new Set(items).size === items.length &&
  items.every((item) => typeof item === 'string' && (allowed ? allowed.includes(item) : bounded(item)));
const repos = ['wayper', 'wayper-site'];
export const digest = (value) => evidenceHash(stable(value));
export const sorted = (items) => [...new Set(items)].sort();
export const canonical = (value) => JSON.parse(stable(value));
export const loadValidationRegistry = (root = ROOT) => JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/validation-registry.json'), 'utf8'));
const capabilities = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/ai/capability-registry.json'), 'utf8'));

export function validateValidationRegistry(registry, { checkFiles = true, repositoryDefinitions = [{ id: 'wayper', root: ROOT },
  { id: 'wayper-site', root: path.resolve(ROOT, '../wayper-site') }] } = {}) {
  const errors = [];
  try {
    if (!exact(registry, 'schemaVersion riskFlags checks rules') || registry.schemaVersion !== 1 ||
      !unique(registry.riskFlags) || !registry.riskFlags.length || !Array.isArray(registry.checks) || !Array.isArray(registry.rules) ||
      registry.checks.length > 128 || registry.rules.length > 128) throw new Error('INVALID_REGISTRY_SCHEMA');
    // The existing risk vocabulary is checked against its normative catalog; no new flags inferred.
    const riskCatalog = fs.readFileSync(path.join(ROOT, 'docs/ai/task-classification.md'), 'utf8');
    for (const risk of registry.riskFlags) if (!riskCatalog.includes(`| \`${risk}\` |`)) errors.push(`UNKNOWN_RISK:${risk}`);
    const ids = new Set();
    for (const check of registry.checks) {
      if (!exact(check, 'id repository level type platform command args paths') || !bounded(check.id, 80) || ids.has(check.id) ||
        !repos.includes(check.repository) || !VALIDATION_LEVELS.includes(check.level) || !PLATFORMS.includes(check.platform) ||
        !['COMMAND', 'OWNER_TESTS', 'RUNBOOK'].includes(check.type) || !unique(check.paths) || check.paths.some((p) => !safeEvidencePath(p)) ||
        !Array.isArray(check.args) || check.args.some((arg) => !bounded(arg)) ||
        (check.type === 'COMMAND' ? !['git', 'node', 'npm'].includes(check.command) || !check.args.length : check.command !== null || check.args.length) ||
        check.repository === 'wayper-site' && ['android', 'ios'].includes(check.platform) ||
        ['L5', 'L6'].includes(check.level) && check.type !== 'RUNBOOK' ||
        check.type === 'OWNER_TESTS' && !['L1', 'L2'].includes(check.level)) throw new Error('INVALID_OR_DUPLICATE_CHECK');
      ids.add(check.id);
      const root = repositoryDefinitions.find((repo) => repo.id === check.repository)?.root;
      if (!checkFiles || !root || !fs.existsSync(root)) continue; // Optional sibling unavailable; assessment cannot claim its checks ran.
      for (const p of check.paths) if (!fs.existsSync(path.join(root, p))) errors.push(`MISSING_CHECK_PATH:${check.id}:${p}`);
      if (check.command === 'npm') {
        const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
        const script = check.args[0] === 'run' ? check.args[1] : check.args[0];
        if (!scripts[script]) errors.push(`MISSING_NPM_SCRIPT:${check.id}`);
      }
    }
    const catalog = capabilities(); const ruleIds = new Set(); const definitions = new Set();
    const allowed = { operations: OPERATIONS, taskClasses: TASK_CLASSES, capabilities: catalog.capabilities.map((c) => c.id), domains: catalog.domains,
      risks: registry.riskFlags, claims: CLAIMS, pathPatterns: null };
    for (const rule of registry.rules) {
      if (!exact(rule, 'id when repositories checks') || !bounded(rule.id, 80) || ruleIds.has(rule.id) ||
        !unique(rule.repositories, repos) || !rule.repositories.length || !unique(rule.checks, [...ids]) || !rule.checks.length ||
        !rule.when || !Object.keys(rule.when).length || Object.entries(rule.when).some(([key, values]) =>
          !Object.hasOwn(allowed, key) || !unique(values, allowed[key]) || !values.length)) throw new Error('INVALID_OR_DUPLICATE_RULE');
      for (const pattern of rule.when.pathPatterns ?? []) if (!pattern.startsWith('^') || !new RegExp(pattern)) throw new Error('INVALID_PATH_PATTERN');
      if (rule.checks.some((id) => !rule.repositories.includes(registry.checks.find((c) => c.id === id).repository))) throw new Error('CROSS_REPO_RULE');
      if (rule.when.claims?.every((claim) => claim === 'WEBGL') && !rule.repositories.includes('wayper-site')) throw new Error('IMPOSSIBLE_RULE');
      const definition = stable({ when: Object.fromEntries(Object.entries(rule.when).map(([key, values]) => [key, sorted(values)])),
        repositories: sorted(rule.repositories) });
      if (definitions.has(definition)) throw new Error('CONFLICTING_RULE');
      definitions.add(definition); ruleIds.add(rule.id);
    }
  } catch (error) { errors.push(error.message); }
  return { status: errors.length ? 'INVALID_REGISTRY' : 'VALID', errors };
}

export function normalizeValidationInputs(input, registry) {
  const fail = () => { const error = new Error('PLAN_INPUT_INCOMPLETE: explicit valid operation, scope, capabilities, risks and platforms required');
    error.code = 'PLAN_INPUT_INCOMPLETE'; throw error; };
  const catalog = capabilities();
  if (!exact(input, 'operation taskClass repositories criteria') || !OPERATIONS.includes(input.operation) ||
    !TASK_CLASSES.includes(input.taskClass) ||
    !Array.isArray(input.repositories) || !input.repositories.length || input.repositories.length > 2 ||
    new Set(input.repositories.map((r) => r.repository)).size !== input.repositories.length ||
    !Array.isArray(input.criteria) || input.criteria.length > 32) fail();
  const normalized = structuredClone(input);
  for (const repo of normalized.repositories) {
    if (!exact(repo, 'repository platforms changedPaths capabilities risks testTargets') || !repos.includes(repo.repository) ||
      !unique(repo.platforms, PLATFORMS, 4) || !repo.platforms.length || !unique(repo.changedPaths, null, 128) ||
      !repo.changedPaths.length || repo.changedPaths.some((p) => !safeEvidencePath(p)) ||
      !unique(repo.capabilities, catalog.capabilities.map((c) => c.id)) ||
      !['DOC_ONLY', 'TRIVIAL'].includes(input.operation) && !repo.capabilities.length || !unique(repo.risks, registry.riskFlags) ||
      input.operation === 'TRIVIAL' && repo.risks.some((risk) => !['DOCUMENTATION', 'UI_UX'].includes(risk)) ||
      !exact(repo.testTargets, 'L1 L2') || Object.values(repo.testTargets).some((targets) =>
        !unique(targets, null, 16) || targets.some((p) => !safeEvidencePath(p) || !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p))) ||
      repo.testTargets.L1.some((p) => repo.testTargets.L2.includes(p)) ||
      repo.testTargets.L2.some((p) => !registry.checks.some((c) => c.repository === repo.repository &&
        c.type === 'OWNER_TESTS' && c.level === 'L2' && c.paths.includes(p))) ||
      repo.repository === 'wayper-site' && repo.platforms.some((p) => ['android', 'ios'].includes(p)) ||
      !['DOC_ONLY', 'TRIVIAL'].includes(input.operation) && (repo.risks.includes('NATIVE_ANDROID') && !repo.platforms.includes('android') ||
        repo.risks.includes('LIFECYCLE') && repo.platforms.every((platform) => platform === 'shared')) ||
      repo.changedPaths.some((p) => /^android\//.test(p)) && !repo.platforms.includes('android') ||
      input.operation === 'DOC_ONLY' && repo.changedPaths.some((p) => !/\.(?:md|txt|rst)$/.test(p))) fail();
    for (const key of ['platforms', 'changedPaths', 'capabilities', 'risks']) repo[key].sort();
    for (const targets of Object.values(repo.testTargets)) targets.sort();
  }
  const ids = new Set();
  for (const c of normalized.criteria) {
    const repo = normalized.repositories.find((r) => r.repository === c.repository);
    if (!exact(c, 'id repository platform claim required blocking') || !bounded(c.id, 80) || ids.has(c.id) ||
      !repo || !repo.platforms.includes(c.platform) || !CLAIMS.includes(c.claim) ||
      typeof c.required !== 'boolean' || typeof c.blocking !== 'boolean' || c.blocking && !c.required ||
      c.claim === 'WEBGL' && (c.repository !== 'wayper-site' || c.platform !== 'web') ||
      ['PHYSICAL_DEVICE', 'REAL_SCENARIO', 'PROCESS_DEATH'].includes(c.claim) && c.platform === 'shared') fail();
    ids.add(c.id);
  }
  normalized.repositories.sort((a, b) => a.repository.localeCompare(b.repository));
  normalized.criteria.sort((a, b) => a.id.localeCompare(b.id));
  return canonical(normalized);
}

export function matchValidationRule(rule, input, repo, criterion) {
  const catalog = capabilities();
  const facts = [];
  const sources = { operations: [input.operation], taskClasses: [input.taskClass], capabilities: repo.capabilities, risks: repo.risks,
    domains: repo.capabilities.map((id) => catalog.capabilities.find((c) => c.id === id).domain),
    claims: criterion ? [criterion.claim] : [] };
  const names = { operations: 'operation', taskClasses: 'taskClass', capabilities: 'capability', risks: 'risk', domains: 'domain', claims: 'criterion' };
  for (const [key, expected] of Object.entries(rule.when)) {
    const matches = key === 'pathPatterns' ? repo.changedPaths.filter((p) => expected.some((re) => new RegExp(re).test(p))) :
      sources[key].filter((v) => expected.includes(v));
    if (!matches.length) return null;
    facts.push(...matches.map((v) => `${names[key] ?? 'path'}:${v}`));
  }
  return { ruleId: rule.id, facts: sorted(facts) };
}

export function candidateCheck(check, repo, repositories) {
  const root = repositories.find((r) => r.id === repo.repository)?.root;
  const exists = (paths) => Boolean(root && paths.every((p) => fs.existsSync(path.join(root, p))));
  if (check.type !== 'OWNER_TESTS') {
    let available = exists(check.paths);
    if (check.command === 'npm') {
      try { const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
        available &&= Boolean(scripts[check.args[0] === 'run' ? check.args[1] : check.args[0]]); }
      catch { available = false; }
    }
    return { ...check, available };
  }
  const targets = repo.testTargets[check.level];
  const nodeTests = targets.length > 0 && targets.every((p) => p.endsWith('.mjs'));
  return { ...check, type: targets.length ? 'COMMAND' : 'OWNER_TESTS', command: targets.length ? nodeTests ? 'node' : 'npm' : null,
    args: !targets.length ? [] : nodeTests ? ['--test', ...targets] : repo.repository === 'wayper' ?
      ['test', '--', '--runTestsByPath', ...targets] : ['test', '--', ...targets], paths: targets,
    available: Boolean(targets.length && exists(targets)) };
}
