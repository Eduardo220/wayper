import * as Location from "expo-location";
import { Platform } from "react-native";
import { checkLocationPermission } from "../permissions";
import {
  enableNetworkProviderForRun,
  getRunWatchPositionOptions,
} from "./expoLocation.js";

const POLL_INTERVAL_MS = 1000;
let watcher = null;
let ownerRunId = null;
let generation = 0;

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
  generation += 1;
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

export async function startForegroundWatcher(options = {}) {
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
    if (!isCurrent()) return;
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
      return { ok: true, accuracy, mode: "watch" };
    } catch (error) {
      lastError = error;
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
      options.onError?.(error, { phase: "fallback_polling" });
    }
  }, options.pollIntervalMs || POLL_INTERVAL_MS);
  if (!isCurrent()) {
    clearInterval(pollingInterval);
    return { ok: false, reason: "stale_start", error: lastError };
  }
  watcher = { pollingInterval };
  ownerRunId = runId;
  return { ok: true, mode: "polling", fallbackError: lastError };
}

export function __resetForegroundWatcherForTests() {
  stopForegroundWatcher();
}

export default {
  getForegroundWatcherOwnerRunId,
  isForegroundWatcherActive,
  startForegroundWatcher,
  stopForegroundWatcher,
};
