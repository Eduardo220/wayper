import * as sync from "../utils/sync.js";
import * as runSyncQueueRepository from "./runSyncQueueRepository.js";

export const RUN_REPOSITORY_SOURCE = {
  LOCAL: "local",
};

const ok = (data, meta = {}) => ({
  data,
  source: meta.source || RUN_REPOSITORY_SOURCE.LOCAL,
  loading: false,
  error: null,
  ...meta,
});

const fail = (error, fallback, meta = {}) => ({
  data: fallback,
  source: meta.source || RUN_REPOSITORY_SOURCE.LOCAL,
  loading: false,
  error,
  ...meta,
});

function nowIso() {
  return new Date().toISOString();
}

async function loadHistoryRaw() {
  if (typeof sync.loadLocalRunHistory === "function") return sync.loadLocalRunHistory();
  if (typeof sync.loadLocalRuns === "function") return sync.loadLocalRuns();
  return [];
}

export async function list(options = {}) {
  try {
    const runs = await loadHistoryRaw();
    const data = Array.isArray(runs) ? runs : [];
    return ok(data, { schemaVersion: options.schemaVersion || null });
  } catch (error) {
    return fail(error, []);
  }
}

export const listRunHistory = list;

export async function findById(lookup) {
  try {
    const run = typeof sync.findLocalRunById === "function"
      ? await sync.findLocalRunById(lookup)
      : null;
    return ok(run || null);
  } catch (error) {
    return fail(error, null);
  }
}

export async function save(run = {}, options = {}) {
  try {
    const saved = await sync.saveLocalRun(run);
    if (options.scheduleSync) {
      sync.scheduleRunsSync?.(options.delayMs ?? 0);
    }
    return ok(saved);
  } catch (error) {
    return fail(error, null);
  }
}

export async function remove(runId, options = {}) {
  try {
    return ok(await sync.deleteLocalRun?.(runId, options));
  } catch (error) {
    return fail(error, { deleted: false, remoteDeleted: false });
  }
}

async function markSyncState(lookup, patch = {}, options = {}) {
  const found = await findById(lookup);
  if (!found.data) return found;

  return save(
    {
      ...found.data,
      ...patch,
      updatedAt: patch.updatedAt || nowIso(),
    },
    options
  );
}

export function markAsPendingSync(lookup, options = {}) {
  return markSyncState(
    lookup,
    {
      synced: false,
      pendingSync: true,
      syncStatus: sync.RUN_SYNC_STATUS?.PENDING || "PENDING",
      offlineStatus: sync.RUN_OFFLINE_STATUS?.PENDING_SYNC || "PENDING_SYNC",
      syncError: null,
      lastSyncError: null,
    },
    { scheduleSync: true, ...options }
  );
}

export function markAsSyncing(lookup, options = {}) {
  return markSyncState(
    lookup,
    {
      synced: false,
      pendingSync: true,
      syncStatus: sync.RUN_SYNC_STATUS?.SYNCING || "SYNCING",
      offlineStatus: sync.RUN_OFFLINE_STATUS?.SYNCING || "SYNCING",
      lastSyncAttemptAt: nowIso(),
    },
    options
  );
}

export function markAsSynced(lookup, options = {}) {
  const syncedAt = options.syncedAt || nowIso();
  const remotePatch = options.remoteRunId ? { remoteRunId: options.remoteRunId } : {};
  return markSyncState(
    lookup,
    {
      ...remotePatch,
      synced: true,
      pendingSync: false,
      syncStatus: sync.RUN_SYNC_STATUS?.SYNCED || "SYNCED",
      offlineStatus: sync.RUN_OFFLINE_STATUS?.SYNCED || "SYNCED",
      syncedAt,
      lastSyncedAt: syncedAt,
      syncError: null,
      lastSyncError: null,
    },
    options
  );
}

export function markAsSyncFailed(lookup, error, options = {}) {
  const message = typeof error === "string" ? error : String(error?.message || error || "sync_error");
  return markSyncState(
    lookup,
    {
      synced: false,
      pendingSync: true,
      syncStatus: sync.RUN_SYNC_STATUS?.FAILED || "FAILED",
      offlineStatus: sync.RUN_OFFLINE_STATUS?.SYNC_FAILED || "SYNC_FAILED",
      syncError: message,
      lastSyncError: message,
      lastSyncAttemptAt: nowIso(),
      retryCount: Number(options.retryCount || 0),
    },
    options
  );
}

export async function listPendingSync() {
  const result = await runSyncQueueRepository.listPending();
  return {
    ...result,
    source: RUN_REPOSITORY_SOURCE.LOCAL,
  };
}

export function normalize(run = {}) {
  return {
    ...run,
    id: run.id || run.localRunId || run.remoteRunId || run.runId || null,
    localRunId: run.localRunId || run.id || run.runId || null,
    remoteRunId: run.remoteRunId || null,
    schemaVersion: Number(run.schemaVersion || 1),
  };
}

export default {
  list,
  listRunHistory,
  findById,
  save,
  remove,
  markAsPendingSync,
  markAsSyncing,
  markAsSynced,
  markAsSyncFailed,
  listPendingSync,
  normalize,
};
