import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectGraphFreshness, ensureGraphFresh, freshGraph } from '../wayper-graph.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const WORKSPACE_ROOT = path.resolve(ROOT, '..');
const FORBIDDEN_DIRECTORIES = new Set(['backups', 'backup', 'clones', 'debug-clones']);
const CODE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.cxx', '.go', '.h', '.hpp', '.java', '.js', '.jsx',
  '.json', '.kt', '.kts', '.mjs', '.cjs', '.php', '.py', '.rb', '.rs', '.sh',
  '.sql', '.svelte', '.swift', '.ts', '.tsx', '.vue',
]);

export const GRAPH_SPECS = {
  mobile: {
    repository: 'wayper',
    root: ROOT,
    peerDirectory: 'wayper-site',
    querySymbols: ['MapScreen'],
  },
  site: {
    repository: 'wayper-site',
    root: path.resolve(ROOT, '../wayper-site'),
    peerDirectory: 'wayper',
    querySymbols: ['WayperCanvas'],
  },
};


function normalizeSource(source, spec) {
  if (typeof source !== 'string' || !source || path.isAbsolute(source)) {
    throw new Error(`${spec.repository}: invalid graph source path: ${source}`);
  }
  const normalized = source.replaceAll('\\', '/').replace(/^\.\//, '');
  const parts = normalized.split('/');
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    parts[0] === spec.peerDirectory ||
    parts.some((part) => FORBIDDEN_DIRECTORIES.has(part.toLowerCase()))
  ) {
    throw new Error(`${spec.repository}: contaminated graph source: ${source}`);
  }
  const resolved = path.resolve(spec.root, normalized);
  if (resolved !== spec.root && !resolved.startsWith(`${spec.root}${path.sep}`)) {
    throw new Error(`${spec.repository}: graph source escapes repository: ${source}`);
  }
  return normalized;
}

function graphSources(graph, spec) {
  const sources = new Set();
  for (const item of [
    ...(graph.nodes ?? []),
    ...(graph.links ?? graph.edges ?? []),
    ...(graph.hyperedges ?? []),
  ]) {
    if (!item.source_file) continue;
    const source = normalizeSource(item.source_file, spec);
    if (fs.statSync(path.resolve(spec.root, source), { throwIfNoEntry: false })?.isFile()) {
      if (!CODE_EXTENSIONS.has(path.extname(source).toLowerCase())) {
        throw new Error(`${spec.repository}: non-code source in code-only graph: ${source}`);
      }
      sources.add(source);
    }
  }
  return [...sources].sort();
}

function hashSources(spec, sources) {
  const hash = crypto.createHash('sha256');
  for (const source of sources) {
    const file = path.resolve(spec.root, source);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`${spec.repository}: missing indexed source: ${source}`);
    }
    hash.update(source).update('\0').update(fs.readFileSync(file)).update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function fingerprintCorpus(spec) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: spec.root, encoding: 'utf8' }
  ).split('\0').filter(Boolean).filter((source) => {
    const parts = source.replaceAll('\\', '/').split('/');
    return CODE_EXTENSIONS.has(path.extname(source).toLowerCase()) &&
      !parts.some((part) => FORBIDDEN_DIRECTORIES.has(part.toLowerCase()));
  }).sort();
  return { files, fingerprint: hashSources(spec, files) };
}

function graphMetrics(graph, spec) {
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new Error(`${spec.repository}: graph has no nodes`);
  }
  const links = graph.links ?? graph.edges;
  if (!Array.isArray(links) || links.length === 0) {
    throw new Error(`${spec.repository}: graph has no edges`);
  }
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node?.id || ids.has(node.id)) {
      throw new Error(`${spec.repository}: invalid or duplicate graph node: ${node?.id}`);
    }
    ids.add(node.id);
  }
  for (const link of links) {
    if (!ids.has(link?.source) || !ids.has(link?.target)) {
      throw new Error(`${spec.repository}: dangling graph edge: ${link?.source} -> ${link?.target}`);
    }
  }
  for (const symbol of spec.querySymbols) {
    const query = symbol.toLowerCase();
    if (!graph.nodes.some((node) => {
      const label = node.label?.toLowerCase();
      return label === query || label === `${query}()` || label === `${query}.js` ||
        label === `${query}.jsx` || label === `${query}.ts` || label === `${query}.tsx`;
    })) {
      throw new Error(`${spec.repository}: query symbol not found: ${symbol}`);
    }
  }
  const sources = graphSources(graph, spec);
  if (sources.length === 0) throw new Error(`${spec.repository}: graph has no source files`);
  const communities = new Set(
    graph.nodes.map((node) => node.community).filter((value) => value !== undefined)
  );
  return {
    files: sources.length,
    nodes: graph.nodes.length,
    edges: links.length,
    communities: communities.size,
    sources,
  };
}

export function validateGraphScope(graph, spec) { return graphMetrics(graph, spec); }

export function validateScope(spec) {
  const result = inspectGraphFreshness(spec);
  if (!freshGraph(result.status)) throw new Error(`${spec.repository}: ${result.status}: ${result.reason}`);
  return { ...result.metrics, ...result.metadata, freshness: result.status };
}

function selectedSpecs(target = 'all') {
  if (target === 'all') return Object.values(GRAPH_SPECS);
  if (!GRAPH_SPECS[target]) throw new Error('Target must be mobile, site, or all');
  return [GRAPH_SPECS[target]];
}

function validateNoMixedFallback() {
  const mixedGraph = path.join(WORKSPACE_ROOT, 'graphify-out/graph.json');
  if (fs.existsSync(mixedGraph)) {
    throw new Error(`Mixed workspace graph remains an active fallback: ${mixedGraph}`);
  }
}

function graphSummary(result) {
  const paths = (name) => ({ count: result[name]?.length ?? 0, paths: (result[name] ?? []).slice(0, 24),
    truncated: (result[name]?.length ?? 0) > 24 });
  return { repository: result.repository, scope: result.scope, status: result.status, reason: result.reason,
    action: result.action, head: result.head, branch: result.branch,
    corpus: result.corpus && { files: result.corpus.files.length, corpusFingerprint: result.corpus.corpusFingerprint,
      scopeFingerprint: result.corpus.scopeFingerprint, version: result.corpus.version, incremental: result.corpus.incremental },
    graphFingerprint: result.graphFingerprint, missing: paths('missingPaths'), extra: paths('extraPaths'),
    changed: paths('changedPaths'), metrics: result.metrics, metadata: result.metadata };
}

async function main() {
  const [command = 'validate', target = 'mobile', ...rest] = process.argv.slice(2);
  if (rest.some((arg) => arg !== '--allow-dirty') || !['build', 'update', 'validate', 'metrics', 'inspect'].includes(command)) {
    throw new Error('Usage: check-graph-scopes.mjs <build|update|validate|metrics> [mobile|site|all]');
  }
  for (const spec of selectedSpecs(target)) {
    const result = command === 'build' || command === 'update'
      ? ensureGraphFresh(spec, { allowDirty: rest.includes('--allow-dirty') })
      : command === 'inspect' ? inspectGraphFreshness(spec) : validateScope(spec);
    if (command === 'inspect' || command === 'build' || command === 'update') {
      console.log(JSON.stringify(graphSummary(result), null, 2));
      if (command !== 'inspect' && !freshGraph(result.status)) process.exitCode = 2;
      continue;
    }
    console.log(
      `GRAPH SCOPE ${spec.repository} PASS / ${result.files} files / ` +
      `${result.nodes} nodes / ${result.edges} edges / ${result.communities} communities`
    );
  }
  validateNoMixedFallback();
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    await main();
  } catch (error) {
    console.error(`GRAPH SCOPE TOOLING_ERROR\n${error.message}`);
    process.exitCode = 2;
  }
}
