// Test/eval adapter only. Fixture labels are never accepted by production validators.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGoalExecution } from '../wayper-context-identity.mjs';
import { observeFile } from '../wayper-evidence-observer.mjs';
import { proveWorkingContext } from '../wayper-context.mjs';

export function observedGate(options, target) {
  const observer = new URL('../wayper-evidence-observer.mjs', import.meta.url).href;
  const environment = { ...process.env }; delete environment.NODE_TEST_CONTEXT;
  const code = `import fs from 'node:fs';
    import { runObservedQualityGate } from ${JSON.stringify(observer)};
    const options = JSON.parse(fs.readFileSync(0, 'utf8'));
    const result = await runObservedQualityGate({ ...options, command: process.execPath,
      args: ['-e', "require('node:assert/strict').equal(1, 1)"] });
    process.stdout.write(JSON.stringify(result.receipt));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    input: JSON.stringify({ ...options, repository: options.repository ?? 'wayper', target }),
    env: environment, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }));
}

export function proveFixture(state, selector, options) {
  const repositories = options.repositories ?? [{ id: 'wayper', root: options.root }];
  const context = { root: options.root, repositories, execution: state.execution };
  let receipt;
  if (selector.artifact) {
    const artifact = state.artifacts.find((item) => item.spec === selector.artifact);
    receipt = observeFile({ ...context, repository: artifact.repository, path: artifact.path,
      range: artifact.start === null ? null : `L${artifact.start}${artifact.start === artifact.end ? '' : `-L${artifact.end}`}` });
  } else receipt = observedGate(context, selector.requirement.slice(selector.requirement.indexOf(':') + 1));
  return proveWorkingContext(state, { ...selector, evidence: receipt.receiptId }, context);
}

export function createCompletionEvidenceFixture(suite) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayper-completion-evidence-'));
  fs.writeFileSync(path.join(root, '.gitignore'), '.wayper-context/\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'evidence eval fixture');
  const repositories = [{ id: 'wayper', root }];
  const context = { root, repositories, execution: createGoalExecution({ threadId: 'completion-evals', repositories }) };
  const targets = new Set();
  const collect = (value) => {
    if (typeof value === 'string' && value.startsWith('fixture:pass:')) targets.add(value.slice(13));
    if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(suite);
  const receipts = new Map([...targets].map((target) => [target, observedGate(context, target).receiptId]));
  const bind = (value) => {
    if (typeof value === 'string' && value.startsWith('fixture:pass:')) return receipts.get(value.slice(13));
    if (Array.isArray(value)) return value.map(bind);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bind(item)]));
    return value;
  };
  return { context, bind, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
