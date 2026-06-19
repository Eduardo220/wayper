import {
  getDiagnosticsConfig,
  isLogLevelEnabled,
  LOCATION_PRECISION_MODE,
  LOG_LEVEL_PRIORITY,
} from "../config/diagnosticsConfig.js";
import { appendLog } from "../services/diagnostics/logStorageService.js";
import { forwardLogToMonitoring } from "../services/monitoring/monitoringBridge.js";

export const LOG_LEVELS = Object.freeze({
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "fatal",
});

export const LOG_CATEGORIES = Object.freeze({
  RUN_SESSION: "RUN_SESSION",
  RUN_TRACKING: "RUN_TRACKING",
  RUN_RECOVERY: "RUN_RECOVERY",
  LOCATION: "LOCATION",
  BACKGROUND: "BACKGROUND",
  STORAGE: "STORAGE",
  MAP: "MAP",
  NOTIFICATION: "NOTIFICATION",
  SYNC: "SYNC",
  PERMISSION: "PERMISSION",
  SHARE: "SHARE",
  STORY: "STORY",
  TERRITORY: "TERRITORY",
  PROFILE: "PROFILE",
  RANKING: "RANKING",
  XP: "XP",
  UI: "UI",
  UI_ACTION: "UI_ACTION",
  PERFORMANCE: "PERFORMANCE",
  APP_STATE: "APP_STATE",
  FIREBASE: "FIREBASE",
  UNKNOWN: "UNKNOWN",
});

const SENSITIVE_KEY_PATTERN = /(password|senha|token|refreshToken|accessToken|idToken|authorization|credential|secret|apiKey|firebaseUser|providerData)/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LOCATION_KEYS = new Set(["latitude", "longitude", "lat", "lng", "lon"]);
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 5;

let sequence = 0;

function createLogId() {
  sequence += 1;
  return `log_${Date.now().toString(36)}_${sequence.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function maskEmail(value = "") {
  return String(value).replace(EMAIL_PATTERN, (email) => {
    const [name, domain] = email.split("@");
    if (!name || !domain) return "[email]";
    return `${name.slice(0, 2)}***@${domain}`;
  });
}

function sanitizeCoordinate(value, config) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  if (config.locationPrecisionMode === LOCATION_PRECISION_MODE.full) return number;
  if (config.locationPrecisionMode === LOCATION_PRECISION_MODE.redacted) return "[redacted_location]";
  return Number(number.toFixed(3));
}

function sanitizeError(error = {}) {
  return {
    name: error.name || "Error",
    message: maskEmail(error.message || String(error)),
    stack: typeof error.stack === "string" ? maskEmail(error.stack).slice(0, 4000) : undefined,
  };
}

function sanitizeValue(value, key = "", config = getDiagnosticsConfig(), depth = 0) {
  if (value == null) return value;
  if (SENSITIVE_KEY_PATTERN.test(String(key))) return "[redacted]";
  if (value instanceof Error) return sanitizeError(value);
  if (typeof value === "string") return maskEmail(value);
  if (typeof value !== "object") {
    return LOCATION_KEYS.has(String(key)) ? sanitizeCoordinate(value, config) : value;
  }
  if (depth >= MAX_DEPTH) return "[max_depth]";

  if (Array.isArray(value)) {
    const output = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, key, config, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      output.push({ truncatedItems: value.length - MAX_ARRAY_ITEMS });
    }
    return output;
  }

  const output = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(entryKey)) {
      output[entryKey] = "[redacted]";
      continue;
    }
    if (LOCATION_KEYS.has(entryKey)) {
      output[entryKey] = sanitizeCoordinate(entryValue, config);
      continue;
    }
    output[entryKey] = sanitizeValue(entryValue, entryKey, config, depth + 1);
  }
  return output;
}

export function sanitizeLogContext(context = {}) {
  return sanitizeValue(context, "", getDiagnosticsConfig(), 0) || {};
}

function getEnvironment() {
  return typeof __DEV__ === "undefined" || __DEV__ ? "dev" : "prod";
}

function getRuntimePlatform(config = getDiagnosticsConfig()) {
  if (config.platform && config.platform !== "unknown") return config.platform;
  if (typeof navigator !== "undefined" && navigator.product === "ReactNative") return "react-native";
  if (typeof navigator !== "undefined" && navigator.userAgent) return navigator.userAgent;
  return "unknown";
}

function normalizeCategory(category) {
  const value = String(category || LOG_CATEGORIES.UNKNOWN).toUpperCase();
  return LOG_CATEGORIES[value] || value || LOG_CATEGORIES.UNKNOWN;
}

function isCategoryEnabled(category, config) {
  if (!config.categoriesEnabled) return true;
  if (Array.isArray(config.categoriesEnabled)) return config.categoriesEnabled.includes(category);
  return config.categoriesEnabled[category] !== false;
}

export function createLogEvent(level, category, event, context = {}, options = {}) {
  const config = getDiagnosticsConfig();
  const normalizedCategory = normalizeCategory(category);
  const sanitizedContext = sanitizeLogContext(context);
  const runId = options.runId || sanitizedContext.runId || sanitizedContext.activeRunId || sanitizedContext.id || null;
  const localRunId = options.localRunId || sanitizedContext.localRunId || null;

  return {
    id: options.id || createLogId(),
    timestamp: options.timestamp || new Date().toISOString(),
    level,
    category: normalizedCategory,
    event: String(event || "log"),
    message: String(event || "log"),
    context: sanitizedContext,
    sessionId: options.sessionId || sanitizedContext.sessionId || null,
    runId,
    localRunId,
    screen: options.screen || sanitizedContext.screen || null,
    appState: options.appState || sanitizedContext.appState || null,
    appVersion: options.appVersion || config.appVersion || "unknown",
    buildVersion: options.buildVersion || config.buildVersion || "unknown",
    platform: options.platform || getRuntimePlatform(config),
    environment: options.environment || getEnvironment(),
  };
}

function shouldEmit(level, category, config, options = {}) {
  if (!config.enabled) return false;
  if (!LOG_LEVEL_PRIORITY[level]) return false;
  if (!options.forcePersist && !isLogLevelEnabled(level, config.minLevel)) return false;
  return isCategoryEnabled(category, config);
}

function writeToConsole(log) {
  const method = log.level === "fatal" ? "error" : log.level;
  const consoleMethod = typeof console?.[method] === "function" ? console[method] : console.log;
  try {
    consoleMethod(`[Wayper:${log.category}] ${log.event}`, log.context);
  } catch {}
}

export function log(level, category, event, context = {}, options = {}) {
  const config = getDiagnosticsConfig();
  const normalizedLevel = LOG_LEVELS[level] || LOG_LEVELS.info;
  const normalizedCategory = normalizeCategory(category);
  if (!shouldEmit(normalizedLevel, normalizedCategory, config, options)) return null;

  const logEvent = createLogEvent(normalizedLevel, normalizedCategory, event, context, options);

  if (config.consoleEnabled && isLogLevelEnabled(normalizedLevel, config.minLevel)) writeToConsole(logEvent);

  const shouldPersist =
    config.persistEnabled &&
    (
      options.forcePersist === true ||
      LOG_LEVEL_PRIORITY[normalizedLevel] >= LOG_LEVEL_PRIORITY.warn ||
      normalizedLevel !== LOG_LEVELS.debug ||
      config.minLevel === LOG_LEVELS.debug
    );

  if (shouldPersist) {
    appendLog(logEvent).catch(() => null);
  }

  forwardLogToMonitoring(logEvent, context, options);

  return logEvent;
}

export const logger = {
  debug: (category, event, context = {}, options = {}) => log(LOG_LEVELS.debug, category, event, context, options),
  info: (category, event, context = {}, options = {}) => log(LOG_LEVELS.info, category, event, context, options),
  warn: (category, event, context = {}, options = {}) => log(LOG_LEVELS.warn, category, event, context, options),
  error: (category, event, context = {}, options = {}) => log(LOG_LEVELS.error, category, event, context, options),
  fatal: (category, event, context = {}, options = {}) => log(LOG_LEVELS.fatal, category, event, context, options),
  log,
};

export default logger;
