import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { registerMonitoringSink } from "./monitoringBridge.js";
import {
  anonymizeIdentifier,
  sanitizeSentryBreadcrumb,
  sanitizeSentryContext,
  sanitizeSentryEvent,
} from "./sentrySanitizer.js";

const PUBLIC_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || "";
const PUBLIC_ENVIRONMENT = process.env.EXPO_PUBLIC_APP_ENV || "";
const PUBLIC_APPLICATION_ID = process.env.EXPO_PUBLIC_APPLICATION_ID || "";
const PUBLIC_APP_VARIANT = process.env.EXPO_PUBLIC_APP_VARIANT || "";
const PUBLIC_BUILD_PROFILE = process.env.EXPO_PUBLIC_BUILD_PROFILE || "";
const PUBLIC_UPDATE_CHANNEL = process.env.EXPO_PUBLIC_EAS_UPDATE_CHANNEL || "";
const PUBLIC_ENABLE_DEV = process.env.EXPO_PUBLIC_SENTRY_ENABLE_DEV === "true";
const PUBLIC_ENABLED = process.env.EXPO_PUBLIC_SENTRY_ENABLED !== "false";
const PUBLIC_TEST_ENABLED = process.env.EXPO_PUBLIC_SENTRY_TEST_ENABLED === "true";
const PUBLIC_DEBUG_ENABLED = process.env.EXPO_PUBLIC_SENTRY_DEBUG === "true";

const LOCATION_BREADCRUMB_INTERVAL_MS = 30_000;
const LOCATION_BREADCRUMB_MAX_REASONS = 8;

const BREADCRUMB_EVENTS = new Set([
  "RUN_STARTED",
  "RUN_START_ATTEMPT",
  "RUN_START_REQUESTED",
  "RUN_COUNTDOWN_STARTED",
  "COUNTDOWN_SHOWN",
  "TRACKING_START_REQUESTED",
  "TRACKING_STARTED",
  "RUN_START_SUCCESS",
  "RUN_START_FAILED",
  "START_BUTTON_PRESSED",
  "START_FAILED",
  "PAUSE_PRESSED",
  "PAUSE_SUCCESS",
  "PAUSE_FAILED",
  "RESUME_PRESSED",
  "RESUME_SUCCESS",
  "RESUME_FAILED",
  "FINISH_PRESSED",
  "FINISH_STARTED",
  "FINISH_COMPLETED",
  "FINISH_SUCCESS",
  "FINISH_FAILED",
  "FINISH_LOCK_ACQUIRED",
  "FINISH_LOCK_RELEASED",
  "RUN_SAVED_LOCAL",
  "RUN_SAVE_STARTED",
  "RUN_SAVE_FAILED",
  "RUN_SYNC_QUEUED",
  "RUN_SYNC_SUCCESS",
  "RUN_SYNC_FAILED",
  "RUN_SYNC_COMPLETED",
  "RUN_CHECKPOINT_SAVED",
  "RUN_CHECKPOINT_FAILED",
  "ACTIVE_RUN_SAVED",
  "ACTIVE_RUN_SAVE_FAILED",
  "ACTIVE_RUN_LOAD_FAILED",
  "ACTIVE_RUN_STALE_CHECKPOINT_IGNORED",
  "ACTIVE_RUN_EMPTY_OVERWRITE_BLOCKED",
  "ACTIVE_RUN_DISTANCE_REGRESSION_BLOCKED",
  "ACTIVE_RUN_ELAPSED_REGRESSION_BLOCKED",
  "LOCATION_PERMISSION_DENIED",
  "LOCATION_PERMISSION_GRANTED",
  "LOCATION_PERMISSION_CHECKED",
  "LOCATION_PERMISSION_REQUESTED",
  "LOCATION_WATCHER_STARTED",
  "LOCATION_WATCHER_STOPPED",
  "LOCATION_WATCHER_RESTARTED",
  "APP_BACKGROUND",
  "APP_ACTIVE",
  "RUN_APP_BACKGROUND",
  "RUN_APP_ACTIVE",
  "APP_KILLED_OR_COLD_START_DETECTED",
  "ACTIVE_RUN_RECOVERED_FROM_STORAGE",
  "ACTIVE_RUN_MISSING_AFTER_FOREGROUND",
  "RUN_BACKGROUND_TASK_REGISTERED",
  "RUN_BACKGROUND_TASK_STARTED",
  "RUN_BACKGROUND_TASK_HANDLED",
  "RUN_BACKGROUND_TASK_CANCELLED_OR_STOPPED",
  "RUN_BACKGROUND_TASK_STATUS",
  "RUN_NOTIFICATION_STARTED",
  "RUN_NOTIFICATION_UPDATED",
  "RUN_NOTIFICATION_STOPPED",
  "RUN_NOTIFICATION_PERMISSION_DENIED",
  "RUN_NOTIFICATION_ACTION_RECEIVED",
  "RUN_NOTIFICATION_ACTION",
  "RUN_NOTIFICATION_NATIVE_STATE_READ",
  "RUN_OPENED_FROM_NOTIFICATION",
  "RUN_NOTIFICATION_OPEN_RESTORE_STARTED",
  "RUN_NOTIFICATION_OPEN_RESTORE_COMPLETED",
  "RUN_DEEP_LINK_RECEIVED",
  "RUN_REHYDRATE_STARTED",
  "RUN_REHYDRATE_SUCCESS",
  "RUN_REHYDRATE_FAILED",
  "RUN_RECONCILE_STARTED",
  "RUN_RECONCILE_RECOVERED",
  "RUN_RECONCILE_FAILED",
  "RUN_RECONCILE_INCONSISTENT_STATE",
  "RUN_RECONCILE_PRESERVED_ACTIVE_EVIDENCE",
  "RUN_ERROR_RECOVERABLE_ACTIVE_RUN",
  "RECOVERY_STARTED",
  "RECOVERY_LOADED_ACTIVE_RUN",
  "RECOVERY_MERGED_STATE",
  "RECOVERY_COMPLETED",
  "RECOVERY_FAILED",
  "RUN_RESTORE_STARTED",
  "RUN_RESTORE_COMPLETED",
  "MAP_ERROR",
  "MAP_SCREEN_MOUNTED",
  "MAP_SCREEN_UNMOUNTED",
  "MAP_ROUTE_HYDRATED",
  "MAP_ROUTE_RENDERED",
  "MAP_RENDER_STALL_DETECTED",
  "RUN_UI_STATE_CHANGED",
  "RUN_UI_STATE_APPLIED",
  "CANONICAL_SNAPSHOT_APPLIED",
  "RUN_UI_STATE_STALE_UPDATE_BLOCKED",
  "RUN_UI_STATE_MISMATCH",
  "RUN_UI_DISTANCE_REGRESSION_BLOCKED",
  "RUN_UI_ELAPSED_REGRESSION_BLOCKED",
  "RUN_UI_HEARTBEAT",
  "RUN_UI_TIMER_STALL",
  "RUN_UI_STALL",
  "RUN_UI_POSSIBLE_FREEZE_DETECTED",
  "BUTTON_PRESS_IGNORED_DUE_TO_LOCK",
  "DIAGNOSTICS_EXPORT_FAILED",
  "RUN_EMERGENCY_DIAGNOSTICS_EXPORT_FAILED",
]);

const HIGH_FREQUENCY_EVENTS = new Set([
  "FOREGROUND_LOCATION_RECEIVED",
  "BACKGROUND_LOCATION_RECEIVED",
  "LOCATION_POINT_RECEIVED",
  "LOCATION_POINT_ACCEPTED",
  "LOCATION_POINT_REJECTED",
  "RUN_POINT_ACCEPTED",
  "RUN_POINT_REJECTED_SUMMARY",
]);

const WARNING_CATEGORIES = new Set([
  "BACKGROUND",
  "FIREBASE",
  "LOCATION",
  "MAP",
  "NOTIFICATION",
  "PERMISSION",
  "PERFORMANCE",
  "RUN_RECOVERY",
  "RUN_SESSION",
  "RUN_TRACKING",
  "STORAGE",
  "SYNC",
  "UI",
  "UI_ACTION",
  "APP_STATE",
]);

const SPAN_START_EVENTS = {
  RUN_START_ATTEMPT: { key: "run.start", name: "Start run", op: "wayper.run.start" },
  RUN_SAVE_STARTED: { key: "run.save", name: "Save run", op: "wayper.run.save" },
  RUN_SYNC_STARTED: { key: "run.sync", name: "Sync runs", op: "wayper.run.sync" },
  FINISH_PRESSED: { key: "run.finish", name: "Finish run", op: "wayper.run.finish" },
  RECOVERY_STARTED: { key: "run.recovery", name: "Recover active run", op: "wayper.run.recovery" },
};

const SPAN_END_EVENTS = {
  RUN_STARTED: { key: "run.start", result: "success" },
  RUN_START_FAILED: { key: "run.start", result: "failure" },
  RUN_SAVED_LOCAL: { key: "run.save", result: "success" },
  RUN_SAVE_FAILED: { key: "run.save", result: "failure" },
  RUN_SYNC_COMPLETED: { key: "run.sync", result: "completed" },
  FINISH_SUCCESS: { key: "run.finish", result: "success" },
  FINISH_FAILED: { key: "run.finish", result: "failure" },
  RECOVERY_COMPLETED: { key: "run.recovery", result: "success" },
  RECOVERY_FAILED: { key: "run.recovery", result: "failure" },
};

let sentryClient = Sentry;
let state = {
  attempted: false,
  initialized: false,
  enabled: false,
  dsnConfigured: false,
  environment: "development",
  release: null,
  dist: null,
  tracesSampleRate: 0,
};
let appStartSpan = null;
const activeSpans = new Map();
const warningTimestamps = new Map();
const locationBreadcrumbState = {
  windowStartedAt: 0,
  lastSentAt: 0,
  counts: {},
  reasons: {},
  sources: {},
  lastEvent: null,
  lastStatus: null,
  lastRunId: null,
  lastAccuracy: null,
};

function normalizeEnvironment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["prod", "production"].includes(normalized)) return "production";
  if (["preview", "stage", "staging"].includes(normalized)) return "preview";
  return "development";
}

function getAppMetadata(overrides = {}) {
  const expoConfig = Constants.expoConfig || {};
  const appVersion = String(overrides.appVersion || expoConfig.version || "0.0.0");
  const buildNumber = String(
    overrides.buildNumber ||
      (Platform.OS === "ios" ? expoConfig.ios?.buildNumber : expoConfig.android?.versionCode) ||
      "1"
  );
  const packageName =
    overrides.packageName ||
    PUBLIC_APPLICATION_ID ||
    (Platform.OS === "ios"
      ? expoConfig.ios?.bundleIdentifier
      : expoConfig.android?.package) ||
    "com.wayper.app";

  return {
    appVersion,
    buildNumber,
    packageName,
    release: `${packageName}@${appVersion}+${buildNumber}`,
    dist: buildNumber.slice(0, 64),
  };
}

function defaultTraceRate(environment) {
  if (environment === "production") return 0.08;
  if (environment === "preview") return 0.15;
  return 0.2;
}

export function resolveMonitoringConfig(overrides = {}) {
  const environment = normalizeEnvironment(
    overrides.environment ||
      PUBLIC_ENVIRONMENT ||
      (typeof __DEV__ !== "undefined" && __DEV__ ? "development" : "production")
  );
  const dsn = String(overrides.dsn ?? PUBLIC_DSN ?? "").trim();
  const allowDevelopment = overrides.enableDevelopment ?? PUBLIC_ENABLE_DEV;
  const globallyEnabled = overrides.enabled ?? PUBLIC_ENABLED;
  const enabled =
    Boolean(dsn) &&
    Boolean(globallyEnabled) &&
    (environment !== "development" || Boolean(allowDevelopment));
  const metadata = getAppMetadata(overrides);

  return {
    ...metadata,
    dsn,
    dsnConfigured: Boolean(dsn),
    environment,
    enabled,
    tracesSampleRate: Number.isFinite(Number(overrides.tracesSampleRate))
      ? Number(overrides.tracesSampleRate)
      : defaultTraceRate(environment),
    debug: overrides.debug ?? (PUBLIC_DEBUG_ENABLED || (environment === "development" && enabled)),
    isDevClient:
      overrides.isDevClient ??
      (typeof __DEV__ !== "undefined" && __DEV__ && Constants.executionEnvironment !== "storeClient"),
    buildType: overrides.buildType || environment,
    buildProfile: overrides.buildProfile || PUBLIC_BUILD_PROFILE || environment,
    appVariant: overrides.appVariant || PUBLIC_APP_VARIANT || environment,
    updateChannel: overrides.updateChannel || PUBLIC_UPDATE_CHANNEL || null,
  };
}

function setGlobalTag(key, value) {
  if (!state.enabled || value == null || value === "") return;
  try {
    sentryClient.setTag(key, String(value).slice(0, 200));
  } catch {}
}

function setGlobalContext(name, context) {
  if (!state.enabled) return;
  try {
    sentryClient.setContext(name, sanitizeSentryContext(context));
  } catch {}
}

function setTagsOnScope(scope, tags = {}) {
  Object.entries(sanitizeSentryContext(tags || {})).forEach(([key, value]) => {
    if (value == null || value === "") return;
    if (["string", "number", "boolean"].includes(typeof value)) {
      scope.setTag?.(key, String(value).slice(0, 200));
    }
  });
}

function captureWithScope(callback, context = {}, level = "error") {
  if (!state.enabled) return null;
  const safeContext = sanitizeSentryContext(context);
  try {
    let eventId = null;
    sentryClient.withScope((scope) => {
      scope.setLevel?.(level);
      scope.setTag?.("wayper.category", String(context.category || "UNKNOWN"));
      scope.setTag?.("wayper.event", String(context.event || "UNKNOWN"));
      if (context.screen) scope.setTag?.("screenName", String(context.screen));
      if (context.feature) scope.setTag?.("feature", String(context.feature).slice(0, 200));
      if (context.area) scope.setTag?.("area", String(context.area).slice(0, 200));
      if (context.runStatus || context.status) {
        scope.setTag?.("runStatus", String(context.runStatus || context.status).slice(0, 200));
      }
      setTagsOnScope(scope, context.tags);
      scope.setContext?.("wayper", safeContext);
      eventId = callback(scope);
    });
    return eventId;
  } catch {
    return null;
  }
}

function extractError(context = {}) {
  if (context instanceof Error) return context;
  const candidates = [context.error, context.exception, context.cause];
  return candidates.find((candidate) => candidate instanceof Error) || null;
}

function shouldCaptureWarning(logEvent) {
  if (!WARNING_CATEGORIES.has(String(logEvent.category || "").toUpperCase())) return false;
  const event = String(logEvent.event || "");
  if (!/(FAILED|DENIED|UNAVAILABLE|CORRUPT|INCONSISTENT|BLOCKED|STALL|FREEZE|MISMATCH|REGRESSION|FULL|ERROR_RECOVERABLE)/i.test(event)) return false;

  const key = `${logEvent.category}:${event}`;
  const now = Date.now();
  const lastSentAt = warningTimestamps.get(key) || 0;
  if (now - lastSentAt < 60_000) return false;
  warningTimestamps.set(key, now);
  return true;
}

function shouldAddBreadcrumb(event) {
  return (
    BREADCRUMB_EVENTS.has(event) ||
    event.startsWith("SHARE_") ||
    event.includes("_STALL") ||
    event.includes("_FREEZE") ||
    event.includes("_REGRESSION_BLOCKED") ||
    event.includes("_INCONSISTENT_")
  );
}

function resetLocationBreadcrumbState(now = Date.now()) {
  locationBreadcrumbState.windowStartedAt = now;
  locationBreadcrumbState.counts = {};
  locationBreadcrumbState.reasons = {};
  locationBreadcrumbState.sources = {};
  locationBreadcrumbState.lastEvent = null;
  locationBreadcrumbState.lastStatus = null;
  locationBreadcrumbState.lastRunId = null;
  locationBreadcrumbState.lastAccuracy = null;
}

function addCount(target, key = "unknown") {
  const normalized = String(key || "unknown").slice(0, 80);
  target[normalized] = (target[normalized] || 0) + 1;
}

function buildLocationAggregateData(now = Date.now()) {
  const sortedReasons = Object.entries(locationBreadcrumbState.reasons)
    .sort((left, right) => right[1] - left[1])
    .slice(0, LOCATION_BREADCRUMB_MAX_REASONS)
    .reduce((output, [key, value]) => ({ ...output, [key]: value }), {});
  return {
    windowMs: Math.max(0, now - (locationBreadcrumbState.windowStartedAt || now)),
    counts: locationBreadcrumbState.counts,
    reasons: sortedReasons,
    sources: locationBreadcrumbState.sources,
    lastEvent: locationBreadcrumbState.lastEvent,
    status: locationBreadcrumbState.lastStatus,
    runId: locationBreadcrumbState.lastRunId,
    lastAccuracy: locationBreadcrumbState.lastAccuracy,
  };
}

function flushLocationBreadcrumb(reason = "interval", now = Date.now()) {
  const total = Object.values(locationBreadcrumbState.counts).reduce((sum, count) => sum + count, 0);
  if (!total) return false;
  const data = buildLocationAggregateData(now);
  const added = addBreadcrumb({
    category: "wayper.location",
    message: "LOCATION_UPDATES_THROTTLED",
    level: reason === "forced" ? "info" : "debug",
    data: {
      ...data,
      reason,
    },
  });
  locationBreadcrumbState.lastSentAt = now;
  resetLocationBreadcrumbState(now);
  return added;
}

function aggregateLocationBreadcrumb(logEvent = {}, now = Date.now()) {
  if (!locationBreadcrumbState.windowStartedAt) {
    resetLocationBreadcrumbState(now);
  }
  const context = logEvent.context || {};
  const event = String(logEvent.event || "LOCATION_POINT");
  addCount(locationBreadcrumbState.counts, event);
  addCount(locationBreadcrumbState.sources, context.source || context.point?.source || "unknown");
  if (context.reason) addCount(locationBreadcrumbState.reasons, context.reason);
  if (event.includes("REJECTED")) addCount(locationBreadcrumbState.reasons, "rejected");
  if (/duplicate/i.test(String(context.reason || ""))) addCount(locationBreadcrumbState.reasons, "duplicate_point");
  if (/gap/i.test(String(context.reason || ""))) addCount(locationBreadcrumbState.reasons, "gps_gap_detected");
  if (Number(context.accuracy) > 0) {
    locationBreadcrumbState.lastAccuracy = Math.round(Number(context.accuracy));
    if (Number(context.accuracy) >= 50) addCount(locationBreadcrumbState.reasons, "gps_accuracy_bad");
  }
  locationBreadcrumbState.lastEvent = event;
  locationBreadcrumbState.lastStatus = context.status || context.runStatus || null;
  locationBreadcrumbState.lastRunId = context.runId || context.localRunId || null;

  if (now - locationBreadcrumbState.windowStartedAt >= LOCATION_BREADCRUMB_INTERVAL_MS) {
    return flushLocationBreadcrumb("interval", now);
  }
  return false;
}

function updateOperationalTags(logEvent = {}) {
  const event = String(logEvent.event || "");
  const context = logEvent.context || {};

  if (event === "RUN_STARTED" || event === "RESUME_SUCCESS") setGlobalTag("runState", "running");
  if (event === "PAUSE_SUCCESS") setGlobalTag("runState", "paused");
  if (event === "FINISH_SUCCESS") setGlobalTag("runState", "finished");
  if (event.endsWith("_FAILED")) setGlobalTag("lastFailureCategory", logEvent.category);
  if (event.includes("PERMISSION")) setGlobalTag("permissionState", context.status || event);
  if (context.trackingState || context.watcherStatus) {
    setGlobalTag("trackingState", context.trackingState || context.watcherStatus);
  }
  if (context.networkState) setGlobalTag("networkState", context.networkState);
  if (context.storageState) setGlobalTag("storageState", context.storageState);
}

function updatePerformanceSpans(logEvent = {}) {
  if (!state.enabled || state.tracesSampleRate <= 0) return;
  const event = String(logEvent.event || "");
  const startConfig = SPAN_START_EVENTS[event];
  if (startConfig) {
    try {
      activeSpans.get(startConfig.key)?.end?.();
      const span = sentryClient.startInactiveSpan({
        name: startConfig.name,
        op: startConfig.op,
        attributes: {
          "wayper.environment": state.environment,
          "wayper.category": String(logEvent.category || "UNKNOWN"),
        },
      });
      activeSpans.set(startConfig.key, span);
    } catch {}
  }

  const endConfig = SPAN_END_EVENTS[event];
  if (endConfig) {
    const span = activeSpans.get(endConfig.key);
    if (span) {
      try {
        span.setAttribute?.("wayper.result", endConfig.result);
        span.end?.();
      } catch {}
      activeSpans.delete(endConfig.key);
    }
  }
}

function captureLogEvent(logEvent = {}, rawContext = {}, options = {}) {
  if (!state.enabled) return null;
  const event = String(logEvent.event || "LOG_EVENT");
  const level = String(logEvent.level || "info");

  updateOperationalTags(logEvent);
  updatePerformanceSpans(logEvent);

  if (HIGH_FREQUENCY_EVENTS.has(event)) {
    aggregateLocationBreadcrumb(logEvent);
    return null;
  }

  if (shouldAddBreadcrumb(event)) {
    addBreadcrumb({
      category: `wayper.${String(logEvent.category || "unknown").toLowerCase()}`,
      message: event,
      level: level === "fatal" ? "error" : level,
      data: logEvent.context || {},
    });
  }

  if (options.skipRemote === true) return null;

  if (level === "error" || level === "fatal") {
    const error = extractError(rawContext);
    const context = {
      ...logEvent.context,
      category: logEvent.category,
      event,
      screen: logEvent.screen,
      fatal: level === "fatal",
    };
    return error
      ? captureException(error, context)
      : captureMessage(`[${logEvent.category}] ${event}`, level, context);
  }

  if (level === "warn" && shouldCaptureWarning(logEvent)) {
    return captureMessage(`[${logEvent.category}] ${event}`, "warning", {
      ...logEvent.context,
      category: logEvent.category,
      event,
      screen: logEvent.screen,
    });
  }

  return null;
}

export function initializeMonitoring(overrides = {}) {
  if (state.attempted) return getMonitoringStatus();
  const config = resolveMonitoringConfig(overrides);
  state = {
    attempted: true,
    initialized: false,
    enabled: config.enabled,
    dsnConfigured: config.dsnConfigured,
    environment: config.environment,
    release: config.release,
    dist: config.dist,
    tracesSampleRate: config.enabled ? config.tracesSampleRate : 0,
  };

  if (!config.enabled) return getMonitoringStatus();

  try {
    sentryClient.init({
      dsn: config.dsn,
      enabled: true,
      environment: config.environment,
      release: config.release,
      dist: config.dist,
      debug: config.debug,
      sendDefaultPii: false,
      tracesSampleRate: config.tracesSampleRate,
      enableLogs: false,
      maxBreadcrumbs: 50,
      beforeSend: (event) => sanitizeSentryEvent(event),
      beforeSendTransaction: (event) => sanitizeSentryEvent(event),
      beforeBreadcrumb: (breadcrumb) => (
        breadcrumb?.category === "console"
          ? null
          : sanitizeSentryBreadcrumb(breadcrumb)
      ),
    });

    state.initialized = true;
    registerMonitoringSink({ captureLogEvent });
    setGlobalTag("appVersion", config.appVersion);
    setGlobalTag("buildNumber", config.buildNumber);
    setGlobalTag("environment", config.environment);
    setGlobalTag("platform", Platform.OS);
    setGlobalTag("isDevClient", config.isDevClient);
    setGlobalTag("buildType", config.buildType);
    setGlobalTag("buildProfile", config.buildProfile);
    setGlobalTag("appVariant", config.appVariant);
    setGlobalTag("updateChannel", config.updateChannel);
    setGlobalTag("mapProvider", "maplibre");
    setGlobalContext("app", {
      appVersion: config.appVersion,
      buildNumber: config.buildNumber,
      environment: config.environment,
      platform: Platform.OS,
      isDevClient: config.isDevClient,
      buildType: config.buildType,
      buildProfile: config.buildProfile,
      appVariant: config.appVariant,
      updateChannel: config.updateChannel,
      mapProvider: "maplibre",
    });
    addBreadcrumb({
      category: "wayper.app",
      message: "APP_STARTED",
      level: "info",
      data: {
        environment: config.environment,
        release: config.release,
        dist: config.dist,
      },
    });
    appStartSpan = sentryClient.startInactiveSpan({
      name: "Wayper app start",
      op: "app.start",
    });
  } catch {
    state.enabled = false;
    state.initialized = false;
    registerMonitoringSink(null);
  }

  return getMonitoringStatus();
}

export function finishAppStartSpan(result = "ready") {
  if (!appStartSpan) return;
  try {
    appStartSpan.setAttribute?.("wayper.result", result);
    appStartSpan.end?.();
  } catch {}
  appStartSpan = null;
}

export function captureException(error, context = {}) {
  if (!state.enabled) return null;
  const exception = error instanceof Error ? error : new Error(String(error || "Unknown error"));
  return captureWithScope(
    () => sentryClient.captureException(exception),
    context,
    context.fatal ? "fatal" : "error"
  );
}

export function captureMessage(message, level = "info", context = {}) {
  if (!state.enabled) return null;
  return captureWithScope(
    () => sentryClient.captureMessage(String(message || "Wayper event"), level),
    context,
    level
  );
}

export function addBreadcrumb(breadcrumb = {}) {
  if (!state.enabled) return false;
  try {
    sentryClient.addBreadcrumb(sanitizeSentryBreadcrumb(breadcrumb));
    return true;
  } catch {
    return false;
  }
}

export function captureRunError(error, context = {}) {
  return captureException(error, {
    feature: "run_tracking",
    area: context.area || "active_run",
    category: context.category || "RUN_TRACKING",
    event: context.event || "RUN_ERROR",
    ...context,
  });
}

export function captureRunMessage(message, level = "warning", context = {}) {
  return captureMessage(message, level, {
    feature: "run_tracking",
    area: context.area || "active_run",
    category: context.category || "RUN_TRACKING",
    event: context.event || "RUN_EVENT",
    ...context,
  });
}

export function capturePossibleFreeze(context = {}) {
  return captureRunMessage("run_ui_possible_freeze_detected", "warning", {
    area: context.area || "map_screen",
    event: "RUN_UI_POSSIBLE_FREEZE_DETECTED",
    category: "PERFORMANCE",
    ...context,
    tags: {
      feature: "run_tracking",
      area: "map_screen",
      appState: context.appState || "unknown",
      runStatus: context.runStatus || context.status || "unknown",
      ...(context.tags || {}),
    },
  });
}

export function addRunBreadcrumb(event, context = {}, level = "info") {
  return addBreadcrumb({
    category: "wayper.run_tracking",
    message: event,
    level,
    data: {
      feature: "run_tracking",
      ...context,
    },
  });
}

export function setMonitoringScreen(screenName) {
  const safeScreen = String(screenName || "unknown").slice(0, 100);
  setGlobalTag("screenName", safeScreen);
  setGlobalContext("navigation", { screenName: safeScreen });
}

export function setMonitoringAuthState(authState) {
  const safeState = authState === "authenticated" ? "authenticated" : "anonymous";
  setGlobalTag("firebaseAuthState", safeState);
  setGlobalContext("firebase", { authState: safeState });
}

export function setMonitoringUser(user = null) {
  if (!state.enabled) return false;
  try {
    const rawId = user?.uid || user?.id || user?.userId || null;
    const safeId = anonymizeIdentifier(rawId, "user");
    sentryClient.setUser?.(safeId ? { id: safeId } : null);
    setGlobalContext("firebase", {
      authState: rawId ? "authenticated" : "anonymous",
      userId: safeId,
    });
    return true;
  } catch {
    return false;
  }
}

export async function traceAsync(name, op, context, callback) {
  if (typeof callback !== "function") throw new TypeError("traceAsync callback is required");
  if (!state.enabled || state.tracesSampleRate <= 0) return callback();
  const attributes = Object.fromEntries(
    Object.entries(sanitizeSentryContext(context || {}))
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .slice(0, 20)
  );
  let span = null;
  try {
    span = sentryClient.startInactiveSpan({
      name,
      op,
      attributes,
    });
  } catch {}

  try {
    const result = await callback();
    try {
      span?.setAttribute?.("wayper.result", "success");
    } catch {}
    return result;
  } catch (error) {
    try {
      span?.setAttribute?.("wayper.result", "failure");
    } catch {}
    throw error;
  } finally {
    try {
      span?.end?.();
    } catch {}
  }
}

export function sendMonitoringTestEvent() {
  if (!isMonitoringTestAvailable()) return null;
  return captureException(new Error("Wayper controlled Sentry test event"), {
    category: "DIAGNOSTICS",
    event: "SENTRY_TEST_EVENT",
    controlled: true,
  });
}

export async function flushMonitoring(timeoutMs = 2000) {
  if (!state.enabled) return false;
  try {
    return await sentryClient.flush(timeoutMs);
  } catch {
    return false;
  }
}

export function isMonitoringTestAvailable() {
  return state.enabled && (state.environment !== "production" || PUBLIC_TEST_ENABLED);
}

export function getMonitoringStatus() {
  return { ...state };
}

export function wrapWithMonitoring(Component) {
  if (!state.enabled) return Component;
  try {
    return sentryClient.wrap(Component);
  } catch {
    return Component;
  }
}

export function __setSentryClientForTests(client) {
  sentryClient = client || Sentry;
}

export function __flushLocationBreadcrumbsForTests() {
  return flushLocationBreadcrumb("forced");
}

export function __resetMonitoringForTests() {
  registerMonitoringSink(null);
  activeSpans.forEach((span) => {
    try {
      span?.end?.();
    } catch {}
  });
  activeSpans.clear();
  warningTimestamps.clear();
  resetLocationBreadcrumbState(0);
  appStartSpan = null;
  state = {
    attempted: false,
    initialized: false,
    enabled: false,
    dsnConfigured: false,
    environment: "development",
    release: null,
    dist: null,
    tracesSampleRate: 0,
  };
}

export default {
  addBreadcrumb,
  addRunBreadcrumb,
  captureRunError,
  captureRunMessage,
  capturePossibleFreeze,
  captureException,
  captureMessage,
  finishAppStartSpan,
  flushMonitoring,
  getMonitoringStatus,
  initializeMonitoring,
  isMonitoringTestAvailable,
  sendMonitoringTestEvent,
  setMonitoringAuthState,
  setMonitoringScreen,
  setMonitoringUser,
  traceAsync,
  wrapWithMonitoring,
};
