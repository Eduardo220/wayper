import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digest, sorted } from './wayper-validation-policy.mjs';

export const GRAPH_SCOPE = 'repository-code-only';
export const hashBytes = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
export const graphGit = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
export function safeContextPath(root, relative, { missing = false } = {}) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') ||
    relative.split('/').some((p) => !p || p === '.' || p === '..')) throw new Error('UNSAFE_CONTEXT_PATH');
  let current = fs.realpathSync(root);
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error('UNSAFE_CONTEXT_SYMLINK');
    if (!stat && !missing) throw new Error('CONTEXT_PATH_MISSING');
  }
  return current;
}
export function assertGraphSpec(spec) {
  if (!['wayper', 'wayper-site'].includes(spec.repository) || !path.isAbsolute(spec.root) ||
    fs.realpathSync(spec.root) !== path.resolve(spec.root) ||
    fs.realpathSync(graphGit(spec.root, 'rev-parse', '--show-toplevel')) !== spec.root) throw new Error('INVALID_GRAPH_REPOSITORY');
}
export function detectGraphCorpus(spec) {
  const bin = process.env.GRAPHIFY_BIN || 'graphify';
  let executable;
  if (path.isAbsolute(bin)) executable = bin;
  else executable = (process.env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, bin)).find((p) => fs.existsSync(p));
  if (!executable) throw new Error('GRAPHIFY_UNAVAILABLE');
  const interpreter = fs.readFileSync(executable, 'utf8').split('\n', 1)[0].replace(/^#!/, '').trim();
  if (!path.isAbsolute(interpreter) || /\s/.test(interpreter)) throw new Error('GRAPHIFY_INTERPRETER_UNAVAILABLE');
  const adapter = fileURLToPath(new URL('./wayper-graph-detect.py', import.meta.url));
  return JSON.parse(execFileSync(interpreter, [adapter, spec.root], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }));
}
export function graphCorpus(spec, detector = detectGraphCorpus) {
  assertGraphSpec(spec);
  const detected = detector(spec);
  if (!Array.isArray(detected.files) || !/^sha256:[a-f0-9]{64}$/.test(detected.scopeFingerprint)) throw new Error('INVALID_GRAPH_CORPUS');
  const files = sorted(detected.files).map((relative) => {
    if (relative.split('/').some((p) => ['.git', '.wayper-context', 'graphify-out', 'backup', 'backups', 'clones', 'debug-clones',
      spec.repository === 'wayper' ? 'wayper-site' : 'wayper'].includes(p.toLowerCase()))) throw new Error('INVALID_GRAPH_CORPUS_PATH');
    const bytes = fs.readFileSync(safeContextPath(spec.root, relative));
    return { path: relative, fingerprint: hashBytes(bytes), md5: crypto.createHash('md5').update(bytes).digest('hex') };
  });
  return { files, scopeFingerprint: detected.scopeFingerprint, corpusFingerprint: digest({ scope: detected.scopeFingerprint,
    files: files.map(({ path, fingerprint }) => ({ path, fingerprint })) }), version: detected.version,
    incremental: detected.incremental === true, ignored: detected.ignored ?? [] };
}
