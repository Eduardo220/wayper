import {
  buildSummaryRenderPath,
  calculateRouteDistance,
  sanitizeRunPath,
} from "../runTracking/index.js";
import { resolveFinalRunTiming } from "./runFinalizationService.js";

const sanitizePath = (path = []) => sanitizeRunPath(path);

export function sanitizeTrackingSegments(segments = []) {
  return (Array.isArray(segments) ? segments : []).map((segment, index) => {
    const segmentId = Number.isFinite(Number(segment?.index ?? segment?.segmentId))
      ? Number(segment.index ?? segment.segmentId)
      : index;
    const withSegmentId = (path) => sanitizePath(path).map((point) => ({
      ...point,
      segmentId: Number.isFinite(Number(point.segmentId)) ? Number(point.segmentId) : segmentId,
    }));
    return {
      id: String(segment?.id || `segment_${segmentId}`),
      index: segmentId,
      startedAt: segment?.startedAt || null,
      endedAt: segment?.endedAt || null,
      rawPath: withSegmentId(segment?.rawPath || []),
      trustedPath: withSegmentId(segment?.trustedPath || []),
      liveRenderPath: withSegmentId(segment?.liveRenderPath || []),
      summaryRenderPath: withSegmentId(segment?.summaryRenderPath || []),
    };
  });
}

function resolveTiming(snapshot, session, options) {
  return resolveFinalRunTiming({
    ...snapshot,
    startedAtMs: snapshot.startedAtMs || snapshot.startedAt || session?.state?.startedAt || null,
    currentLocation: snapshot.currentLocation || options.lastAcceptedLocation || null,
  }, {
    finishedAtMs: options.finishedAtMs,
    uiDurationMs: Math.max(0, Number(options.uiDurationSeconds) || 0) * 1000,
  });
}

function resolvePaths(snapshot, trackingFinish, options) {
  const snapshotPath = sanitizePath(snapshot.trustedPath || snapshot.path || []);
  const trustedPath = snapshotPath.length
    ? snapshotPath
    : sanitizePath(trackingFinish?.trustedPath || options.fallbackPath);
  const path = trustedPath.length
    ? trustedPath
    : sanitizePath([options.fallbackLocation].filter(Boolean));
  const renderPath = sanitizePath(
    snapshot.renderPath ||
    snapshot.summaryRenderPath ||
    trackingFinish?.summaryRenderPath ||
    trackingFinish?.renderPath ||
    (path.length > 1 ? buildSummaryRenderPath(path) : path)
  );
  return {
    path,
    renderPath,
    rawPath: sanitizePath(snapshot.rawPath || trackingFinish?.rawPath || path),
    liveRenderPath: sanitizePath(
      snapshot.liveRenderPath || trackingFinish?.liveRenderPath || options.liveRenderPath
    ),
  };
}

function resolveMetrics({ snapshot, trackingFinish, path, options, durationSeconds }) {
  const measuredDistance = Number(snapshot.distanceMeters || trackingFinish?.distanceMeters || 0) ||
    calculateRouteDistance(path);
  const distanceMeters = measuredDistance > 0
    ? measuredDistance
    : Math.max(0, Number(options.fallbackDistanceMeters) || 0);
  return {
    distanceMeters,
    avgSpeed: distanceMeters && durationSeconds
      ? Number(((distanceMeters / 1000) / (durationSeconds / 3600)).toFixed(2))
      : 0,
    maxSpeed: Number(((trackingFinish?.maxSpeedMps || 0) * 3.6).toFixed(2)) || 0,
  };
}

function addTerritoryPendingData(runData) {
  if (runData.mode !== "zones") return runData;
  return Object.assign(runData, {
    areaM2: 0,
    territorySummary: null,
    territoryEvents: [],
    capturedCells: [],
    territoryCaptureStatus: "PENDING",
    territoryData: { pendingCalculation: true, deferred: true, reason: "finish_local_first" },
    territoryCaptureMessage: "Corrida salva. Captura territorial sera processada em seguida.",
  });
}

export function buildFinishedRunData(options = {}) {
  const snapshot = options.snapshot || {};
  const session = options.trackingSession || null;
  const finalTiming = resolveTiming(snapshot, session, options);
  const finishedAtMs = finalTiming.finishedAtMs ?? options.finishedAtMs ?? Date.now();
  const durationSeconds = finalTiming.durationSeconds;
  const trackingFinish = session?.finishTrackingSession?.({
    durationMs: durationSeconds * 1000,
    finishedAt: finishedAtMs,
  }) || null;
  const paths = resolvePaths(snapshot, trackingFinish, options);
  const metrics = resolveMetrics({
    snapshot,
    trackingFinish,
    path: paths.path,
    options,
    durationSeconds,
  });
  const finishedAt = new Date(finishedAtMs).toISOString();
  const segments = sanitizeTrackingSegments(snapshot.segments || trackingFinish?.segments || []);
  const routeSegments = sanitizeTrackingSegments(
    snapshot.routeSegments || snapshot.segments || trackingFinish?.segments || []
  );
  const runData = {
    id: options.runId,
    segments,
    routeSegments,
    path: paths.path,
    trustedPath: paths.path,
    filteredPoints: paths.path,
    rawPath: paths.rawPath,
    rawPoints: paths.rawPath,
    liveRenderPath: paths.liveRenderPath,
    renderPath: paths.renderPath,
    displayPath: paths.renderPath,
    displayPoints: paths.renderPath,
    pathQuality: snapshot.pathQuality || trackingFinish?.pathQuality || null,
    gpsQualitySummary: snapshot.gpsQualitySummary || trackingFinish?.gpsQualitySummary ||
      trackingFinish?.pathQuality || null,
    lowConfidenceSegments: snapshot.lowConfidenceSegments || trackingFinish?.lowConfidenceSegments || [],
    smoothingVersion: snapshot.smoothingVersion || trackingFinish?.smoothingVersion || "wayper_tracking_v2",
    filterVersion: snapshot.filterVersion || trackingFinish?.filterVersion ||
      trackingFinish?.pathQuality?.filterVersion || "wayper_gps_filter_v2",
    distance: metrics.distanceMeters,
    distanceMeters: metrics.distanceMeters,
    duration: durationSeconds,
    durationSeconds,
    avgSpeed: metrics.avgSpeed,
    maxSpeed: metrics.maxSpeed,
    date: finishedAt,
    startedAt: snapshot.startedAt || session?.state?.startedAt ||
      (finalTiming.startedAtMs ? new Date(finalTiming.startedAtMs).toISOString() : null),
    endedAt: finishedAt,
    finishedAt,
    pausedDurationSeconds: finalTiming.pausedDurationSeconds,
    pausedDurationMs: finalTiming.totalPausedMs,
    totalPausedMs: finalTiming.totalPausedMs,
    status: "completed",
    mode: options.mode || "free",
    area: 0,
    zoneId: null,
    zoneCoords: [],
    zoneCount: 0,
  };
  return { runData: addTerritoryPendingData(runData), trackingFinish, finalTiming };
}

export default { buildFinishedRunData };
