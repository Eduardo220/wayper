import * as Location from "expo-location";
import { AppState, Platform } from "react-native";
import { recordFlightEvent } from "../diagnostics/activeRunFlightRecorder.js";
import { checkLocationPermission } from "../permissions";
import { checkpointOnLocationError } from "../run/runAutoSaveService.js";
import {
  getActiveRunSnapshot,
  onActiveRunSnapshot,
  recordLocation,
  setRunRuntimeSurfaceState,
} from "./activeRunTrackingService.js";
import {
  enableNetworkProviderForRun,
  getRunWatchPositionOptions,
} from "./expoLocation.js";

const POLL_INTERVAL_MS = 1000;
let watcher = null;
let ownerRunId = null;
let generation = 0;
let starting = null;
let unsubscribeSnapshots = null;
let appStateSubscription = null;
let activeRunId = null;
let activeRunStatus = null;
let appIsActive = !["background", "inactive"].includes(AppState.currentState);
let snapshotVersion = 0;
let coordinatorGeneration = 0;

function toLocationPayload(location, source, runSessionId) {
  if (!location?.coords) return null;
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    speed: location.coords.speed,
    heading: location.coords.heading,
    altitude: location.coords.altitude,
    altitudeAccuracy: location.coords.altitudeAccuracy,
    timestamp: location.timestamp,
    source,
    runSessionId,
  };
}

export function isForegroundWatcherActive() {
  return Boolean(watcher);
}

export function getForegroundWatcherOwnerRunId() {
  return ownerRunId;
}

export function stopForegroundWatcher() {
  if (ownerRunId) recordFlightEvent("GPS_WATCH_STOPPED", { runId: ownerRunId, source: "foreground" });
  generation += 1;
  starting = null;
  const current = watcher;
  watcher = null;
  ownerRunId = null;
  try {
    current?.remove?.();
    if (current?.pollingInterval) clearInterval(current.pollingInterval);
  } catch {
    // Resource is already detached; generation fences late callbacks.
  }
}

async function startForegroundWatcherInternal(options = {}) {
  const runId = String(options.runId || "").trim();
  if (!runId) return { ok: false, reason: "missing_run_id" };
  if (watcher && ownerRunId === runId) return { ok: true, alreadyStarted: true };
  stopForegroundWatcher();
  const requestGeneration = generation;
  const locationApi = options.locationApi || Location;
  const platform = options.platform || Platform;
  const permission = await (options.checkPermission || checkLocationPermission)();
  if (!permission?.granted) return { ok: false, reason: "permission_denied", permission };
  await enableNetworkProviderForRun(locationApi, platform);

  const isCurrent = () => requestGeneration === generation &&
    (typeof options.isRunActive !== "function" || options.isRunActive(runId));
  const emit = (location, source) => {
    const current = isCurrent();
    recordFlightEvent("GPS_RAW", { runId, source: "foreground", point: location, reason: current ? null : "stale_watcher_callback" });
    if (!current) {
      recordFlightEvent("GPS_REJECTED", { runId, source: "foreground", point: location, reason: "stale_watcher_callback" });
      return;
    }
    const payload = toLocationPayload(location, source, runId);
    if (payload) options.onLocation?.(payload);
  };
  let lastError = null;
  const accuracies = [
    locationApi.Accuracy?.BestForNavigation,
    locationApi.Accuracy?.Highest,
    locationApi.Accuracy?.High,
  ].filter((value) => value != null);

  for (const accuracy of accuracies) {
    try {
      const subscription = await locationApi.watchPositionAsync(
        getRunWatchPositionOptions(locationApi, { accuracy }),
        (location) => emit(location, "expo-location")
      );
      if (!isCurrent()) {
        subscription?.remove?.();
        return { ok: false, reason: "stale_start" };
      }
      watcher = subscription;
      ownerRunId = runId;
      recordFlightEvent("GPS_WATCH_STARTED", { runId, source: "foreground", reason: "watch" });
      return { ok: true, accuracy, mode: "watch" };
    } catch (error) {
      lastError = error;
      recordFlightEvent("GPS_ERROR", { runId, source: "foreground", reason: "watch_position_accuracy_fallback" });
      options.onError?.(error, { phase: "watch_position_accuracy_fallback", accuracy });
    }
  }

  const pollingInterval = setInterval(async () => {
    if (!isCurrent()) return;
    try {
      emit(
        await locationApi.getCurrentPositionAsync({ accuracy: locationApi.Accuracy?.High }),
        "fallback"
      );
    } catch (error) {
      recordFlightEvent("GPS_ERROR", { runId, source: "foreground", reason: "fallback_polling" });
      options.onError?.(error, { phase: "fallback_polling" });
    }
  }, options.pollIntervalMs || POLL_INTERVAL_MS);
  if (!isCurrent()) {
    clearInterval(pollingInterval);
    return { ok: false, reason: "stale_start", error: lastError };
  }
  watcher = { pollingInterval };
  ownerRunId = runId;
  recordFlightEvent("GPS_WATCH_STARTED", { runId, source: "foreground", reason: "polling" });
  return { ok: true, mode: "polling", fallbackError: lastError };
}

export function startForegroundWatcher(options = {}) {
  const runId = String(options.runId || "").trim();
  if (starting?.runId === runId) return starting.promise;
  const promise = startForegroundWatcherInternal(options);
  starting = { runId, promise };
  promise.finally(() => {
    if (starting?.promise === promise) starting = null;
  }).catch(() => {});
  return promise;
}

function applyActiveRunSnapshot(snapshot) {
  activeRunId = snapshot?.activeRunId || null;
  activeRunStatus = snapshot?.status || null;
  if (activeRunStatus !== "RUNNING") {
    if (isForegroundWatcherActive() || starting) stopForegroundWatcher();
    setRunRuntimeSurfaceState({ foregroundWatcherStatus: "stopped" });
    return Promise.resolve({ ok: false, reason: "not_running" });
  }
  if (!appIsActive) return Promise.resolve({ ok: false, reason: "app_background" });
  const runId = activeRunId;
  return startForegroundWatcher({
    runId,
    isRunActive: (expectedRunId) => activeRunId === expectedRunId && activeRunStatus === "RUNNING",
    onLocation: (location) => {
      recordLocation(location, { expectedRunId: location.runSessionId, source: "foreground" })
        .catch((error) => checkpointOnLocationError(error, { phase: "canonical_location_ingestion" }).catch(() => {}));
    },
    onError: (error, context) => checkpointOnLocationError(error, context).catch(() => {}),
  }).then((result) => {
    if (result.ok && ownerRunId === runId && activeRunStatus === "RUNNING") {
      setRunRuntimeSurfaceState({ foregroundWatcherStatus: "started" });
    }
    return result;
  });
}

export async function syncForegroundWatcherWithActiveRun() {
  const version = snapshotVersion;
  const generationAtRequest = coordinatorGeneration;
  const snapshot = await getActiveRunSnapshot();
  if (version !== snapshotVersion || generationAtRequest !== coordinatorGeneration) {
    return { ok: false, reason: "stale_sync" };
  }
  return applyActiveRunSnapshot(snapshot);
}

export function startActiveRunForegroundCoordinator() {
  if (unsubscribeSnapshots) return stopActiveRunForegroundCoordinator;
  coordinatorGeneration += 1;
  appIsActive = !["background", "inactive"].includes(AppState.currentState);
  unsubscribeSnapshots = onActiveRunSnapshot(({ event, snapshot }) => {
    if (event === "foreground_point_buffered" || event === "background_point_buffered") return;
    snapshotVersion += 1;
    applyActiveRunSnapshot(snapshot).catch(() => {});
  });
  appStateSubscription = AppState.addEventListener("change", (next) => {
    appIsActive = next === "active";
    if (next === "active") syncForegroundWatcherWithActiveRun().catch(() => {});
  });
  syncForegroundWatcherWithActiveRun().catch(() => {});
  return stopActiveRunForegroundCoordinator;
}

export function stopActiveRunForegroundCoordinator() {
  coordinatorGeneration += 1;
  unsubscribeSnapshots?.();
  unsubscribeSnapshots = null;
  appStateSubscription?.remove?.();
  appStateSubscription = null;
  activeRunId = null;
  activeRunStatus = null;
  stopForegroundWatcher();
  setRunRuntimeSurfaceState({ foregroundWatcherStatus: "stopped" });
}

export function __resetForegroundWatcherForTests() {
  stopActiveRunForegroundCoordinator();
}

export default {
  getForegroundWatcherOwnerRunId,
  isForegroundWatcherActive,
  startActiveRunForegroundCoordinator,
  startForegroundWatcher,
  stopActiveRunForegroundCoordinator,
  stopForegroundWatcher,
  syncForegroundWatcherWithActiveRun,
};
