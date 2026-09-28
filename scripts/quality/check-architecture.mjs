import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const BASELINE_PATH = path.join(ROOT, 'scripts/quality/architecture-baseline.json');
const ROOT_PRODUCTION_FILES = new Set(['App.js', 'googleAuth.js', 'index.js']);
const TEST_PATH = /(^|\/)(__fixtures__|__tests__)(\/|$)|\.(test|spec)\.(js|jsx|mjs)$/;
const SOURCE_EXTENSION = /\.(js|jsx|mjs)$/;
const UI_PATH = /^src\/(components|hooks|screens)\//;
const DOMAIN_PATH = /^src\/(config|repositories|services|storage|tasks|utils)\//;
const UI_TARGET_PATH = /^src\/(components|navigation|screens)\//;
const LOW_LEVEL_STORAGE_PACKAGES = new Set(['@react-native-async-storage/async-storage']);
const RAW_STORAGE_PACKAGES = new Set([
  '@react-native-async-storage/async-storage',
  'expo-file-system',
  'expo-file-system/legacy',
  'expo-sqlite',
]);
const LOW_LEVEL_STORAGE_TARGETS = new Set([
  'src/services/runOfflineStorageService.js',
  'src/services/territory/territoryStorageService.js',
  'src/storage/zonesStorage.js',
  'src/utils/sync.js',
]);
const LEGACY_TARGETS = new Set([
  'src/services/runService.js',
  'src/services/xp/xpService.js',
  'src/services/zones/zoneService.js',
  'src/storage/zonesStorage.js',
]);
const UI_RUNTIME_INTERNALS = new Set([
  'src/services/run/runNotificationService.js',
  'src/services/runTracking/activeRunState.js',
  'src/services/tracking/expoLocation.js',
  'src/services/tracking/pointFilters.js',
  'src/tasks/activeRunLocationTask.js',
]);
const CRITICAL_RUN_ROOTS = [
  'src/services/run/runAutoSaveService.js',
  'src/services/run/runFinalizationService.js',
  'src/services/run/runNotificationService.js',
  'src/services/run/runRecoveryService.js',
  'src/services/runTracking/activeRunRuntimeService.js',
  'src/services/runTracking/activeRunTrackingService.js',
  'src/tasks/activeRunLocationTask.js',
];

export const ARCHITECTURE_CATEGORIES = [
  ['uiFirestoreImports', 'ui -> firestore'],
  ['uiLowLevelStorageImports', 'ui -> low-level storage'],
  ['domainToUiImports', 'domain -> ui'],
  ['uiRuntimeInternalImports', 'ui -> runtime internals'],
  ['uiTurfImports', 'ui -> turf'],
  ['legacyModuleImports', 'new -> legacy modules'],
  ['runCriticalFirestoreImports', 'critical run -> firestore'],
  ['firestoreOwnerImports', 'firestore import owners'],
  ['rawStorageOwnerImports', 'raw storage import owners'],
];

const linter = new Linter({ configType: 'flat' });

export function isProductionFile(file) {
  return (
    SOURCE_EXTENSION.test(file) &&
    !TEST_PATH.test(file) &&
    (ROOT_PRODUCTION_FILES.has(file) || file.startsWith('src/'))
  );
}

function staticValue(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }
  return undefined;
}

function importReferences(source, file) {
  const messages = linter.verify(
    source,
    [
      {
        languageOptions: {
          ecmaVersion: 'latest',
          parserOptions: { ecmaFeatures: { jsx: true } },
          sourceType: 'module',
        },
        linterOptions: { noInlineConfig: true },
      },
    ],
    { filename: file }
  );
  const parseFailure = messages.find((message) => message.fatal);
  if (parseFailure) throw new Error(`${file}: ${parseFailure.message}`);

  const references = [];
  const seen = new WeakSet();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') {
      references.push({
        source: node.source.value,
        kind: node.type === 'ImportDeclaration' ? 'import' : 'export',
        line: node.loc.start.line,
        importedNames: (node.specifiers ?? [])
          .map((specifier) => specifier.imported?.name)
          .filter(Boolean),
      });
    } else if (node.type === 'ExportNamedDeclaration' && node.source) {
      references.push({ source: node.source.value, kind: 'export', line: node.loc.start.line });
    } else if (node.type === 'ImportExpression') {
      const value = staticValue(node.source);
      if (value) references.push({ source: value, kind: 'dynamic-import', line: node.loc.start.line });
    } else if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'require'
    ) {
      const value = staticValue(node.arguments[0]);
      if (value) references.push({ source: value, kind: 'require', line: node.loc.start.line });
    }

    for (const [key, value] of Object.entries(node)) {
      if (key !== 'parent' && key !== 'tokens' && key !== 'comments') {
        if (Array.isArray(value)) value.forEach(walk);
        else walk(value);
      }
    }
  };
  walk(linter.getSourceCode().ast);
  return references;
}

function resolveLocalImport(file, specifier, files) {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/index.mjs`,
  ];
  return candidates.find((candidate) => files.has(candidate)) ?? base;
}

function finding(file, reference, resolved, extra = {}) {
  return { path: file, line: reference.line, source: reference.source, resolved, kind: reference.kind, ...extra };
}

function dedupe(items) {
  const unique = new Map();
  for (const item of items) {
    unique.set(`${item.path}:${item.line}:${item.source}:${item.kind}`, item);
  }
  return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

export function analyzeArchitecture(sources, criticalRoots = CRITICAL_RUN_ROOTS) {
  const production = Object.fromEntries(
    Object.entries(sources).filter(([file]) => isProductionFile(file))
  );
  const files = new Set(Object.keys(production));
  const references = new Map();
  for (const [file, source] of Object.entries(production)) {
    references.set(
      file,
      importReferences(source, file).map((reference) => ({
        ...reference,
        resolved: resolveLocalImport(file, reference.source, files),
      }))
    );
  }

  const findings = Object.fromEntries(ARCHITECTURE_CATEGORIES.map(([id]) => [id, []]));
  for (const [file, items] of references) {
    for (const reference of items) {
      const item = finding(file, reference, reference.resolved);
      if (UI_PATH.test(file) && reference.source === 'firebase/firestore') {
        findings.uiFirestoreImports.push(item);
      }
      if (
        UI_PATH.test(file) &&
        (LOW_LEVEL_STORAGE_PACKAGES.has(reference.source) ||
          LOW_LEVEL_STORAGE_TARGETS.has(reference.resolved))
      ) {
        findings.uiLowLevelStorageImports.push(item);
      }
      if (DOMAIN_PATH.test(file) && reference.resolved && UI_TARGET_PATH.test(reference.resolved)) {
        findings.domainToUiImports.push(item);
      }
      if (
        UI_PATH.test(file) &&
        (reference.source === 'expo-task-manager' ||
          UI_RUNTIME_INTERNALS.has(reference.resolved) ||
          (reference.source === 'react-native' && reference.importedNames?.includes('NativeModules')))
      ) {
        findings.uiRuntimeInternalImports.push(item);
      }
      if (UI_PATH.test(file) && reference.source === '@turf/turf') {
        findings.uiTurfImports.push(item);
      }
      if (LEGACY_TARGETS.has(reference.resolved)) findings.legacyModuleImports.push(item);
      if (reference.source === 'firebase/firestore') findings.firestoreOwnerImports.push(item);
      if (RAW_STORAGE_PACKAGES.has(reference.source)) findings.rawStorageOwnerImports.push(item);
    }
  }

  for (const file of criticalRoots.filter((root) => references.has(root))) {
    for (const reference of references.get(file) ?? []) {
      if (reference.source === 'firebase/firestore' || reference.resolved === 'src/firebaseConfig.js') {
        findings.runCriticalFirestoreImports.push(finding(file, reference, reference.resolved));
      }
    }
  }

  return Object.fromEntries(Object.entries(findings).map(([id, items]) => [id, dedupe(items)]));
}

function invalidBaselineFailures(baseline) {
  const failures = [];
  const expected = new Set(ARCHITECTURE_CATEGORIES.map(([id]) => id));
  if (baseline?.version !== 1 || typeof baseline.categories !== 'object') {
    return [{ type: 'INVALID_BASELINE', message: 'Unsupported architecture baseline schema' }];
  }
  for (const id of expected) {
    const category = baseline.categories[id];
    if (
      !category ||
      typeof category.legacy !== 'object' ||
      typeof category.allowed !== 'object' ||
      !Array.isArray(category.exceptions)
    ) {
      failures.push({ type: 'INVALID_BASELINE', category: id, message: 'Missing category' });
      continue;
    }
    for (const [file, max] of Object.entries(category.legacy)) {
      if (!isProductionFile(file) || !Number.isInteger(max) || max <= 0) {
        failures.push({ type: 'INVALID_BASELINE', category: id, path: file, message: 'Invalid legacy entry' });
      }
    }
    for (const [file, max] of Object.entries(category.allowed)) {
      if (!isProductionFile(file) || !Number.isInteger(max) || max <= 0) {
        failures.push({ type: 'INVALID_BASELINE', category: id, path: file, message: 'Invalid allowed entry' });
      }
    }
    for (const exception of category.exceptions) {
      const values = [exception?.boundary, exception?.reason, exception?.owner, exception?.reviewCondition];
      if (
        !isProductionFile(exception?.path ?? '') ||
        /[*?\[\]{}]/.test(exception.path) ||
        !Number.isInteger(exception.max) ||
        exception.max <= 0 ||
        values.some((value) => typeof value !== 'string' || value.trim() === '')
      ) {
        failures.push({ type: 'INVALID_EXCEPTION', category: id, path: exception?.path });
      }
    }
  }
  for (const id of Object.keys(baseline.categories)) {
    if (!expected.has(id)) failures.push({ type: 'INVALID_BASELINE', category: id, message: 'Unknown category' });
  }
  return failures;
}

export function evaluateArchitecture(findings, baseline) {
  const failures = invalidBaselineFailures(baseline);
  const improvements = [];
  const summaries = {};
  if (failures.length) return { pass: false, failures, improvements, summaries };

  for (const [id] of ARCHITECTURE_CATEGORIES) {
    const counts = {};
    for (const item of findings[id] ?? []) counts[item.path] = (counts[item.path] ?? 0) + 1;
    const { legacy, allowed, exceptions } = baseline.categories[id];
    const exceptionByPath = new Map(exceptions.map((exception) => [exception.path, exception]));
    let legacyCount = 0;
    let allowedCount = 0;

    for (const [file, count] of Object.entries(counts)) {
      if (legacy[file] !== undefined) {
        legacyCount += count;
        if (count > legacy[file]) {
          failures.push({ type: 'LEGACY_REGRESSION', category: id, path: file, baseline: legacy[file], current: count });
        } else if (count < legacy[file]) {
          improvements.push({ category: id, path: file, baseline: legacy[file], current: count });
        }
      } else if (allowed[file] !== undefined) {
        allowedCount += count;
        if (count > allowed[file]) failures.push({ type: 'APPROVED_OWNER_REGRESSION', category: id, path: file, baseline: allowed[file], current: count });
      } else if (exceptionByPath.has(file)) {
        allowedCount += count;
        const limit = exceptionByPath.get(file).max;
        if (count > limit) failures.push({ type: 'EXCEPTION_REGRESSION', category: id, path: file, baseline: limit, current: count });
      } else {
        failures.push({ type: 'NEW_VIOLATION', category: id, path: file, current: count });
      }
    }
    for (const [file, max] of Object.entries(legacy)) {
      if (!(file in counts)) improvements.push({ category: id, path: file, baseline: max, current: 0 });
    }
    summaries[id] = { legacy: legacyCount, allowed: allowedCount };
  }
  return { pass: failures.length === 0, failures, improvements, summaries };
}

export function parseCliArgs(args) {
  if (args.some((arg) => arg !== '--details')) {
    throw new Error('Usage: npm run quality:architecture -- [--details]');
  }
  return { details: args.includes('--details') };
}

function listProductionFiles() {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'App.js', 'googleAuth.js', 'index.js', 'src'],
    { cwd: ROOT, encoding: 'utf8' }
  )
    .split('\0')
    .filter(isProductionFile)
    .sort();
}

function main() {
  try {
    const { details } = parseCliArgs(process.argv.slice(2));
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    const sources = Object.fromEntries(
      listProductionFiles().map((file) => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')])
    );
    const findings = analyzeArchitecture(sources);
    const result = evaluateArchitecture(findings, baseline);

    console.log(`ARCHITECTURE ${result.pass ? 'PASS' : 'FAIL'}`);
    for (const [id, label] of ARCHITECTURE_CATEGORIES) {
      const summary = result.summaries[id] ?? { legacy: 0, allowed: 0 };
      const regressions = result.failures.filter((failure) => failure.category === id).length;
      console.log(`${label}: ${summary.legacy} legacy / ${summary.allowed} allowed / ${regressions} regressions`);
    }
    if (details) {
      for (const [id] of ARCHITECTURE_CATEGORIES) {
        for (const item of findings[id]) console.log(`${id} ${item.path}:${item.line} ${item.kind} ${item.source}`);
      }
      for (const item of result.improvements) console.log(`IMPROVED ${item.category} ${item.path} ${item.baseline} -> ${item.current}`);
    }
    for (const failure of result.failures) {
      console.error(`FAIL ${failure.category ?? 'baseline'} ${failure.path ?? ''} ${failure.type}`.trim());
    }
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) main();
