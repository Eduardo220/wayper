import { TRACKING_DEBUG_ENABLED, TRACKING_SMOOTHING_VERSION } from "./trackingConfig.js";

export function isTrackingDebugEnabled(options = {}) {
  return Boolean(
    options.enabled ??
      TRACKING_DEBUG_ENABLED ??
      (typeof __DEV__ !== "undefined" && __DEV__ && false)
  );
}

export function buildTrackingDebugSnapshot(sessionState = {}) {
  const pathQuality = sessionState.pathQuality || {};
  return {
    rawPoints: pathQuality.rawPoints || 0,
    acceptedPoints: pathQuality.acceptedPoints || 0,
    rejectedPoints: pathQuality.rejectedPoints || 0,
    averageAccuracy: pathQuality.averageAccuracy ?? null,
    maxAccuracy: pathQuality.maxAccuracy ?? null,
    rejectedByAccuracy: pathQuality.rejectedByAccuracy || 0,
    rejectedBySpeed: pathQuality.rejectedBySpeed || 0,
    rejectedByDistance: pathQuality.rejectedByDistance || 0,
    rejectedByZigzag: pathQuality.rejectedByZigzag || 0,
    rejectedByDuplicate: pathQuality.rejectedByDuplicate || 0,
    rejectedByTimestamp: pathQuality.rejectedByTimestamp || 0,
    rejectedByWarmup: pathQuality.rejectedByWarmup || 0,
    suspiciousPoints: pathQuality.suspiciousPoints || 0,
    gpsGapCount: pathQuality.gpsGapCount || 0,
    lastRejectReason: pathQuality.lastRejectReason || null,
    lastAccuracyMeters: pathQuality.lastAccuracyMeters ?? null,
    lastCalculatedSpeedMps: pathQuality.lastCalculatedSpeedMps ?? null,
    smoothingVersion: TRACKING_SMOOTHING_VERSION,
  };
}

export function logTrackingDebug(label, payload = {}, options = {}) {
  if (!isTrackingDebugEnabled(options)) return;
  try {
    console.log(`[WayperTracking:${label}]`, payload);
  } catch {
    // Logging should never affect a run.
  }
}

export default {
  buildTrackingDebugSnapshot,
  isTrackingDebugEnabled,
  logTrackingDebug,
};
