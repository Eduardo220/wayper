import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { registerMonitoringSink } from "./monitoringBridge.js";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryContext,
  sanitizeSentryEvent,
} from "./sentrySanitizer.js";

const PUBLIC_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || "";
const PUBLIC_ENVIRONMENT = process.env.EXPO_PUBLIC_APP_ENV || "";
const PUBLIC_ENABLE_DEV = process.env.EXPO_PUBLIC_SENTRY_ENABLE_DEV === "true";
const PUBLIC_ENABLED = process.env.EXPO_PUBLIC_SENTRY_ENABLED !== "false";
const PUBLIC_TEST_ENABLED = process.env.EXPO_PUBLIC_SENTRY_TEST_ENABLED === "true";

const BREADCRUMB_EVENTS = new Set([
  "RUN_STARTED",
  "PAUSE_PRESSED",
  "PAUSE_SUCCESS",
  "RESUME_PRESSED",
  "RESUME_SUCCESS",
  "FINISH_PRESSED",
  "FINISH_SUCCESS",
  "RUN_SAVED_LOCAL",
  "RUN_SYNC_QUEUED",
  "RUN_SYNC_SUCCESS",
  "RUN_SYNC_FAILED",
  "LOCATION_PERMISSION_DENIED",
  "APP_BACKGROUND",
  "APP_ACTIVE",
  "RUN_APP_BACKGROUND",
  "RUN_APP_ACTIVE",
  "RUN_BACKGROUND_TASK_REGISTERED",
  "RUN_BACKGROUND_TASK_STARTED",
  "RUN_BACKGROUND_TASK_HANDLED",
  "RUN_BACKGROUND_TASK_CANCELLED_OR_STOPPED",
  "RUN_NOTIFICATION_STARTED",
  "RUN_NOTIFICATION_STOPPED",
  "RUN_NOTIFICATION_PERMISSION_DENIED",
  "MAP_ERROR",
]);

const HIGH_FREQUENCY_EVENTS = new Set([
  "LOCATION_POINT_RECEIVED",
  "LOCATION_POINT_ACCEPTED",
  "LOCATION_POINT_REJECTED",
]);

const WARNING_CATEGORIES = new Set([
  "BACKGROUND",
  "FIREBASE",
  "MAP",
  "NOTIFICATION",
  "PERMISSION",
  "RUN_RECOVERY",
  "STORAGE",
  "SYNC",
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

function normalizeEnvironment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["prod", "production"].includes(normalized)) return "production";
  if (["preview", "stage", "staging"].includes(normalized)) return "staging";
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
  if (environment === "staging") return 0.15;
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
    debug: overrides.debug ?? (environment === "development" && enabled),
    isDevClient:
      overrides.isDevClient ??
      (typeof __DEV__ !== "undefined" && __DEV__ && Constants.executionEnvironment !== "storeClient"),
    buildType: overrides.buildType || environment,
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
  if (!/(FAILED|DENIED|UNAVAILABLE|CORRUPT|INCONSISTENT|BLOCKED|STALL)/i.test(event)) return false;

  const key = `${logEvent.category}:${event}`;
  const now = Date.now();
  const lastSentAt = warningTimestamps.get(key) || 0;
  if (now - lastSentAt < 60_000) return false;
  warningTimestamps.set(key, now);
  return true;
}

function shouldAddBreadcrumb(event) {
  return BREADCRUMB_EVENTS.has(event) || event.startsWith("SHARE_");
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

  if (HIGH_FREQUENCY_EVENTS.has(event)) return null;

  updateOperationalTags(logEvent);
  updatePerformanceSpans(logEvent);

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
    setGlobalTag("mapProvider", "maplibre");
    setGlobalContext("app", {
      appVersion: config.appVersion,
      buildNumber: config.buildNumber,
      environment: config.environment,
      platform: Platform.OS,
      isDevClient: config.isDevClient,
      buildType: config.buildType,
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

export function __resetMonitoringForTests() {
  registerMonitoringSink(null);
  activeSpans.forEach((span) => {
    try {
      span?.end?.();
    } catch {}
  });
  activeSpans.clear();
  warningTimestamps.clear();
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
  traceAsync,
  wrapWithMonitoring,
};
