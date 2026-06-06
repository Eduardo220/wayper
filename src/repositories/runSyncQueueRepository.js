import {
  enqueueFinishedRun,
  loadPendingRuns,
  retryPendingRuns,
  schedulePendingRunsSync,
} from "../services/run/runSyncQueueService.js";

const ok = (data, meta = {}) => ({
  data,
  source: meta.source || "local",
  loading: false,
  error: null,
  ...meta,
});

const fail = (error, fallback, meta = {}) => ({
  data: fallback,
  source: meta.source || "local",
  loading: false,
  error,
  ...meta,
});

export async function enqueue(runData = {}, options = {}) {
  try {
    return ok(await enqueueFinishedRun(runData, options), { syncStatus: "queued" });
  } catch (error) {
    return fail(error, null, { syncStatus: "failed" });
  }
}

export async function listPending() {
  try {
    return ok(await loadPendingRuns(), { syncStatus: "pending" });
  } catch (error) {
    return fail(error, [], { syncStatus: "failed" });
  }
}

export async function retry() {
  try {
    return ok(await retryPendingRuns(), { source: "remote", syncStatus: "processed" });
  } catch (error) {
    return fail(error, null, { source: "remote", syncStatus: "failed" });
  }
}

export async function schedule(delayMs = 0) {
  try {
    return ok(await schedulePendingRunsSync(delayMs), { syncStatus: "scheduled" });
  } catch (error) {
    return fail(error, null, { syncStatus: "failed" });
  }
}

async function getSyncModule() {
  return import("../utils/sync.js");
}

export async function startAutoSync() {
  try {
    const sync = await getSyncModule();
    return ok(sync.startAutoSync?.(), { syncStatus: "started" });
  } catch (error) {
    return fail(error, null, { syncStatus: "failed" });
  }
}

export async function stopAutoSync() {
  try {
    const sync = await getSyncModule();
    return ok(sync.stopAutoSync?.(), { syncStatus: "stopped" });
  } catch (error) {
    return fail(error, null, { syncStatus: "failed" });
  }
}

export default {
  enqueue,
  listPending,
  retry,
  schedule,
  startAutoSync,
  stopAutoSync,
};
