import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import activeRunTrackingService from "../runTracking/activeRunTrackingService.js";
import { flushActiveRunCheckpoint } from "./runAutoSaveService.js";
import {
  ACTIVE_RUN_STATUS,
  calculateActiveRunDurationSeconds,
} from "../runTracking/activeRunState.js";

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
let notificationActive = false;
let lastPayloadKey = "";
let lastStatusKey = "";
let lastNativeUpdateAt = 0;
let updateTimer = null;
let unsubscribeSnapshots = null;

const getNativeModule = () => nativeModuleOverride || DEFAULT_NATIVE_MODULE;
const getTrackingService = () => trackingServiceOverride || activeRunTrackingService;

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
  } catch {
    return null;
  }
}

function startUpdateTimer() {
  if (updateTimer || !isRunNotificationSupported()) return;
  updateTimer = setInterval(() => {
    refreshFromTrackingSnapshot();
  }, RUN_NOTIFICATION_UPDATE_INTERVAL_MS);
}

export async function ensureRunNotificationPermission({ request = false } = {}) {
  if (Platform.OS !== "android") {
    return { granted: true, status: "unavailable" };
  }

  if (Number(Platform.Version || 0) < 33) {
    return { granted: true, status: "granted" };
  }

  const permission = PermissionsAndroid?.PERMISSIONS?.POST_NOTIFICATIONS;
  if (!permission || typeof PermissionsAndroid?.check !== "function") {
    return { granted: false, status: "unavailable" };
  }

  const granted = await PermissionsAndroid.check(permission);
  if (granted || !request || typeof PermissionsAndroid?.request !== "function") {
    return { granted, status: granted ? "granted" : "denied" };
  }

  const response = await PermissionsAndroid.request(permission);
  const grantedStatus = PermissionsAndroid.RESULTS?.GRANTED || "granted";
  const nextGranted = response === grantedStatus;
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
  if (!isRunNotificationSupported() || !nativeModule) return false;

  const permission = await ensureRunNotificationPermission({ request: options.requestPermission !== false });
  if (!permission.granted) return false;

  await configureRunNotificationActions();
  const normalized = normalizeRunNotificationPayload(payload);
  const method = notificationActive && typeof nativeModule.updateRunNotification === "function"
    ? "updateRunNotification"
    : "startRunNotification";

  if (typeof nativeModule[method] !== "function") return false;
  await nativeModule[method](normalized);
  notificationActive = true;
  lastPayloadKey = getPayloadKey(normalized);
  lastStatusKey = getStatusKey(normalized);
  lastNativeUpdateAt = Date.now();
  if (options.scheduleTimer !== false) startUpdateTimer();
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
  lastPayloadKey = key;
  lastStatusKey = getStatusKey(normalized);
  lastNativeUpdateAt = Date.now();
  return true;
}

export async function stopRunNotification() {
  clearUpdateTimer();
  lastPayloadKey = "";
  lastStatusKey = "";
  lastNativeUpdateAt = 0;
  notificationActive = false;

  const nativeModule = getNativeModule();
  if (!isRunNotificationSupported() || typeof nativeModule?.stopRunNotification !== "function") {
    return false;
  }

  await nativeModule.stopRunNotification({
    channelId: RUN_NOTIFICATION_CHANNEL_ID,
    notificationId: RUN_NOTIFICATION_ID,
  });
  return true;
}

export async function pauseRunFromNotification() {
  const trackingService = getTrackingService();
  const snapshot = await trackingService.getActiveRunSnapshot?.();
  if (!snapshot || String(snapshot.status).toUpperCase() !== ACTIVE_RUN_STATUS.RUNNING) {
    if (snapshot && isLiveSnapshot(snapshot)) {
      await updateRunNotification(buildRunNotificationPayloadFromSnapshot(snapshot), {
        force: true,
        requestPermission: false,
      });
    }
    return snapshot || null;
  }

  const paused = await trackingService.pauseActiveRun?.({
    endedAtMs: Date.now(),
    source: "notification",
  });
  if (paused) {
    await flushActiveRunCheckpoint({
      reason: "notification_pause",
      checkpointAtMs: Date.now(),
    });
    await updateRunNotification(buildRunNotificationPayloadFromSnapshot(paused), {
      force: true,
      requestPermission: false,
    });
  }
  return paused || snapshot;
}

export async function resumeRunFromNotification() {
  const trackingService = getTrackingService();
  const snapshot = await trackingService.getActiveRunSnapshot?.();
  if (!snapshot || String(snapshot.status).toUpperCase() !== ACTIVE_RUN_STATUS.PAUSED) {
    if (snapshot && isLiveSnapshot(snapshot)) {
      await updateRunNotification(buildRunNotificationPayloadFromSnapshot(snapshot), {
        force: true,
        requestPermission: false,
      });
    }
    return snapshot || null;
  }

  const resumed = await trackingService.resumeActiveRun?.({
    startedAtMs: Date.now(),
    source: "notification",
  });
  if (resumed) {
    await flushActiveRunCheckpoint({
      reason: "notification_resume",
      checkpointAtMs: Date.now(),
    });
    await updateRunNotification(buildRunNotificationPayloadFromSnapshot(resumed), {
      force: true,
      requestPermission: false,
    });
  }
  return resumed || snapshot;
}

export async function handleRunNotificationAction(action) {
  const normalized = String(action || "").toLowerCase();
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

  configureRunNotificationActions().catch(() => {});
  refreshFromTrackingSnapshot();

  const trackingService = getTrackingService();
  unsubscribeSnapshots = trackingService.onActiveRunSnapshot?.(({ event, snapshot }) => {
    if (
      event === "active_snapshot_cleared" ||
      event === "run_cancelled" ||
      !snapshot ||
      !isLiveSnapshot(snapshot)
    ) {
      stopRunNotification().catch(() => {});
      return;
    }

    const payload = buildRunNotificationPayloadFromSnapshot(snapshot);
    if (!notificationActive) {
      startRunNotification(payload, { requestPermission: false }).catch(() => {});
    } else {
      updateRunNotification(payload).catch(() => {});
    }
  }) || null;

  return stopRunNotificationCoordinator;
}

export function stopRunNotificationCoordinator() {
  if (unsubscribeSnapshots) {
    try {
      unsubscribeSnapshots();
    } catch {}
    unsubscribeSnapshots = null;
  }
  clearUpdateTimer();
}

export function __setRunNotificationDependenciesForTests({ nativeModule, trackingService } = {}) {
  nativeModuleOverride = nativeModule === undefined ? nativeModuleOverride : nativeModule;
  trackingServiceOverride = trackingService === undefined ? trackingServiceOverride : trackingService;
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
