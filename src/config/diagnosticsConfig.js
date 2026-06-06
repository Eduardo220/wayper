const isDevEnvironment = () => typeof __DEV__ === "undefined" || Boolean(__DEV__);
const isTestEnvironment = () => typeof process !== "undefined" && process.env?.NODE_ENV === "test";

export const LOG_LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export const LOCATION_PRECISION_MODE = {
  full: "full",
  masked: "masked",
  redacted: "redacted",
};

export const DEFAULT_DIAGNOSTICS_CONFIG = {
  enabled: true,
  consoleEnabled: isDevEnvironment() && !isTestEnvironment(),
  persistEnabled: true,
  minLevel: isDevEnvironment() ? "debug" : "warn",
  maxStoredLogs: 1000,
  locationPrecisionMode: isDevEnvironment()
    ? LOCATION_PRECISION_MODE.full
    : LOCATION_PRECISION_MODE.masked,
  categoriesEnabled: null,
  appVersion: "unknown",
  buildVersion: "unknown",
  platform: "unknown",
};

let diagnosticsConfig = { ...DEFAULT_DIAGNOSTICS_CONFIG };

export function getDiagnosticsConfig() {
  return { ...diagnosticsConfig };
}

export function updateDiagnosticsConfig(patch = {}) {
  diagnosticsConfig = {
    ...diagnosticsConfig,
    ...(patch || {}),
  };
  return getDiagnosticsConfig();
}

export function resetDiagnosticsConfigForTests() {
  diagnosticsConfig = { ...DEFAULT_DIAGNOSTICS_CONFIG };
}

export function isLogLevelEnabled(level, minLevel = diagnosticsConfig.minLevel) {
  const currentPriority = LOG_LEVEL_PRIORITY[level] ?? LOG_LEVEL_PRIORITY.info;
  const minPriority = LOG_LEVEL_PRIORITY[minLevel] ?? LOG_LEVEL_PRIORITY.info;
  return currentPriority >= minPriority;
}

export default {
  DEFAULT_DIAGNOSTICS_CONFIG,
  LOCATION_PRECISION_MODE,
  LOG_LEVEL_PRIORITY,
  getDiagnosticsConfig,
  isLogLevelEnabled,
  resetDiagnosticsConfigForTests,
  updateDiagnosticsConfig,
};
