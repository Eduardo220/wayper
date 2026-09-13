import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { safeContextPath, hashBytes } from './wayper-graph-corpus.mjs';
import { contextOwner } from './wayper-context-economy.mjs';
import { repositorySnapshot, stable } from './wayper-context-identity.mjs';
import { digest, exact } from './wayper-validation-policy.mjs';

export function dispatchOwner(options, repository, scopes = []) {
  const owner = contextOwner(options);
  const repo = owner.repositories.find(r => r.id === repository);
  if (!repo) throw new Error('WRONG_REPOSITORY');
  const snapshot = repositorySnapshot(repo);
  const baseline = owner.state.execution.baseline.repositories.find(r => r.repositoryId === repository);
  if (baseline?.checkoutFingerprint !== snapshot.checkoutFingerprint) throw new Error('WRONG_REPOSITORY');
  const stateFingerprint = bindingFingerprint({ repo, snapshot }, scopes);
  return { ...owner, repo, snapshot, stateFingerprint };
}
export function scopesFor(repo, scopes) {
  if (!Array.isArray(scopes) || !scopes.length || scopes.length > 32) throw new Error('INVALID_SCOPE');
  const result = scopes.map(s => {
    if (!exact(s, 'kind path') || !['REPOSITORY', 'PATH_PREFIX', 'FILE'].includes(s.kind)) throw new Error('INVALID_SCOPE');
    if (s.kind === 'REPOSITORY') { if (s.path !== '.') throw new Error('INVALID_SCOPE'); return s; }
    if (s.path.includes('\0') || ['.git', '.wayper-context'].includes(s.path.split('/')[0])) throw new Error('UNSAFE_SCOPE');
    const target = safeContextPath(repo.root, s.path, { missing: true });
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (stat && (s.kind === 'FILE' ? !stat.isFile() : !stat.isDirectory())) throw new Error('INVALID_SCOPE_TYPE');
    return s;
  });
  return [...new Map(result.map(s => [stable(s), s])).values()].sort((a,b) => stable(a).localeCompare(stable(b)));
}
export const contains = (scope, file) => scope.kind === 'REPOSITORY' || scope.path === file ||
  scope.kind === 'PATH_PREFIX' && file.startsWith(`${scope.path}/`);
export const overlap = (a, b) => a.some(x => b.some(y => contains(x, y.path) || contains(y, x.path)));
function scopedFiles(repo, scopes) {
  const files = new Set();
  const visit = file => {
    if (files.size >= 4096) throw new Error('SCOPE_STATE_BUDGET_EXCEEDED');
    const target = safeContextPath(repo.root, file, { missing: true });
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (stat?.isDirectory()) for (const child of fs.readdirSync(target).sort()) visit(`${file}/${child}`);
    else files.add(file);
  };
  for (const scope of scopes.filter(s => s.kind !== 'REPOSITORY')) visit(scope.path);
  return [...files].sort();
}
const hashes = (repo, files) => Object.fromEntries(files.map(file => {
  const target = safeContextPath(repo.root, file, { missing: true });
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  return [file, !stat ? null : stat.isFile() ? digest([stat.mode, hashBytes(fs.readFileSync(target))]) : 'NON_FILE'];
}));
export function bindingFingerprint(owner, scopes) {
  return digest({ repository: owner.snapshot.contentFingerprint, scope: hashes(owner.repo, scopedFiles(owner.repo, scopes)) });
}
export function fileState(repo, scopes = []) {
  const git = (...args) => execFileSync('git', args, { cwd: repo.root, encoding: 'utf8', maxBuffer: 16_777_216 });
  const files = [...new Set([...git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean), ...scopedFiles(repo, scopes)])].sort();
  return hashes(repo, files);
}
export const changedPaths = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])]
  .filter(p => before[p] !== after[p]).sort();
