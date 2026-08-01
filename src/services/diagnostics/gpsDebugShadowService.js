import { shouldAcceptPoint } from "../tracking/trackingFilters.js";
import { getTrackingPreset } from "../tracking/trackingConfig.js";

export const GPS_DEBUG_SHADOW_MODE =
  typeof __DEV__ !== "undefined" && Boolean(__DEV__);

const relaxedStates = new Map();
let gpsDebugShadowModeOverride = null;

export function isGpsDebugShadowEnabled() {
  return gpsDebugShadowModeOverride ?? GPS_DEBUG_SHADOW_MODE;
}

export function getRelaxedTrackingPreset(mode = "run") {
  const current = getTrackingPreset(mode);
  return {
    ...current,
    maxAccuracyMeters: Math.max(Number(current.maxAccuracyMeters || 0), 65),
    softMaxAccuracyMeters: Math.max(Number(current.softMaxAccuracyMeters || 0), 65),
    hardMaxAccuracyMeters: Math.max(Number(current.hardMaxAccuracyMeters || 0), 100),
    minDistanceMeters: Math.min(Number(current.minDistanceMeters || 2), 1),
    minUsefulDistanceMeters: Math.min(Number(current.minUsefulDistanceMeters || 1.5), 0.8),
    stationaryDistanceMeters: Math.min(Number(current.stationaryDistanceMeters || 1.2), 0.5),
    minTimeMs: Math.min(Number(current.minTimeMs || 700), 300),
    maxSpeedMps: Math.max(Number(current.maxSpeedMps || 0), 12.5),
    hardMaxSpeedMps: Math.max(Number(current.hardMaxSpeedMps || 0), 16),
    maxAccelerationMps2: Math.max(Number(current.maxAccelerationMps2 || 0), 8),
    zigzagMinAccuracyPenaltyMeters: Math.max(Number(current.zigzagMinAccuracyPenaltyMeters || 0), 35),
  };
}

function getState(runId, mode) {
  const key = String(runId || "unknown");
  const existing = relaxedStates.get(key);
  if (existing) return existing;
  const state = {
    runId: key,
    mode: mode || "run",
    trustedPath: [],
    previousSpeedMps: 0,
  };
  relaxedStates.set(key, state);
  return state;
}

export function evaluateGpsShadowPoint(point, context = {}) {
  if (!isGpsDebugShadowEnabled()) {
    return {
      enabled: false,
      acceptedByRelaxedFilter: null,
      relaxedRejectReason: null,
    };
  }

  const state = getState(context.runId, context.mode);
  const preset = getRelaxedTrackingPreset(context.mode || state.mode);
  const verdict = shouldAcceptPoint(point, {
    trustedPath: state.trustedPath,
    acceptedPath: state.trustedPath,
    startedAt: context.startedAt,
    nowMs: context.nowMs || Date.now(),
    previousSpeedMps: state.previousSpeedMps,
  }, preset);

  if (verdict.accepted && verdict.point) {
    if (verdict.action === "replace_previous" && state.trustedPath.length > 0) {
      state.trustedPath.pop();
    }
    state.trustedPath.push(verdict.point);
    state.previousSpeedMps = Number(verdict.calculatedSpeedMps || verdict.point.speed || 0) || 0;
  }

  return {
    enabled: true,
    acceptedByRelaxedFilter: Boolean(verdict.accepted),
    relaxedRejectReason: verdict.reason || null,
    relaxedAction: verdict.action || null,
    relaxedAcceptedPoints: state.trustedPath.length,
  };
}

export function resetGpsShadowRun(runId) {
  if (runId) relaxedStates.delete(String(runId));
}

export function __resetGpsShadowForTests() {
  relaxedStates.clear();
  gpsDebugShadowModeOverride = null;
}

export function __setGpsDebugShadowModeForTests(enabled) {
  relaxedStates.clear();
  gpsDebugShadowModeOverride = enabled == null ? null : Boolean(enabled);
  return isGpsDebugShadowEnabled();
}

export default {
  GPS_DEBUG_SHADOW_MODE,
  evaluateGpsShadowPoint,
  getRelaxedTrackingPreset,
  isGpsDebugShadowEnabled,
  resetGpsShadowRun,
};
