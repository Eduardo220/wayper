import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import activeRunTrackingService from "../runTracking/activeRunTrackingService.js";
import { flushActiveRunCheckpoint } from "./runAutoSaveService.js";
import {
  ACTIVE_RUN_STATUS,
  calculateActiveRunDurationSeconds,
} from "../runTracking/activeRunState.js";
import logger, { LOG_CATEGORIES } from "../../utils/logger.js";
import {
  recordRunEvent,
  recordRunSnapshotEvent,
} from "../diagnostics/runDiagnosticsService.js";

export const RUN_NOTIFICATION_CHANNEL_ID = "wayper_run_tracking";
export const RUN_NOTIFICATION_ID = 4217;
export const RUN_NOTIFICATION_UPDATE_INTERVAL_MS = 5000;
export const RUN_NOTIFICATION_NATIVE_UPDATE_MIN_INTERVAL_MS = 4000;
export const RUN_NOTIFICATION_ACTION = {
  PAUSE: "pause",
  RESUME: "resume",
};

const NOTIFICATION_TITLE = "Wayper";
const DEFAULT_NATIVE_MODULE = NativeModules?.WayperRunNotificationAndroid || null;

let nativeModuleOverride = null;
let trackingServiceOverride = null;
let runtimeServiceOverride = null;
let notificationActive = false;
let lastPayloadKey = "";
let lastStatusKey = "";
let lastNativeUpdateAt = 0;
let updateTimer = null;
let unsubscribeSnapshots = null;

function reportNotificationCoordinatorFailure(event, error, extra = {}) {
  logger.error(LOG_CATEGORIES.NOTIFICATION, event, {
    error,
    ...extra,
  });
  recordRunEvent(event, {
    error,
    level: "error",
    ...extra,
  }, {
    category: LOG_CATEGORIES.NOTIFICATION,
  });
}

const getNativeModule = () => nativeModuleOverride || DEFAULT_NATIVE_MODULE;
const getTrackingService = () => trackingServiceOverride || activeRunTrackingService;
const getRuntimeService = async () => {
  if (runtimeServiceOverride) return runtimeServiceOverride;
  const module = await import("../runTracking/activeRunRuntimeService.js");
  return module.default || module;
};

export function isRunNotificationSupported() {
  return Platform.OS === "android" && Boolean(getNativeModule());
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function formatElapsedTime(seconds = 0) {
  const total = Math.max(0, Math.floor(toNumber(seconds, 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDistanceKm(distanceKm = 0) {
  const value = Math.max(0, toNumber(distanceKm, 0));
  return `${value.toFixed(2).replace(".", ",")} km`;
}

export function normalizeRunNotificationStatusLabel({
  status,
  statusLabel,
  isPaused = false,
} = {}) {
  if (typeof statusLabel === "string" && statusLabel.trim()) {
    return statusLabel.trim();
  }

  const normalizedStatus = String(status || "").toUpperCase();
  if (normalizedStatus === ACTIVE_RUN_STATUS.PAUSED || isPaused) return "Pausada";
  if (normalizedStatus === "RECOVERING") return "Recuperando";
  if (normalizedStatus === "FINISHING" || normalizedStatus === "SAVING") return "Salvando";
  return "Correndo";
}

export function formatRunNotificationText({
  elapsedTime = 0,
  elapsedTimeSeconds,
  distanceKm = 0,
  isPaused = false,
  status,
  statusLabel,
} = {}) {
  const seconds = elapsedTimeSeconds ?? elapsedTime;
  const stateLabel = normalizeRunNotificationStatusLabel({ status, statusLabel, isPaused });
  return `${stateLabel} - ${formatElapsedTime(seconds)} - ${formatDistanceKm(distanceKm)}`;
}

export function normalizeRunNotificationPayload(payload = {}) {
  const elapsedTimeSeconds = Math.max(
    0,
    Math.floor(toNumber(payload.elapsedTimeSeconds ?? payload.elapsedTime ?? payload.durationSeconds, 0))
  );
  const distanceKm = Math.max(
    0,
    toNumber(
      payload.distanceKm,
      toNumber(payload.distanceMeters ?? payload.distance, 0) / 1000
    )
  );
  const isPaused = Boolean(payload.isPaused);
  const status = String(
    payload.status || (isPaused ? ACTIVE_RUN_STATUS.PAUSED : ACTIVE_RUN_STATUS.RUNNING)
  ).toUpperCase();
  const statusLabel = normalizeRunNotificationStatusLabel({
    status,
    statusLabel: payload.statusLabel,
    isPaused,
  });
  const text = formatRunNotificationText({
    elapsedTimeSeconds,
    distanceKm,
    isPaused,
    status,
    statusLabel,
  });

  return {
    notificationId: RUN_NOTIFICATION_ID,
    channelId: RUN_NOTIFICATION_CHANNEL_ID,
    title: NOTIFICATION_TITLE,
    text,
    elapsedTimeSeconds,
    distanceKm,
    isPaused,
    status,
    statusLabel,
    action: isPaused ? RUN_NOTIFICATION_ACTION.RESUME : RUN_NOTIFICATION_ACTION.PAUSE,
    actionLabel: isPaused ? "Retomar" : "Pausar",
  };
}

export function buildRunNotificationPayloadFromSnapshot(snapshot = {}, nowMs = Date.now()) {
  const status = String(snapshot?.status || ACTIVE_RUN_STATUS.RUNNING).toUpperCase();
  return normalizeRunNotificationPayload({
    elapsedTimeSeconds: calculateActiveRunDurationSeconds(snapshot, { nowMs }),
    distanceMeters: snapshot?.distanceMeters ?? snapshot?.distance ?? 0,
    isPaused: status === ACTIVE_RUN_STATUS.PAUSED,
    status,
  });
}

function getPayloadKey(payload = {}) {
  return [
    payload.elapsedTimeSeconds,
    Math.round(toNumber(payload.distanceKm, 0) * 1000),
    payload.isPaused ? "paused" : "running",
  ].join(":");
}

function getStatusKey(payload = {}) {
  return [
    payload.status || "",
    payload.statusLabel || "",
    payload.isPaused ? "paused" : "running",
    payload.action || "",
  ].join(":");
}

function shouldThrottleNativeUpdate(payload = {}, key = "", options = {}) {
  if (options.force || !notificationActive || key === lastPayloadKey) return false;

  const statusKey = getStatusKey(payload);
  if (statusKey !== lastStatusKey) return false;

  const minIntervalMs = Math.max(
    0,
    toNumber(options.minIntervalMs, RUN_NOTIFICATION_NATIVE_UPDATE_MIN_INTERVAL_MS)
  );
  return minIntervalMs > 0 && Date.now() - lastNativeUpdateAt < minIntervalMs;
}

function clearUpdateTimer() {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
}

function normalizeNativeNotificationState(state = {}) {
  const isActive = Boolean(state?.isActive);
  const status = String(state?.status || (isActive ? "UNKNOWN" : "IDLE")).toUpperCase();
  return {
    isActive,
    channelId: state?.channelId || RUN_NOTIFICATION_CHANNEL_ID,
    notificationId: state?.notificationId || RUN_NOTIFICATION_ID,
    status,
    lastUpdatedAt: state?.lastUpdatedAt || null,
    title: state?.title || NOTIFICATION_TITLE,
    text: state?.text || null,
    hasForegroundService: Boolean(state?.hasForegroundService || isActive),
  };
}

export async function getNativeNotificationState() {
  const nativeModule = getNativeModule();
  if (!isRunNotificationSupported() || !nativeModule) {
    const fallback = normalizeNativeNotificationState({
      isActive: notificationActive,
      status: notificationActive ? "UNKNOWN" : "IDLE",
      hasForegroundService: notificationActive,
    });
    recordRunEvent("RUN_NOTIFICATION_NATIVE_STATE_READ", fallback, {
      category: LOG_CATEGORIES.NOTIFICATION,
    });
    return fallback;
  }

  try {
    let state = null;
    if (typeof nativeModule.getState === "function") {
      state = await nativeModule.getState();
    } else if (typeof nativeModule.getLastNotificationState === "function") {
      state = await nativeModule.getLastNotificationState();
    } else if (typeof nativeModule.isActive === "function") {
      state = { isActive: await nativeModule.isActive() };
    }
    const normalized = normalizeNativeNotificationState(state || {
      isActive: notificationActive,
      status: notificationActive ? "UNKNOWN" : "IDLE",
    });
    recordRunEvent("RUN_NOTIFICATION_NATIVE_STATE_READ", normalized, {
      category: LOG_CATEGORIES.NOTIFICATION,
    });
    return normalized;
  } catch (error) {
    const fallback = normalizeNativeNotificationState({
      isActive: notificationActive,
      status: notificationActive ? "UNKNOWN" : "UNKNOWN",
      hasForegroundService: notificationActive,
    });
    recordRunEvent("RUN_NOTIFICATION_NATIVE_STATE_READ", {
      ...fallback,
      error,
      level: "warn",
    }, {
      category: LOG_CATEGORIES.NOTIFICATION,
    });
    return fallback;
  }
}

function isLiveSnapshot(snapshot = {}) {
  const status = String(snapshot?.status || "").toUpperCase();
  return status === ACTIVE_RUN_STATUS.RUNNING || status === ACTIVE_RUN_STATUS.PAUSED;
}

async function refreshFromTrackingSnapshot() {
  try {
    const trackingService = getTrackingService();
    const snapshot = await trackingService.getActiveRunSnapshot?.();
    if (!snapshot || !isLiveSnapshot(snapshot)) {
      await stopRunNotification();
      return null;
    }
    return updateRunNotification(buildRunNotificationPayloadFromSnapshot(snapshot), {
      requestPermission: false,
    });
  } catch (error) {
    recordRunEvent("RUN_NOTIFICATION_REFRESH_FAILED", {
      error,
      level: "warn",
    }, {
      category: LOG_CATEGORIES.NOTIFICATION,
    });
    return null;
  }
}

function startUpdateTimer() {
  if (updateTimer || !isRunNotificationSupported()) return;
  updateTimer = setInterval(() => {
    refreshFromTrackingSnapshot().catch((error) => {
      recordRunEvent("RUN_NOTIFICATION_REFRESH_FAILED", {
        error,
        level: "warn",
      }, {
        category: LOG_CATEGORIES.NOTIFICATION,
      });
    });
  }, RUN_NOTIFICATION_UPDATE_INTERVAL_MS);
}

export async function ensureRunNotificationPermission({ request = false } = {}) {
  if (Platform.OS !== "android") {
    logger.debug(LOG_CATEGORIES.NOTIFICATION, "NOTIFICATION_PERMISSION_UNAVAILABLE", {
      platform: Platform.OS,
    });
    return { granted: true, status: "unavailable" };
  }

  if (Number(Platform.Version || 0) < 33) {
    logger.debug(LOG_CATEGORIES.NOTIFICATION, "NOTIFICATION_PERMISSION_IMPLICIT", {
      platformVersion: Platform.Version,
    });
    return { granted: true, status: "granted" };
  }

  const permission = PermissionsAndroid?.PERMISSIONS?.POST_NOTIFICATIONS;
  if (!permission || typeof PermissionsAndroid?.check !== "function") {
    logger.warn(LOG_CATEGORIES.NOTIFICATION, "NOTIFICATION_PERMISSION_UNAVAILABLE", {
      platformVersion: Platform.Version,
    });
    return { granted: false, status: "unavailable" };
  }

  const granted = await PermissionsAndroid.check(permission);
  if (granted || !request || typeof PermissionsAndroid?.request !== "function") {
    logger[granted ? "info" : "warn"](LOG_CATEGORIES.NOTIFICATION, "NOTIFICATION_PERMISSION_CHECKED", {
      granted,
      status: granted ? "granted" : "denied",
      request,
    });
    return { granted, status: granted ? "granted" : "denied" };
  }

  const response = await PermissionsAndroid.request(permission);
  const grantedStatus = PermissionsAndroid.RESULTS?.GRANTED || "granted";
  const nextGranted = response === grantedStatus;
  logger[nextGranted ? "info" : "warn"](LOG_CATEGORIES.NOTIFICATION, "NOTIFICATION_PERMISSION_REQUESTED", {
    granted: nextGranted,
    status: nextGranted ? "granted" : response || "denied",
  });
  return {
    granted: nextGranted,
    status: nextGranted ? "granted" : response || "denied",
  };
}

export async function configureRunNotificationActions() {
  const nativeModule = getNativeModule();
  if (!isRunNotificationSupported() || typeof nativeModule?.configureRunNotificationActions !== "function") {
    return false;
  }
  await nativeModule.configureRunNotificationActions({
    channelId: RUN_NOTIFICATION_CHANNEL_ID,
    notificationId: RUN_NOTIFICATION_ID,
  });
  return true;
}

export async function startRunNotification(payload = {}, options = {}) {
  const nativeModule = getNativeModule();
  if (!isRunNotificationSupported() || !nativeModule) {
    logger.warn(LOG_CATEGORIES.NOTIFICATION, "RUN_NOTIFICATION_UNSUPPORTED", {
      platform: Platform.OS,
    });
    return false;
  }

  const permission = await ensureRunNotificationPermission({ request: options.requestPermission !== false });
  if (!permission.granted) {
    logger.warn(LOG_CATEGORIES.NOTIFICATION, "RUN_NOTIFICATION_PERMISSION_DENIED", permission);
    // Android 13+ still requires the foreground-service notification to be
    // created, but POST_NOTIFICATIONS is not required to launch the FGS. When
    // denied, Android keeps the service visible in Active apps/Task Manager.
    // Skipping the native start here would remove the process-lifetime anchor
    // exactly when tracking needs it most.
  }

  await configureRunNotificationActions();
  const normalized = normalizeRunNotificationPayload(payload);
  const method = notificationActive && typeof nativeModule.updateRunNotification === "function"
    ? "updateRunNotification"
    : "startRunNotification";

  if (typeof nativeModule[method] !== "function") return false;
  await nativeModule[method](normalized);
  notificationActive = true;
  getTrackingService().setRunRuntimeSurfaceState?.({
    notificationStatus: "active",
  });
  lastPayloadKey = getPayloadKey(normalized);
  lastStatusKey = getStatusKey(normalized);
  lastNativeUpdateAt = Date.now();
  if (options.scheduleTimer !== false) startUpdateTimer();
  logger.info(LOG_CATEGORIES.NOTIFICATION, "RUN_NOTIFICATION_STARTED", {
    method,
    status: normalized.status,
    isPaused: normalized.isPaused,
    elapsedTimeSeconds: normalized.elapsedTimeSeconds,
    distanceKm: normalized.distanceKm,
  });
  return true;
}

export async function updateRunNotification(payload = {}, options = {}) {
  const nativeModule = getNativeModule();
  if (!isRunNotificationSupported() || !nativeModule) return false;

  const normalized = normalizeRunNotificationPayload(payload);
  const key = getPayloadKey(normalized);
  if (!options.force && notificationActive && key === lastPayloadKey) {
    return true;
  }

  if (!notificationActive) {
    return startRunNotification(normalized, options);
  }

  if (shouldThrottleNativeUpdate(normalized, key, options)) {
    return true;
  }

  if (typeof nativeModule.updateRunNotification !== "function") return false;
  await nativeModule.updateRunNotification(normalized);
  getTrackingService().setRunRuntimeSurfaceState?.({
    notificationStatus: "active",
  });
  lastPayloadKey = key;
  lastStatusKey = getStatusKey(normalized);
  lastNativeUpdateAt = Date.now();
  logger.debug(LOG_CATEGORIES.NOTIFICATION, "RUN_NOTIFICATION_UPDATED", {
    status: normalized.status,
    isPaused: normalized.isPaused,
    elapsedTimeSeconds: normalized.elapsedTimeSeconds,
    distanceKm: normalized.distanceKm,
  });
  return true;
}

export async function stopRunNotification() {
  clearUpdateTimer();
  lastPayloadKey = "";
  lastStatusKey = "";
  lastNativeUpdateAt = 0;
  notificationActive = false;
  getTrackingService().setRunRuntimeSurfaceState?.({
    notificationStatus: "stopped",
  });

  const nativeModule = getNativeModule();
  if (!isRunNotificationSupported() || typeof nativeModule?.stopRunNotification !== "function") {
    return false;
  }

  await nativeModule.stopRunNotification({
    channelId: RUN_NOTIFICATION_CHANNEL_ID,
    notificationId: RUN_NOTIFICATION_ID,
  });
  logger.info(LOG_CATEGORIES.NOTIFICATION, "RUN_NOTIFICATION_STOPPED", {
    channelId: RUN_NOTIFICATION_CHANNEL_ID,
    notificationId: RUN_NOTIFICATION_ID,
  });
  return true;
}

export async function pauseRunFromNotification() {
  return runNotificationActionThroughRuntime(RUN_NOTIFICATION_ACTION.PAUSE);
}

export async function resumeRunFromNotification() {
  return runNotificationActionThroughRuntime(RUN_NOTIFICATION_ACTION.RESUME);
}

async function runNotificationActionThroughRuntime(action) {
  const normalizedAction = String(action || "").toLowerCase();
  const trackingService = getTrackingService();
  const runtimeService = await getRuntimeService();
  runtimeService.recordNotificationAction?.(normalizedAction, {
    source: "notification_action_handler",
  });
  const result = await runtimeService.hydrateActiveRunFromRuntime?.(`notification_action:${normalizedAction}`, {
    restartTracking: true,
    forceNotification: true,
  });
  let snapshot = result?.snapshot || null;
  const status = String(snapshot?.status || "").toUpperCase();

  if (!snapshot?.activeRunId) {
    recordRunEvent("RUN_NOTIFICATION_ACTION_IGNORED", {
      action: normalizedAction,
      reason: "no_active_snapshot_after_reconcile",
      recoveryStatus: result?.runtime?.status || null,
      level: "warn",
    }, {
      category: LOG_CATEGORIES.NOTIFICATION,
    });
    return null;
  }

  if (normalizedAction === RUN_NOTIFICATION_ACTION.PAUSE || normalizedAction === "stop") {
    if (status !== ACTIVE_RUN_STATUS.RUNNING) {
      await updateRunNotification(buildRunNotificationPayloadFromSnapshot(snapshot), {
        force: true,
        requestPermission: false,
      });
      return snapshot;
    }
    recordRunSnapshotEvent("PAUSE_PRESSED", snapshot, {
      source: "notification",
    });
    const paused = await trackingService.pauseActiveRun?.({
      endedAtMs: Date.now(),
      source: "notification",
    });
    snapshot = paused || snapshot;
    if (paused) {
      await flushActiveRunCheckpoint({
        reason: "notification_pause",
        checkpointAtMs: Date.now(),
      });
      recordRunSnapshotEvent("PAUSE_SUCCESS", paused, {
        source: "notification",
      });
    }
    await updateRunNotification(buildRunNotificationPayloadFromSnapshot(snapshot), {
      force: true,
      requestPermission: false,
    });
    return snapshot;
  }

  if (normalizedAction === RUN_NOTIFICATION_ACTION.RESUME || normalizedAction === "start") {
    if (status !== ACTIVE_RUN_STATUS.PAUSED) {
      await updateRunNotification(buildRunNotificationPayloadFromSnapshot(snapshot), {
        force: true,
        requestPermission: false,
      });
      return snapshot;
    }
    recordRunSnapshotEvent("RESUME_PRESSED", snapshot, {
      source: "notification",
    });
    const resumed = await trackingService.resumeActiveRun?.({
      startedAtMs: Date.now(),
      source: "notification",
    });
    snapshot = resumed || snapshot;
    if (resumed) {
      await flushActiveRunCheckpoint({
        reason: "notification_resume",
        checkpointAtMs: Date.now(),
      });
      recordRunSnapshotEvent("RESUME_SUCCESS", resumed, {
        source: "notification",
      });
    }
    await updateRunNotification(buildRunNotificationPayloadFromSnapshot(snapshot), {
      force: true,
      requestPermission: false,
    });
    return snapshot;
  }

  return snapshot;
}

export async function handleRunNotificationAction(action) {
  const normalized = String(action || "").toLowerCase();
  recordRunEvent("RUN_NOTIFICATION_ACTION_RECEIVED", {
    action: normalized,
  }, {
    category: LOG_CATEGORIES.NOTIFICATION,
  });
  recordRunEvent("RUN_NOTIFICATION_ACTION", {
    action: normalized,
  }, {
    category: LOG_CATEGORIES.NOTIFICATION,
  });
  if (normalized === RUN_NOTIFICATION_ACTION.PAUSE || normalized === "stop") {
    return pauseRunFromNotification();
  }
  if (normalized === RUN_NOTIFICATION_ACTION.RESUME || normalized === "start") {
    return resumeRunFromNotification();
  }
  return null;
}

export function startRunNotificationCoordinator() {
  if (unsubscribeSnapshots) return stopRunNotificationCoordinator;

  configureRunNotificationActions().catch((error) => {
    reportNotificationCoordinatorFailure("RUN_NOTIFICATION_ACTIONS_CONFIG_FAILED", error, {
      phase: "coordinator_start",
    });
  });
  refreshFromTrackingSnapshot().catch((error) => {
    reportNotificationCoordinatorFailure("RUN_NOTIFICATION_REFRESH_FAILED", error, {
      phase: "coordinator_start",
    });
  });

  const trackingService = getTrackingService();
  unsubscribeSnapshots = trackingService.onActiveRunSnapshot?.(({ event, snapshot }) => {
    if (
      event === "active_snapshot_cleared" ||
      event === "run_cancelled" ||
      !snapshot ||
      !isLiveSnapshot(snapshot)
    ) {
      stopRunNotification().catch((error) => {
        reportNotificationCoordinatorFailure("RUN_NOTIFICATION_STOP_FAILED", error, {
          sourceEvent: event || null,
        });
      });
      return;
    }

    const payload = buildRunNotificationPayloadFromSnapshot(snapshot);
    if (!notificationActive) {
      startRunNotification(payload, { requestPermission: false }).catch((error) => {
        reportNotificationCoordinatorFailure("RUN_NOTIFICATION_START_FAILED", error, {
          sourceEvent: event || null,
        });
      });
    } else {
      updateRunNotification(payload).catch((error) => {
        reportNotificationCoordinatorFailure("RUN_NOTIFICATION_UPDATE_FAILED", error, {
          sourceEvent: event || null,
        });
      });
    }
  }) || null;

  return stopRunNotificationCoordinator;
}

export function stopRunNotificationCoordinator() {
  if (unsubscribeSnapshots) {
    try {
      unsubscribeSnapshots();
    } catch (error) {
      reportNotificationCoordinatorFailure("RUN_NOTIFICATION_UNSUBSCRIBE_FAILED", error);
    }
    unsubscribeSnapshots = null;
  }
  clearUpdateTimer();
}

export function __setRunNotificationDependenciesForTests({ nativeModule, trackingService, runtimeService } = {}) {
  nativeModuleOverride = nativeModule === undefined ? nativeModuleOverride : nativeModule;
  trackingServiceOverride = trackingService === undefined ? trackingServiceOverride : trackingService;
  runtimeServiceOverride = runtimeService === undefined ? runtimeServiceOverride : runtimeService;
}

export function __resetRunNotificationServiceForTests() {
  stopRunNotificationCoordinator();
  clearUpdateTimer();
  notificationActive = false;
  lastPayloadKey = "";
  lastStatusKey = "";
  lastNativeUpdateAt = 0;
  nativeModuleOverride = null;
  trackingServiceOverride = null;
  runtimeServiceOverride = null;
}

export async function handleRunNotificationActionTask(data = {}) {
  return handleRunNotificationAction(data.action || data.runAction || data.type);
}

export default {
  RUN_NOTIFICATION_ACTION,
  RUN_NOTIFICATION_CHANNEL_ID,
  RUN_NOTIFICATION_ID,
  RUN_NOTIFICATION_NATIVE_UPDATE_MIN_INTERVAL_MS,
  RUN_NOTIFICATION_UPDATE_INTERVAL_MS,
  buildRunNotificationPayloadFromSnapshot,
  configureRunNotificationActions,
  ensureRunNotificationPermission,
  formatDistanceKm,
  formatElapsedTime,
  formatRunNotificationText,
  getNativeNotificationState,
  handleRunNotificationAction,
  handleRunNotificationActionTask,
  isRunNotificationSupported,
  normalizeRunNotificationPayload,
  normalizeRunNotificationStatusLabel,
  pauseRunFromNotification,
  resumeRunFromNotification,
  startRunNotification,
  startRunNotificationCoordinator,
  stopRunNotification,
  stopRunNotificationCoordinator,
  updateRunNotification,
};
