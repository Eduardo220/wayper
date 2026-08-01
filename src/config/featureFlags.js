export const FEATURE_FLAGS = Object.freeze({
  FOCUS_RUN_UI: "focus_run_ui",
});

const FEATURE_FLAG_DEFAULTS = Object.freeze({
  [FEATURE_FLAGS.FOCUS_RUN_UI]: true,
});

const BUILD_TIME_OVERRIDES = Object.freeze({
  [FEATURE_FLAGS.FOCUS_RUN_UI]: process.env.EXPO_PUBLIC_FEATURE_FOCUS_RUN_UI,
});

export function normalizeFeatureFlagValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "off", "disabled"].includes(normalized)) return false;
  return null;
}

export function resolveFeatureFlag(name, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(FEATURE_FLAG_DEFAULTS, name)) {
    return Object.freeze({
      name,
      enabled: false,
      source: "unknown_safe_default",
    });
  }

  const explicitOverride = normalizeFeatureFlagValue(options.override);
  if (explicitOverride !== null) {
    return Object.freeze({
      name,
      enabled: explicitOverride,
      source: "explicit_override",
    });
  }

  const buildTimeValue = Object.prototype.hasOwnProperty.call(
    options,
    "buildTimeOverride"
  )
    ? options.buildTimeOverride
    : BUILD_TIME_OVERRIDES[name];
  const buildTimeOverride = normalizeFeatureFlagValue(buildTimeValue);
  if (buildTimeOverride !== null) {
    return Object.freeze({
      name,
      enabled: buildTimeOverride,
      source: "build_time",
    });
  }

  return Object.freeze({
    name,
    enabled: FEATURE_FLAG_DEFAULTS[name],
    source: "local_default",
  });
}

export function isFeatureEnabled(name, options = {}) {
  return resolveFeatureFlag(name, options).enabled;
}

export default {
  FEATURE_FLAGS,
  isFeatureEnabled,
  normalizeFeatureFlagValue,
  resolveFeatureFlag,
};
