import {
  enqueueDefaultPostRunTasks,
  getRunDeferredTaskQueueSummary,
  loadRunDeferredTasks,
  processRunDeferredTaskQueue,
  recoverStaleRunDeferredTasks,
  retryRunDeferredTasks,
  startRunDeferredTaskAutoProcessing,
  stopRunDeferredTaskAutoProcessing,
} from "../services/run/runDeferredTaskQueueService.js";

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

export async function enqueuePostRun(runData = {}, options = {}) {
  try {
    return ok(await enqueueDefaultPostRunTasks(runData, options), { queueStatus: "queued" });
  } catch (error) {
    return fail(error, { queued: [] }, { queueStatus: "failed" });
  }
}

export async function listPending() {
  try {
    return ok(await loadRunDeferredTasks({ includeTerminal: false }), { queueStatus: "pending" });
  } catch (error) {
    return fail(error, [], { queueStatus: "failed" });
  }
}

export async function summary() {
  try {
    return ok(await getRunDeferredTaskQueueSummary(), { queueStatus: "summarized" });
  } catch (error) {
    return fail(error, null, { queueStatus: "failed" });
  }
}

export async function process(options = {}) {
  try {
    return ok(await processRunDeferredTaskQueue(options), { queueStatus: "processed" });
  } catch (error) {
    return fail(error, null, { queueStatus: "failed" });
  }
}

export async function retry(options = {}) {
  try {
    const retryResult = await retryRunDeferredTasks(options);
    const processResult = options.process === false
      ? null
      : await processRunDeferredTaskQueue({ trigger: "manual_retry", ...options });
    return ok({ retry: retryResult, process: processResult }, { queueStatus: "retry_scheduled" });
  } catch (error) {
    return fail(error, null, { queueStatus: "failed" });
  }
}

export async function recover(options = {}) {
  try {
    return ok(await recoverStaleRunDeferredTasks(options), { queueStatus: "recovered" });
  } catch (error) {
    return fail(error, null, { queueStatus: "failed" });
  }
}

export async function startAutoProcessing(options = {}) {
  try {
    return ok(await startRunDeferredTaskAutoProcessing(options), { queueStatus: "started" });
  } catch (error) {
    return fail(error, null, { queueStatus: "failed" });
  }
}

export async function stopAutoProcessing() {
  try {
    return ok(await stopRunDeferredTaskAutoProcessing(), { queueStatus: "stopped" });
  } catch (error) {
    return fail(error, null, { queueStatus: "failed" });
  }
}

export default {
  enqueuePostRun,
  listPending,
  summary,
  process,
  retry,
  recover,
  startAutoProcessing,
  stopAutoProcessing,
};
