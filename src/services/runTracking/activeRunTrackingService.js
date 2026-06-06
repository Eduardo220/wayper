import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { getRunBackgroundLocationOptions } from "./expoLocation.js";
import {
  ACTIVE_RUN_STATUS,
  ACTIVE_RUN_STORAGE_KEY,
  buildRunDataFromActiveSnapshot,
  calculateActiveRunDurationSeconds,
  createRunId,
  createSnapshotFromTrackingSession,
  createTrackingSessionFromSnapshot,
  mergeActiveRunSnapshots,
  normalizeActiveRunSnapshot,
  nowIso,
} from "./activeRunState.js";
import logger, { LOG_CATEGORIES } from "../../utils/logger.js";
import {
  recordLocationPointEvent,
  recordRunEvent,
  recordRunSnapshotEvent,
  summarizeRunSnapshot,
} from "../diagnostics/runDiagnosticsService.js";

export const ACTIVE_RUN_LOCATION_TASK = "WAYPER_ACTIVE_RUN_LOCATION";

const NOTIFICATION_BODY = "Sua corrida esta sendo salva mesmo com a tela bloqueada.";
const DEFAULT_NOTIFICATION_COLOR = "#00E676";

let activeSession = null;
let activeSnapshot = null;
let backgroundStarted = false;
let storage = AsyncStorage;
let debugEnabled = typeof __DEV__ !== "undefined" && __DEV__;

const listeners = {
  snapshot: new Set(),
  error: new Set(),
};

function log(event, payload = {}) {
  if (!debugEnabled) return;
  logger.debug(LOG_CATEGORIES.RUN_TRACKING, event, payload);
}

function devLog(prefix, message, payload = {}) {
  if (!debugEnabled) return;
  const category = prefix === "RunRecovery" ? LOG_CATEGORIES.RUN_RECOVERY : LOG_CATEGORIES.RUN_TRACKING;
  logger.debug(category, message, payload);
}

function logRunRecovery(message, payload = {}) {
  devLog("RunRecovery", message, payload);
}

function logRunGeometry(message, payload = {}) {
  devLog("RunGeometry", message, payload);
}

function emit(event, payload) {
  const set = listeners[event];
  if (!set) return;
  set.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      log("listener_error", { event, error: error?.message || error });
    }
  });
}

function emitSnapshot(snapshot, event = "snapshot") {
  emit("snapshot", { event, snapshot });
}

function emitError(error, context = {}) {
  log("error", { ...context, error: error?.message || error });
  logger.error(LOG_CATEGORIES.RUN_TRACKING, "ACTIVE_RUN_TRACKING_ERROR", {
    ...context,
    error,
  });
  emit("error", { error, context });
}

async function persistSnapshot(snapshot, event = "snapshot_saved") {
  const incoming = normalizeActiveRunSnapshot(snapshot);
  const shouldMerge =
    activeSnapshot?.activeRunId &&
    incoming?.activeRunId &&
    activeSnapshot.activeRunId === incoming.activeRunId &&
    event !== "run_started";
  const normalized = shouldMerge
    ? mergeActiveRunSnapshots(activeSnapshot, incoming)
    : incoming;
  activeSnapshot = normalized;
  try {
    await storage.setItem(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(normalized));
  } catch (error) {
    recordRunSnapshotEvent("ACTIVE_RUN_SAVE_FAILED", normalized, {
      event,
      error,
    });
    throw error;
  }
  if (normalized?.meta?.ignoredEmptyGeometryOverwrite) {
    recordRunSnapshotEvent("ACTIVE_RUN_EMPTY_OVERWRITE_BLOCKED", normalized, {
      event,
    });
    logRunGeometry("ignored empty segment overwrite", {
      activeRunId: normalized.activeRunId,
      event,
      segments: normalized.segments?.length || 0,
      points: normalized.trustedPath?.length || 0,
    });
  }
  if (normalized?.meta?.distancePreserved) {
    recordRunSnapshotEvent("ACTIVE_RUN_DISTANCE_REGRESSION_BLOCKED", normalized, {
      event,
    });
    logRunGeometry("distance preserved", {
      activeRunId: normalized.activeRunId,
      event,
      distanceMeters: normalized.distanceMeters,
    });
  }
  log(event, {
    activeRunId: normalized.activeRunId,
    status: normalized.status,
    points: normalized.trustedPath?.length || 0,
    source: normalized.source,
  });
  recordRunSnapshotEvent("ACTIVE_RUN_SAVED", normalized, {
    event,
  });
  emitSnapshot(normalized, event);
  return normalized;
}

async function loadPersistedSnapshot() {
  try {
    const raw = await storage.getItem(ACTIVE_RUN_STORAGE_KEY);
    if (!raw) return null;
    const snapshot = normalizeActiveRunSnapshot(JSON.parse(raw));
    recordRunSnapshotEvent("RECOVERY_LOADED_ACTIVE_RUN", snapshot, {
      source: "canonical_storage",
    });
    return snapshot;
  } catch (error) {
    emitError(error, { fn: "loadPersistedSnapshot" });
    return null;
  }
}

function ensureSession(snapshot) {
  const normalized = normalizeActiveRunSnapshot(snapshot || activeSnapshot);
  if (!normalized) return null;
  if (!activeSession || activeSnapshot?.activeRunId !== normalized.activeRunId) {
    activeSession = createTrackingSessionFromSnapshot(normalized);
  }
  activeSnapshot = normalized;
  return activeSession;
}

function isLiveStatus(status) {
  return status === ACTIVE_RUN_STATUS.RUNNING || status === ACTIVE_RUN_STATUS.PAUSED;
}

async function getActiveSession() {
  if (activeSession && activeSnapshot) return activeSession;
  const snapshot = await loadPersistedSnapshot();
  if (!snapshot) return null;
  return ensureSession(snapshot);
}

function getBackgroundOptions(body = NOTIFICATION_BODY) {
  const useExpoForegroundService =
    Platform.OS !== "android" || !NativeModules?.WayperRunNotificationAndroid;

  return getRunBackgroundLocationOptions(Location, body, {
    notificationColor: DEFAULT_NOTIFICATION_COLOR,
    useForegroundService: useExpoForegroundService,
  });
}

export async function hasActiveRunSnapshot() {
  const snapshot = activeSnapshot || (await loadPersistedSnapshot());
  return Boolean(snapshot && [ACTIVE_RUN_STATUS.RUNNING, ACTIVE_RUN_STATUS.PAUSED, ACTIVE_RUN_STATUS.FINISHING, ACTIVE_RUN_STATUS.FINISHED].includes(snapshot.status));
}

export async function getActiveRunSnapshot() {
  return activeSnapshot || (await loadPersistedSnapshot());
}

export function getCurrentDurationSeconds(nowMs = Date.now()) {
  const snapshot = activeSnapshot;
  if (!snapshot) return 0;
  return calculateActiveRunDurationSeconds(snapshot, { nowMs });
}

export function getTrackingRuntimeStatus() {
  return {
    ...summarizeRunSnapshot(activeSnapshot || {}),
    activeRunId: activeSnapshot?.activeRunId || null,
    status: activeSnapshot?.status || null,
    watcherStatus: backgroundStarted ? "background_started" : "unknown",
    backgroundStarted,
    taskName: ACTIVE_RUN_LOCATION_TASK,
  };
}

export function onActiveRunSnapshot(listener) {
  listeners.snapshot.add(listener);
  return () => listeners.snapshot.delete(listener);
}

export function onActiveRunError(listener) {
  listeners.error.add(listener);
  return () => listeners.error.delete(listener);
}

export function setActiveRunDebug(enabled = true) {
  debugEnabled = !!enabled;
}

export async function startBackgroundLocationUpdates(options = {}) {
  try {
    if (Platform.OS === "web") return false;
    const snapshot = activeSnapshot || (await loadPersistedSnapshot());
    if (!snapshot || snapshot.status !== ACTIVE_RUN_STATUS.RUNNING) return false;

    const started = await Location.hasStartedLocationUpdatesAsync(ACTIVE_RUN_LOCATION_TASK).catch(() => false);
    if (started && !options.force) {
      backgroundStarted = true;
      recordRunSnapshotEvent("LOCATION_WATCHER_STARTED", snapshot, {
        watcherStatus: "already_started",
        backgroundTaskStatus: ACTIVE_RUN_LOCATION_TASK,
      });
      logRunRecovery("watcher alive", {
        activeRunId: snapshot.activeRunId,
        task: ACTIVE_RUN_LOCATION_TASK,
      });
      return true;
    }

    if (!started) {
      recordRunSnapshotEvent("LOCATION_WATCHER_RESTARTED", snapshot, {
        watcherStatus: "restarting",
        backgroundTaskStatus: ACTIVE_RUN_LOCATION_TASK,
      });
      logRunRecovery("restarting watcher without clearing path", {
        activeRunId: snapshot.activeRunId,
        task: ACTIVE_RUN_LOCATION_TASK,
      });
    }
    await Location.startLocationUpdatesAsync(
      ACTIVE_RUN_LOCATION_TASK,
      getBackgroundOptions(snapshot.notificationBody || NOTIFICATION_BODY)
    );
    backgroundStarted = true;
    log("background_tracking_started", { activeRunId: snapshot.activeRunId });
    recordRunSnapshotEvent("LOCATION_WATCHER_STARTED", snapshot, {
      watcherStatus: "started",
      backgroundTaskStatus: ACTIVE_RUN_LOCATION_TASK,
    });
    return true;
  } catch (error) {
    backgroundStarted = false;
    emitError(error, { fn: "startBackgroundLocationUpdates" });
    return false;
  }
}

export async function stopBackgroundLocationUpdates(options = {}) {
  try {
    if (Platform.OS === "web") return false;
    const started = await Location.hasStartedLocationUpdatesAsync(ACTIVE_RUN_LOCATION_TASK).catch(() => backgroundStarted);
    if (started) {
      await Location.stopLocationUpdatesAsync(ACTIVE_RUN_LOCATION_TASK);
    }
    backgroundStarted = false;
    log("background_tracking_stopped", { reason: options.reason || "manual" });
    recordRunEvent("LOCATION_WATCHER_STOPPED", {
      reason: options.reason || "manual",
      watcherStatus: "stopped",
      backgroundTaskStatus: ACTIVE_RUN_LOCATION_TASK,
    });
    return true;
  } catch (error) {
    emitError(error, { fn: "stopBackgroundLocationUpdates", reason: options.reason || "manual" });
    return false;
  }
}

export async function startActiveRun(options = {}) {
  const nowMs = Number(options.startedAtMs || Date.now());
  const runId = options.activeRunId || options.id || createRunId(nowMs);
  recordRunEvent("RUN_START_ATTEMPT", {
    runId,
    userId: options.userId || "offline",
    mode: options.mode || "free",
    startedAtMs: nowMs,
  });
  const existing = activeSnapshot || (await loadPersistedSnapshot());
  if (
    existing?.activeRunId &&
    isLiveStatus(existing.status) &&
    existing.activeRunId !== runId &&
    options.replaceExisting !== true
  ) {
    const restored = ensureSession({
      ...existing,
      meta: {
        ...(existing.meta || {}),
        protectedFromReplace: true,
      },
    });
    const protectedSnapshot = normalizeActiveRunSnapshot({
      ...existing,
      meta: {
        ...(existing.meta || {}),
        protectedFromReplace: true,
      },
    });
    activeSession = restored;
    activeSnapshot = protectedSnapshot;
    emitSnapshot(protectedSnapshot, "run_start_ignored_existing_active");
    recordRunSnapshotEvent("RUN_START_FAILED", protectedSnapshot, {
      reason: "existing_active_run",
      incomingRunId: runId,
      level: "warn",
    });
    if (protectedSnapshot.status === ACTIVE_RUN_STATUS.RUNNING) {
      await startBackgroundLocationUpdates({ force: false });
    }
    return protectedSnapshot;
  }

  const base = {
    activeRunId: runId,
    id: runId,
    userId: options.userId || "offline",
    mode: options.mode || "free",
    status: ACTIVE_RUN_STATUS.RUNNING,
    startedAtMs: nowMs,
    startedAt: options.startedAt || nowIso(nowMs),
    lastUpdatedAtMs: nowMs,
    lastUpdatedAt: nowIso(nowMs),
    notificationBody: NOTIFICATION_BODY,
    source: "foreground",
    meta: options.meta || {},
  };

  activeSession = createTrackingSessionFromSnapshot({
    ...base,
    points: [],
    rawPoints: [],
    segments: [],
  });
  activeSession.start?.({ startedAt: nowMs });
  const snapshot = createSnapshotFromTrackingSession(activeSession, base, {
    status: ACTIVE_RUN_STATUS.RUNNING,
    nowMs,
    source: "foreground",
  });
  const saved = await persistSnapshot(snapshot, "run_started");
  await startBackgroundLocationUpdates({ force: true });
  recordRunSnapshotEvent("RUN_STARTED", saved);
  return saved;
}

export async function restoreActiveRun(options = {}) {
  recordRunEvent("RECOVERY_STARTED", {
    source: options.snapshot ? "provided_snapshot" : "canonical_storage",
  });
  if (options.snapshot) {
    return hydrateActiveRunSnapshot(options.snapshot, {
      ...options,
      event: options.event || "run_restored",
    });
  }

  const snapshot = await loadPersistedSnapshot();
  if (!snapshot) return null;
  logRunRecovery("loaded active run", {
    activeRunId: snapshot.activeRunId,
    status: snapshot.status,
    segments: snapshot.segments?.length || 0,
    points: snapshot.trustedPath?.length || 0,
  });

  return hydrateActiveRunSnapshot({
    ...snapshot,
    meta: {
      ...(snapshot.meta || {}),
      recovered: true,
    },
  }, {
    ...options,
    event: "run_restored",
  });
}

export async function hydrateActiveRunSnapshot(snapshot = {}, options = {}) {
  try {
    const normalized = normalizeActiveRunSnapshot({
      ...snapshot,
      meta: {
        ...(snapshot.meta || {}),
        recovered: Boolean(snapshot.meta?.recovered || options.recovered),
      },
    });
    if (!normalized?.activeRunId) return null;

    const existing = activeSnapshot || (await loadPersistedSnapshot());
    if (
      existing?.activeRunId &&
      existing.activeRunId !== normalized.activeRunId &&
      isLiveStatus(existing.status) &&
      options.replaceExisting !== true
    ) {
      const protectedSnapshot = normalizeActiveRunSnapshot({
        ...existing,
        meta: {
          ...(existing.meta || {}),
          protectedFromReplace: true,
        },
      });
      activeSession = createTrackingSessionFromSnapshot(protectedSnapshot);
      activeSnapshot = protectedSnapshot;
      log("run_hydrate_ignored_existing_active", {
        activeRunId: protectedSnapshot.activeRunId,
        incomingRunId: normalized.activeRunId,
      });
      emitSnapshot(protectedSnapshot, "run_hydrate_ignored_existing_active");
      return protectedSnapshot;
    }

    logRunRecovery("segments before merge", {
      activeRunId: normalized.activeRunId,
      existingSegments: existing?.segments?.length || 0,
      incomingSegments: normalized.segments?.length || 0,
      existingPoints: existing?.trustedPath?.length || existing?.path?.length || 0,
      incomingPoints: normalized.trustedPath?.length || normalized.path?.length || 0,
    });

    const reconciled = existing?.activeRunId === normalized.activeRunId
      ? mergeActiveRunSnapshots(existing, normalized, options)
      : normalized;

    recordRunSnapshotEvent("RECOVERY_MERGED_STATE", reconciled, {
      existingSegments: existing?.segments?.length || 0,
      incomingSegments: normalized.segments?.length || 0,
    });

    logRunRecovery("segments after merge", {
      activeRunId: reconciled.activeRunId,
      segments: reconciled.segments?.length || 0,
      points: reconciled.trustedPath?.length || 0,
      distanceMeters: reconciled.distanceMeters,
    });

    activeSession = createTrackingSessionFromSnapshot(reconciled);
    const saved = await persistSnapshot(reconciled, options.event || "run_hydrated");

    log("run_hydrated", {
      activeRunId: saved.activeRunId,
      status: saved.status,
      points: saved.trustedPath?.length || 0,
      source: saved.source,
    });

    if (options.restartTracking !== false && saved.status === ACTIVE_RUN_STATUS.RUNNING) {
      await startBackgroundLocationUpdates({ force: false });
    }

    recordRunSnapshotEvent("RECOVERY_COMPLETED", saved, {
      event: options.event || "run_hydrated",
    });
    return saved;
  } catch (error) {
    recordRunEvent("RECOVERY_FAILED", {
      fn: "hydrateActiveRunSnapshot",
      error,
    });
    emitError(error, { fn: "hydrateActiveRunSnapshot" });
    return null;
  }
}

export async function recordLocation(location = {}, options = {}) {
  try {
    const session = await getActiveSession();
    if (!session || !activeSnapshot) return null;
    if (activeSnapshot.status !== ACTIVE_RUN_STATUS.RUNNING) return activeSnapshot;

    const source = options.source || location.source || "foreground";
    recordLocationPointEvent("LOCATION_POINT_RECEIVED", location, {
      ...summarizeRunSnapshot(activeSnapshot, {
        watcherStatus: backgroundStarted ? "background_started" : "foreground",
      }),
      source,
    });
    const result = session.processLocationPoint({
      ...location,
      source: source === "background" ? "expo-location" : location.source || source,
    });

    if (!result.accepted && !result.currentPositionChanged && !result.pathChanged) {
      log("point_ignored", { reason: result.reason, source });
      recordLocationPointEvent("LOCATION_POINT_REJECTED", result.rawPoint || location, {
        ...summarizeRunSnapshot(activeSnapshot),
        reason: result.reason || "ignored",
        action: result.action || "ignore",
        source,
      });
      return activeSnapshot;
    }

    if (result.accepted) {
      recordLocationPointEvent("LOCATION_POINT_ACCEPTED", result.point || location, {
        ...summarizeRunSnapshot(activeSnapshot),
        reason: result.reason || null,
        source,
        rawPointsCount: result.rawPath?.length || result.rawPoints?.length || 0,
        trustedPointsCount: result.trustedPath?.length || 0,
        segmentsCount: result.segments?.length || 0,
        distance: result.stats?.distanceMeters || 0,
      });
      logRunGeometry("append point to segment", {
        activeRunId: activeSnapshot.activeRunId,
        segmentId: result.point?.segmentId ?? null,
        points: result.trustedPath?.length || 0,
        source,
      });
    }

    const snapshot = createSnapshotFromTrackingSession(session, activeSnapshot, {
      status: ACTIVE_RUN_STATUS.RUNNING,
      source,
      nowMs: Date.now(),
    });
    return await persistSnapshot(snapshot, source === "background" ? "background_point_saved" : "foreground_point_saved");
  } catch (error) {
    emitError(error, { fn: "recordLocation" });
    return activeSnapshot;
  }
}

export async function pauseActiveRun(options = {}) {
  try {
    const session = await getActiveSession();
    if (!session || !activeSnapshot) return null;
    if (activeSnapshot.status === ACTIVE_RUN_STATUS.PAUSED) return activeSnapshot;
    if (activeSnapshot.status !== ACTIVE_RUN_STATUS.RUNNING) return activeSnapshot;
    const endedAt = Number(options.endedAtMs || Date.now());
    session.pause?.({ endedAt });
    const snapshot = createSnapshotFromTrackingSession(session, activeSnapshot, {
      status: ACTIVE_RUN_STATUS.PAUSED,
      nowMs: endedAt,
      source: options.source || "foreground",
    });
    const saved = await persistSnapshot(snapshot, "run_paused");
    await stopBackgroundLocationUpdates({ reason: "pause" });
    recordRunSnapshotEvent("PAUSE_SUCCESS", saved);
    return saved;
  } catch (error) {
    recordRunEvent("PAUSE_FAILED", { error });
    emitError(error, { fn: "pauseActiveRun" });
    return activeSnapshot;
  }
}

export async function resumeActiveRun(options = {}) {
  try {
    const session = await getActiveSession();
    if (!session || !activeSnapshot) return null;
    if (activeSnapshot.status === ACTIVE_RUN_STATUS.RUNNING) return activeSnapshot;
    if (activeSnapshot.status !== ACTIVE_RUN_STATUS.PAUSED) return activeSnapshot;
    const startedAt = Number(options.startedAtMs || Date.now());
    session.resume?.({ startedAt });
    const snapshot = createSnapshotFromTrackingSession(session, activeSnapshot, {
      status: ACTIVE_RUN_STATUS.RUNNING,
      nowMs: startedAt,
      source: options.source || "foreground",
    });
    const saved = await persistSnapshot(snapshot, "run_resumed");
    await startBackgroundLocationUpdates({ force: true });
    recordRunSnapshotEvent("RESUME_SUCCESS", saved);
    return saved;
  } catch (error) {
    recordRunEvent("RESUME_FAILED", { error });
    emitError(error, { fn: "resumeActiveRun" });
    return activeSnapshot;
  }
}

export async function finishActiveRun(options = {}) {
  try {
    const session = await getActiveSession();
    if (!session || !activeSnapshot) return null;
    if (activeSnapshot.status === ACTIVE_RUN_STATUS.FINISHED) return activeSnapshot;
    const finishedAtMs = Number(options.finishedAtMs || Date.now());
    const durationMs = calculateActiveRunDurationSeconds(activeSnapshot, { nowMs: finishedAtMs }) * 1000;
    const finish = session.finishTrackingSession?.({
      durationMs,
      finishedAt: finishedAtMs,
    });
    const snapshot = createSnapshotFromTrackingSession(session, {
      ...activeSnapshot,
      ...(finish || {}),
      finishedAtMs,
      finishedAt: options.finishedAt || nowIso(finishedAtMs),
    }, {
      status: ACTIVE_RUN_STATUS.FINISHED,
      nowMs: finishedAtMs,
      finishedAtMs,
      finishedAt: options.finishedAt || nowIso(finishedAtMs),
      source: options.source || "foreground",
    });
    const saved = await persistSnapshot(snapshot, "run_finished_snapshot_saved");
    await stopBackgroundLocationUpdates({ reason: "finish" });
    recordRunSnapshotEvent("FINISH_SUCCESS", saved);
    return saved;
  } catch (error) {
    recordRunEvent("FINISH_FAILED", { error });
    emitError(error, { fn: "finishActiveRun" });
    return activeSnapshot;
  }
}

export async function buildFinishedRunData(overrides = {}) {
  const snapshot = activeSnapshot || (await loadPersistedSnapshot());
  if (!snapshot) return null;
  return buildRunDataFromActiveSnapshot(snapshot, overrides);
}

export async function markActiveRunLocallySaved() {
  try {
    await storage.removeItem(ACTIVE_RUN_STORAGE_KEY);
    activeSession = null;
    activeSnapshot = null;
    log("active_snapshot_cleared", { reason: "local_run_saved" });
    recordRunEvent("RUN_SAVED_LOCAL", {
      reason: "local_run_saved",
    });
    emitSnapshot(null, "active_snapshot_cleared");
    return true;
  } catch (error) {
    emitError(error, { fn: "markActiveRunLocallySaved" });
    return false;
  }
}

export async function cancelActiveRun(options = {}) {
  try {
    await stopBackgroundLocationUpdates({ reason: options.reason || "cancel" });
    await storage.removeItem(ACTIVE_RUN_STORAGE_KEY);
    activeSession = null;
    activeSnapshot = null;
    log("run_cancelled", { reason: options.reason || "cancel" });
    recordRunEvent("RUN_CANCELLED", {
      reason: options.reason || "cancel",
    });
    emitSnapshot(null, "run_cancelled");
    return true;
  } catch (error) {
    emitError(error, { fn: "cancelActiveRun" });
    return false;
  }
}

async function handleBackgroundLocations(data = {}) {
  const locations = (Array.isArray(data.locations) ? data.locations : [])
    .filter((loc) => loc?.coords)
    .slice()
    .sort((a, b) => {
      const left = Number(a?.timestamp);
      const right = Number(b?.timestamp);
      if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
      if (!Number.isFinite(left)) return 1;
      if (!Number.isFinite(right)) return -1;
      return left - right;
    });
  if (locations.length === 0) return;
  for (const loc of locations) {
    await recordLocation({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: loc.coords.accuracy,
      speed: loc.coords.speed,
      heading: loc.coords.heading,
      altitude: loc.coords.altitude,
      altitudeAccuracy: loc.coords.altitudeAccuracy,
      timestamp: loc.timestamp,
      source: "background",
    }, { source: "background" });
  }
}

try {
  const defined =
    TaskManager &&
    typeof TaskManager.isTaskDefined === "function" &&
    TaskManager.isTaskDefined(ACTIVE_RUN_LOCATION_TASK);
  if (TaskManager && typeof TaskManager.defineTask === "function" && !defined) {
    TaskManager.defineTask(ACTIVE_RUN_LOCATION_TASK, async ({ data, error }) => {
      if (error) {
        emitError(error, { fn: "backgroundLocationTask" });
        return;
      }
      await handleBackgroundLocations(data || {});
    });
  }
} catch (error) {
  emitError(error, { fn: "defineBackgroundLocationTask" });
}

export function __setActiveRunStorageForTests(nextStorage) {
  storage = nextStorage || AsyncStorage;
}

export function __resetActiveRunRuntimeForTests() {
  activeSession = null;
  activeSnapshot = null;
  backgroundStarted = false;
  listeners.snapshot.clear();
  listeners.error.clear();
}

export default {
  ACTIVE_RUN_LOCATION_TASK,
  ACTIVE_RUN_STATUS,
  buildFinishedRunData,
  cancelActiveRun,
  finishActiveRun,
  getActiveRunSnapshot,
  getCurrentDurationSeconds,
  getTrackingRuntimeStatus,
  hasActiveRunSnapshot,
  hydrateActiveRunSnapshot,
  markActiveRunLocallySaved,
  onActiveRunError,
  onActiveRunSnapshot,
  pauseActiveRun,
  recordLocation,
  restoreActiveRun,
  resumeActiveRun,
  setActiveRunDebug,
  startActiveRun,
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
};
