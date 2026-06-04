export const RUN_SYNC_QUEUE_STATUS = {
  PENDING: "PENDING",
  SYNCING: "SYNCING",
  SYNCED: "SYNCED",
  FAILED: "FAILED",
};

function normalizeRunForQueue(runData = {}, options = {}) {
  const id = String(runData.id || runData.localRunId || options.localRunId || `local_${Date.now()}`);
  return {
    ...runData,
    id,
    localRunId: runData.localRunId || id,
    userId: runData.userId || options.userId || "offline",
    status: runData.status || "completed",
    synced: false,
    pendingSync: true,
    syncStatus: options.syncStatus || runData.syncStatus || RUN_SYNC_QUEUE_STATUS.PENDING,
    offlineStatus: options.offlineStatus || runData.offlineStatus || "PENDING_SYNC",
    schemaVersion: Number(runData.schemaVersion || options.schemaVersion || 1),
  };
}

async function getSyncModule() {
  return import("../../utils/sync.js");
}

export async function enqueueFinishedRun(runData = {}, options = {}) {
  const sync = await getSyncModule();
  const normalized = normalizeRunForQueue(runData, options);
  const saved = await sync.saveLocalRun?.(normalized);

  if (options.schedule !== false) {
    sync.scheduleRunsSync?.(options.delayMs ?? 0);
  }

  return saved || normalized;
}

export async function retryPendingRuns() {
  const sync = await getSyncModule();
  return sync.syncRunsToFirestore?.();
}

export async function schedulePendingRunsSync(delayMs = 0) {
  const sync = await getSyncModule();
  return sync.scheduleRunsSync?.(delayMs);
}

export async function loadPendingRuns() {
  const sync = await getSyncModule();
  const runs = await sync.loadLocalRuns?.();
  return (Array.isArray(runs) ? runs : []).filter((run) => run && (run.pendingSync || !run.synced));
}

export default {
  RUN_SYNC_QUEUE_STATUS,
  enqueueFinishedRun,
  loadPendingRuns,
  retryPendingRuns,
  schedulePendingRunsSync,
};
