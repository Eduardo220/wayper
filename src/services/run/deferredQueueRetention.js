export function retainDeferredQueueTasks(tasks, { isTerminal, maxTasks, toTimestamp }) {
  const pending = tasks.filter((task) => !isTerminal(task.status));
  const terminal = tasks
    .filter((task) => isTerminal(task.status))
    .sort((left, right) => toTimestamp(right.updatedAt, 0) - toTimestamp(left.updatedAt, 0));
  return [...pending, ...terminal.slice(0, Math.max(0, maxTasks - pending.length))]
    .sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0) ||
      String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
}

export function mergeDeferredQueueTask(existing, incoming, options, dependencies) {
  const { normalizeTask, nowIso } = dependencies;
  if (!existing) return incoming;
  if (existing.status === "succeeded" && options.resetSucceeded !== true) return existing;
  if (existing.status === "failed_permanent" && options.resetPermanent !== true) return existing;
  return normalizeTask({
    ...existing,
    payload: { ...(existing.payload || {}), ...(incoming.payload || {}) },
    metadata: { ...(existing.metadata || {}), ...(incoming.metadata || {}) },
    priority: Math.min(
      Number(existing.priority || incoming.priority),
      Number(incoming.priority || existing.priority)
    ),
    dependencies: incoming.dependencies?.length ? incoming.dependencies : existing.dependencies,
    updatedAt: nowIso(),
    status: existing.status === "cancelled" ? "pending" : existing.status,
  });
}
