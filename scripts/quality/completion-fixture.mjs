// Real persisted Context/Plan/Receipt fixtures. No production verification override.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startWorkingContext, renderWorkingContext } from '../wayper-context.mjs';
import { contextStatePath } from '../wayper-context-identity.mjs';
import { refreshContextMap, recordContextEntry } from '../wayper-context-map.mjs';
import { loadCapabilityFiles } from './check-capability-routing.mjs';
import { runObservedCommand, runObservedQualityGate } from '../wayper-evidence-observer.mjs';

export function completionFixture(t, cross = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-boundary-'));
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  t?.after(cleanup);
  const repositories = (cross ? ['wayper', 'wayper-site'] : ['wayper']).map((id) => {
    const root = path.join(directory, id); fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, '.gitignore'), '.wayper-context/\n');
    fs.writeFileSync(path.join(root, 'README.md'), '# Completion fixture\n');
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
    return { id, root, logicalRoot: id === 'wayper' ? '.' : '../wayper-site' };
  });
  const root = repositories[0].root;
  const { registry } = loadCapabilityFiles();
  let state = startWorkingContext({ root, repositories, threadId: 'completion-fixture', objective: 'Prove completion',
    taskClass: 'BOUNDED', requirements: ['SUCCESS:criterion'] });
  const f = { root, repositories, registry, cleanup, state, identity: state.execution.identity };
  f.options = () => ({ root, repositories, execution: f.state.execution });
  f.save = () => {
    const file = contextStatePath(root, f.state.execution.identity.goalRunId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderWorkingContext(f.state));
  };
  f.refresh = () => {
    f.state.contextMap = refreshContextMap(f.state.contextMap, { ...f.options(), goalId: f.state.goalId,
      taskClass: f.state.taskClass, tokenCeiling: 16000, registry });
    f.save();
  };
  f.input = { operation: 'DOC_ONLY', taskClass: 'BOUNDED', repositories: repositories.map((r) => ({
    repository: r.id, platforms: ['shared'], changedPaths: ['README.md'], capabilities: [], risks: [], testTargets: { L1: [], L2: [] },
  })), criteria: [] };
  f.plan = () => {
    f.state.contextMap = recordContextEntry(f.state.contextMap, 'validation-plan', { inputs: f.input }, repositories,
      { ...f.options(), registry }); f.save();
  };
  f.prove = async (target = 'criterion', repository = 'wayper') => {
    const { receipt } = await runObservedQualityGate({ ...f.options(), repository, target,
      command: process.execPath, args: ['-e', 'require("node:assert/strict").equal(1, 1)'] });
    if (target === 'criterion') Object.assign(f.state.requirements[0], { status: 'SATISFIED', evidence: [receipt.receiptId] });
    f.save(); return receipt;
  };
  f.validate = async () => {
    for (const repository of repositories) await runObservedCommand({ ...f.options(), repository: repository.id,
      target: 'diff', command: 'git', args: ['diff', '--check', 'HEAD', '--'] });
    f.refresh();
  };
  f.ready = async () => { await f.prove(); f.plan(); await f.validate(); };
  f.refresh();
  return f;
}

export const finding = (extra = {}) => ({ id: 'F-bug', repository: 'wayper', paths: ['README.md'],
  severity: 'HIGH', materiality: 'BLOCKING', status: 'OPEN', claim: 'A real bug', scenario: 'A concrete failing input',
  relatedRequirementIds: ['SUCCESS:criterion'], receiptIds: [], resolution: null, ...extra });
