import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HASH = /^sha256:[a-f0-9]{64}$/;
const RUN_ID = /^gr-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const git = (root, args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024,
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const exactKeys = (value, keys) => value && !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');

export function assertIdentity(identity) {
  if (!exactKeys(identity, ['schemaVersion', 'threadId', 'goalRunId', 'revision']) ||
    identity.schemaVersion !== 1 || typeof identity.threadId !== 'string' ||
    !identity.threadId.trim() || Buffer.byteLength(identity.threadId) > 200 ||
    !RUN_ID.test(identity.goalRunId) || !Number.isSafeInteger(identity.revision) || identity.revision < 1) {
    throw new Error('Explicit Goal execution identity required');
  }
}

export function goalReference(identity) {
  assertIdentity(identity);
  return `${identity.goalRunId}.r${identity.revision}`;
}

export function assertSameIdentity(actual, expected) {
  assertIdentity(actual);
  assertIdentity(expected);
  if (stable(actual) !== stable(expected)) throw new Error('Goal execution identity mismatch');
}

export function repositorySnapshot(repository) {
  const { id, root } = repository;
  if (!['wayper', 'wayper-site'].includes(id) || !path.isAbsolute(root)) throw new Error('Invalid baseline repository');
  const realRoot = fs.realpathSync(root);
  if (fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) !== realRoot) {
    throw new Error('Baseline requires a repository root');
  }
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort();
  const untrackedHashes = untracked.map((file) => {
    const resolved = path.resolve(realRoot, file);
    if (!resolved.startsWith(`${realRoot}${path.sep}`)) throw new Error('Baseline path escapes repository');
    const stat = fs.lstatSync(resolved);
    // Hash symlink identity, never read its target (which may be outside the repository).
    return [file, stat.mode, hash(stat.isSymbolicLink() ? fs.readlinkSync(resolved) : fs.readFileSync(resolved))];
  });
  const contentFingerprint = hash(stable({ head, status,
    index: git(root, ['ls-files', '--stage', '-z']),
    diff: git(root, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--']), untrackedHashes }));
  return { repositoryId: id, checkoutFingerprint: hash(realRoot),
    branch: git(root, ['branch', '--show-current']).trim() || null, head,
    dirty: status.length > 0, contentFingerprint };
}

export function captureRepositories(repositories) {
  if (!Array.isArray(repositories) || !repositories.length || repositories.length > 2 ||
    new Set(repositories.map((repo) => repo.id)).size !== repositories.length) throw new Error('Invalid baseline repositories');
  return repositories.map(repositorySnapshot).sort((a, b) => a.repositoryId.localeCompare(b.repositoryId));
}

export function baselineFor(repositories) {
  const value = { schemaVersion: 1, repositories };
  return { ...value, fingerprint: hash(stable(value)) };
}

export function createGoalExecution({ threadId, repositories }) {
  const identity = { schemaVersion: 1, threadId, goalRunId: `gr-${crypto.randomUUID()}`, revision: 1 };
  assertIdentity(identity);
  return { identity, baseline: baselineFor(captureRepositories(repositories)) };
}

export function assertGoalExecution(execution, goalId) {
  if (!execution) throw new Error('LEGACY_UNVERIFIED: Goal execution identity and baseline required');
  if (!exactKeys(execution, ['identity', 'baseline'])) throw new Error('Invalid Goal execution schema');
  assertIdentity(execution.identity);
  const baseline = execution.baseline;
  if (!exactKeys(baseline, ['schemaVersion', 'repositories', 'fingerprint']) || baseline.schemaVersion !== 1 ||
    !Array.isArray(baseline.repositories) || !baseline.repositories.length || baseline.repositories.length > 2 ||
    !HASH.test(baseline.fingerprint) || baselineFor(baseline.repositories).fingerprint !== baseline.fingerprint ||
    new Set(baseline.repositories.map((repo) => repo.repositoryId)).size !== baseline.repositories.length) {
    throw new Error('REVALIDATION_REQUIRED: invalid Goal baseline');
  }
  for (const repo of baseline.repositories) {
    if (!exactKeys(repo, ['repositoryId', 'checkoutFingerprint', 'branch', 'head', 'dirty', 'contentFingerprint']) ||
      !['wayper', 'wayper-site'].includes(repo.repositoryId) || !HASH.test(repo.checkoutFingerprint) ||
      !(repo.branch === null || typeof repo.branch === 'string' && repo.branch.length > 0 && repo.branch.length <= 240) ||
      !/^[a-f0-9]{40,64}$/.test(repo.head) || typeof repo.dirty !== 'boolean' || !HASH.test(repo.contentFingerprint)) {
      throw new Error('Invalid baseline repository state');
    }
  }
  if (goalId !== undefined && goalId !== goalReference(execution.identity)) throw new Error('Goal reference mismatch');
}

export function assertSameExecution(actual, expected) {
  assertGoalExecution(actual);
  assertGoalExecution(expected);
  if (stable(actual) !== stable(expected)) throw new Error('Goal execution/baseline mismatch: REVALIDATION_REQUIRED');
}

export function repositoryChanges(previous, current) {
  if (stable(previous.map((repo) => repo.repositoryId).sort()) !== stable(current.map((repo) => repo.repositoryId).sort())) {
    throw new Error('Repository membership change requires explicit amendment');
  }
  const changed = []; const incompatible = [];
  for (const repo of current) {
    const prior = previous.find((item) => item.repositoryId === repo.repositoryId);
    if (stable(prior) !== stable(repo)) changed.push(repo.repositoryId);
    if (['checkoutFingerprint', 'branch', 'head'].some((key) => repo[key] !== prior[key])) incompatible.push(repo.repositoryId);
  }
  return { changed, incompatible };
}

export function contextStatePath(root, goalRunId) {
  if (!RUN_ID.test(goalRunId ?? '')) throw new Error('Safe --goal-run-id is required; threadId is not a Goal');
  return path.join(root, '.wayper-context', `${goalRunId}.md`);
}

// Invalidated proofs remain inspectable. Unscoped textual proof is never silently carried forward.
export function invalidateWorkingProof(item, status) {
  item.invalidatedEvidence = [...new Set([...(item.invalidatedEvidence ?? []), ...(item.evidence ?? [])])];
  item.evidence = [];
  item.status = status;
}

export function invalidateMapProofs(map, { evidence = [], validations = [], artifacts = [], capabilities = [], graphify = [] }, reason) {
  for (const item of map.evidence) if (evidence.includes(item.id)) {
    item.status = 'STALE'; item.invalidationReason = reason;
  }
  for (const check of map.validation.checks) if (validations.includes(check.id)) {
    check.status = 'NOT_RUN'; check.evidence = null;
  }
  const reusable = new Set([...map.evidence.filter((item) => ['PROVEN', 'HIGH_CONFIDENCE'].includes(item.status)),
    ...map.validation.checks.filter((item) => item.status === 'PASS')].map((item) => item.id));
  map.dependencies = map.dependencies.filter((edge) => edge.evidenceIds.every((id) => reusable.has(id)));
  for (const item of map.knownGood) if (artifacts.includes(`${item.repository}:${item.artifact}`) ||
    capabilities.includes(item.capability) || item.proofRefs.some((ref) => !ref.startsWith('WC:') && !reusable.has(ref))) {
    item.status = 'STALE'; item.invalidationReason = reason;
  }
  for (const gap of map.proofGaps) if (gap.status === 'RESOLVED' && gap.evidenceIds.some((id) => !reusable.has(id))) {
    gap.status = 'OPEN'; gap.evidenceIds = [];
  }
  for (const id of graphify) if (map.graphify[id]?.queries.length) map.graphify[id].status = 'STALE';
}
