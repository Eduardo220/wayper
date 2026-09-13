import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { digest, exact, sorted } from './wayper-validation-policy.mjs';
import { GRAPH_SCOPE, safeContextPath } from './wayper-graph-corpus.mjs';
import { redactEvidenceText } from './wayper-evidence-receipts.mjs';

export const GRAPH_QUERY_LIMITS = Object.freeze({ bytes: 4096, nodes: 24, edges: 32, paths: 16, references: 24 });
export function canonicalGraphQuery(query, parameters = {}) {
  if (!query || !['query', 'path', 'explain', 'affected'].includes(query.kind) ||
    !exact(query, query.kind === 'path' ? 'kind from to' : 'kind text') ||
    Object.values(query).some((s) => typeof s !== 'string' || !s.trim() || Buffer.byteLength(s) > 500 || s.includes('\0')) ||
    !parameters || Array.isArray(parameters) || Object.keys(parameters).some((k) => !['depth', 'contexts', 'relations', 'dfs'].includes(k)))
    throw new Error('INVALID_GRAPH_QUERY');
  if (parameters.depth !== undefined && (!Number.isInteger(parameters.depth) || parameters.depth < 1 || parameters.depth > 4) ||
    parameters.dfs !== undefined && typeof parameters.dfs !== 'boolean') throw new Error('INVALID_GRAPH_PARAMETERS');
  for (const key of ['contexts', 'relations']) if (parameters[key] !== undefined && (!Array.isArray(parameters[key]) ||
    parameters[key].length > 8 || parameters[key].some((s) => typeof s !== 'string' || !s.trim() || s.length > 80))) throw new Error('INVALID_GRAPH_PARAMETERS');
  if (query.kind !== 'affected' && (parameters.depth !== undefined || parameters.relations !== undefined) ||
    query.kind !== 'query' && (parameters.contexts !== undefined || parameters.dfs !== undefined)) throw new Error('INVALID_GRAPH_PARAMETERS');
  return { query: Object.fromEntries(Object.entries(query).map(([k, v]) => [k, v.trim()])), parameters: {
    ...(query.kind === 'query' ? { dfs: parameters.dfs ?? false, contexts: sorted((parameters.contexts ?? []).map((s) => s.trim())) } : {}),
    ...(query.kind === 'affected' ? { depth: parameters.depth ?? 2, relations: sorted((parameters.relations ?? []).map((s) => s.trim())) } : {}) } };
}
export function graphQueryRequest(input) {
  if (input.scope !== GRAPH_SCOPE) throw new Error('INVALID_GRAPH_SCOPE');
  return { kind: 'GRAPH_QUERY', repository: input.repository, scope: GRAPH_SCOPE, ...canonicalGraphQuery(input.query, input.parameters) };
}
export function graphQueryArgs(request, spec) {
  const { query, parameters: p } = request;
  return [query.kind, ...(query.kind === 'path' ? [query.from, query.to] : [query.text]),
    '--graph', safeContextPath(spec.root, 'graphify-out/graph.json'),
    ...(query.kind === 'query' ? ['--budget', '800', ...(p.dfs ? ['--dfs'] : []), ...p.contexts.flatMap((c) => ['--context', c])] : []),
    ...(query.kind === 'affected' ? ['--depth', String(p.depth), ...p.relations.flatMap((r) => ['--relation', r])] : [])];
}
export function executeGraphQuery({ request, spec }) {
  const command = process.env.GRAPHIFY_BIN || 'graphify'; const args = graphQueryArgs(request, spec);
  const startedAt = new Date().toISOString(); const executionId = crypto.randomUUID();
  const result = spawnSync(command, args, { cwd: spec.root, encoding: 'utf8', maxBuffer: 262_144, timeout: 30_000 });
  const finishedAt = new Date().toISOString();
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal) throw new Error(`GRAPH_QUERY_FAILED:${result.status ?? result.signal}`);
  return { text: result.stdout, execution: { executionId, startedAt, finishedAt, exitCode: result.status,
    queryFingerprint: digest(request), resultFingerprint: digest(result.stdout), stdoutBytes: Buffer.byteLength(result.stdout),
    stderrFingerprint: digest(result.stderr), stderrBytes: Buffer.byteLength(result.stderr), outputPolicy: 'BOUNDED_CACHE' } };
}
export function boundedGraphOutput(output) {
  const value = typeof output === 'string' ? { text: output } : output;
  const clean = redactEvidenceText(String(value?.text ?? ''));
  const bytes = Buffer.byteLength(clean); const bounded = Buffer.from(clean).subarray(0, 2500).toString('utf8');
  const boundedArray = (name) => Array.isArray(value?.[name]) ? value[name].slice(0, GRAPH_QUERY_LIMITS[name])
    .map((item) => redactEvidenceText(typeof item === 'string' ? item : JSON.stringify(item)).slice(0, 160)) : [];
  const truncation = { text: bytes > 2500,
      nodes: (value?.nodes?.length ?? 0) > GRAPH_QUERY_LIMITS.nodes, edges: (value?.edges?.length ?? 0) > GRAPH_QUERY_LIMITS.edges,
      paths: (value?.paths?.length ?? 0) > GRAPH_QUERY_LIMITS.paths, references: (value?.references?.length ?? 0) > GRAPH_QUERY_LIMITS.references };
  const result = { text: bounded, nodes: boundedArray('nodes'), edges: boundedArray('edges'), paths: boundedArray('paths'),
    references: boundedArray('references'), truncation,
    originalBytes: bytes, outputFingerprint: digest({ text: clean, nodes: value?.nodes ?? [], edges: value?.edges ?? [],
      paths: value?.paths ?? [], references: value?.references ?? [] }) };
  result.truncated = Object.values(truncation).some(Boolean);
  for (const name of ['edges', 'nodes', 'paths', 'references']) while (Buffer.byteLength(JSON.stringify(result)) > GRAPH_QUERY_LIMITS.bytes && result[name].length) {
    result[name].pop(); truncation[name] = true; result.truncated = true;
  }
  return JSON.stringify(result);
}
