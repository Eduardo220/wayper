import logger, { LOG_CATEGORIES } from "../../utils/logger.js";
import { capturePossibleFreeze } from "../monitoring/sentryService.js";

const SAMPLE_INTERVAL_MS = 2000;
const STALL_THRESHOLD_MS = 700;
const POSSIBLE_FREEZE_THRESHOLD_MS = 2500;
const POSSIBLE_FREEZE_REMOTE_THROTTLE_MS = 60000;

let timer = null;
let expectedAt = 0;
let lastPossibleFreezeSentAt = 0;
let contextProvider = null;

async function getRuntimeContext(reason = "performance_watchdog") {
  if (typeof contextProvider === "function") {
    return contextProvider(reason);
  }
  try {
    const runtimeModule = await import("../runTracking/activeRunRuntimeService.js");
    return await runtimeModule.getActiveRunRuntimeSnapshot?.(reason);
  } catch {
    return null;
  }
}

function compactFreezeContext(runtime = {}, delayMs = 0, now = Date.now()) {
  const summary = runtime?.summary || {};
  return {
    delayMs,
    thresholdMs: POSSIBLE_FREEZE_THRESHOLD_MS,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    detectedAt: new Date(now).toISOString(),
    runId: runtime?.runId || summary.runId || null,
    runStatus: runtime?.status || summary.status || null,
    appState: runtime?.appState || summary.appState || null,
    watcherStatus: runtime?.foregroundWatcherStatus || summary.watcherStatus || null,
    backgroundTaskStatus: runtime?.backgroundTaskStatus || summary.backgroundTaskStatus || null,
    notificationStatus: runtime?.notificationStatus || null,
    pendingStorageWrites: runtime?.pendingFlushCount ?? runtime?.pendingFlushes ?? null,
    lastLocationAt: runtime?.lastRawPointReceivedAt || summary.lastLocationAt || null,
    lastUiUpdateAt: runtime?.lastUiTickAt || runtime?.lastRenderPathUpdatedAt || null,
    distanceMeters: runtime?.distanceMeters || summary.distance || 0,
    acceptedPointsCount: runtime?.acceptedPointsCount || summary.trustedPointsCount || 0,
    rejectedPointsCount: runtime?.rejectedPointsCount || 0,
    screen: runtime?.screenFocusState || null,
  };
}

async function recordPerformanceSample(now = Date.now()) {
  const delayMs = Math.max(0, now - expectedAt);
  expectedAt = now + SAMPLE_INTERVAL_MS;
  if (delayMs < STALL_THRESHOLD_MS) return null;

  const runtime = await getRuntimeContext("event_loop_stall");
  const freezeContext = compactFreezeContext(runtime, delayMs, now);
  const event =
    delayMs >= POSSIBLE_FREEZE_THRESHOLD_MS
      ? "RUN_UI_POSSIBLE_FREEZE_DETECTED"
      : "JS_EVENT_LOOP_STALL";

  logger.warn(LOG_CATEGORIES.PERFORMANCE, event, freezeContext, {
    forcePersist: true,
    skipRemote: event === "RUN_UI_POSSIBLE_FREEZE_DETECTED",
  });

  if (
    event === "RUN_UI_POSSIBLE_FREEZE_DETECTED" &&
    (!lastPossibleFreezeSentAt || now - lastPossibleFreezeSentAt >= POSSIBLE_FREEZE_REMOTE_THROTTLE_MS)
  ) {
    lastPossibleFreezeSentAt = now;
    capturePossibleFreeze(freezeContext);
  }

  return freezeContext;
}

export function startPerformanceDiagnostics() {
  if (timer) return;
  expectedAt = Date.now() + SAMPLE_INTERVAL_MS;
  timer = setInterval(() => {
    recordPerformanceSample().catch(() => null);
  }, SAMPLE_INTERVAL_MS);
}

export function stopPerformanceDiagnostics() {
  if (timer) clearInterval(timer);
  timer = null;
  expectedAt = 0;
  lastPossibleFreezeSentAt = 0;
}

export function setPerformanceDiagnosticsContextProvider(provider) {
  contextProvider = typeof provider === "function" ? provider : null;
}

export async function __samplePerformanceDiagnosticsForTests(nowMs) {
  if (!expectedAt) expectedAt = Number(nowMs) - POSSIBLE_FREEZE_THRESHOLD_MS - 1;
  return recordPerformanceSample(Number(nowMs));
}

export function __resetPerformanceDiagnosticsForTests() {
  stopPerformanceDiagnostics();
  contextProvider = null;
}

export default {
  __resetPerformanceDiagnosticsForTests,
  __samplePerformanceDiagnosticsForTests,
  setPerformanceDiagnosticsContextProvider,
  startPerformanceDiagnostics,
  stopPerformanceDiagnostics,
};
