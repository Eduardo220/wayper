import {
  ACTIVE_RUN_STATUS,
  TRACKING_CONFIG,
  calculateActiveRunDurationSeconds,
  createTrackingSessionFromSnapshot,
  getGpsQualityWarning,
  limitPathForRendering,
  sanitizeRunPath,
  splitPathIntoSegments,
} from "../../services/runTracking";

export const sanitizePath = (path = []) => sanitizeRunPath(path);

export const sanitizeSegmentPath = (path = [], segmentId = 0) =>
  sanitizePath(path).map((point) => ({
    ...point,
    segmentId: Number.isFinite(Number(point.segmentId)) ? Number(point.segmentId) : segmentId,
  }));

export const sanitizeSegmentPaths = (segments = []) =>
  (Array.isArray(segments) ? segments : [])
    .map((segment, index) => sanitizeSegmentPath(
      Array.isArray(segment)
        ? segment
        : segment?.liveRenderPath || segment?.trustedPath || [],
      index
    ))
    .filter((segment) => segment.length >= 2);

export const flattenSegmentPaths = (segments = []) => sanitizeSegmentPaths(segments).flat();

const isRecoverableStatus = (status) => [
  ACTIVE_RUN_STATUS.STARTING,
  ACTIVE_RUN_STATUS.RECOVERING,
  ACTIVE_RUN_STATUS.ERROR_RECOVERABLE,
].includes(status);

const getProjectedRunStatus = (status, paused, recoverable) => {
  if (status === ACTIVE_RUN_STATUS.RUNNING) return "active";
  if (paused) return "paused";
  if (recoverable) return "recovering";
  return "idle";
};

function projectPaths({ snapshot, trackingState, previous, sameRun, status }) {
  const restoredPath = sanitizePath(
    trackingState.trustedPath || snapshot.trustedPath || snapshot.path || []
  );
  const previousPath = sameRun ? sanitizePath(previous.trustedPath) : [];
  let trustedPath = restoredPath.length ? restoredPath : previousPath;
  const restoredSegments = sanitizeSegmentPaths(
    trackingState.liveRenderSegments || snapshot.routeSegments || snapshot.segments || []
  );
  const previousSegments = sameRun ? sanitizeSegmentPaths(previous.liveSegments) : [];
  let liveSegments = restoredSegments.length ? restoredSegments : previousSegments;
  let livePath = limitPathForRendering(
    liveSegments.length
      ? flattenSegmentPaths(liveSegments)
      : sanitizePath(trackingState.liveRenderPath || snapshot.liveRenderPath || trustedPath),
    TRACKING_CONFIG.DISPLAY_PATH_MAX_POINTS
  );
  let segmentSnapshot = liveSegments.length ? liveSegments : splitPathIntoSegments(livePath);
  const stalePathBlocked = sameRun &&
    status === ACTIVE_RUN_STATUS.RUNNING &&
    restoredPath.length > 0 &&
    restoredPath.length < previousPath.length;
  if (stalePathBlocked) {
    trustedPath = previousPath;
    liveSegments = previousSegments;
    livePath = previous.livePath?.length
      ? previous.livePath
      : limitPathForRendering(previousPath, TRACKING_CONFIG.DISPLAY_PATH_MAX_POINTS);
    segmentSnapshot = liveSegments.length ? liveSegments : splitPathIntoSegments(livePath);
  }
  return {
    trustedPath,
    livePath,
    liveSegments: segmentSnapshot,
    emptyOverwriteBlocked: sameRun && restoredPath.length === 0 && previousPath.length > 0,
    stalePathBlocked,
    incomingPathLength: restoredPath.length,
  };
}

export function projectActiveRunSnapshot(snapshot = {}, previous = {}, options = {}) {
  if (!snapshot.activeRunId) return null;
  const status = snapshot.status || ACTIVE_RUN_STATUS.RUNNING;
  const paused = status === ACTIVE_RUN_STATUS.PAUSED;
  const recoverable = isRecoverableStatus(status);
  const live = status === ACTIVE_RUN_STATUS.RUNNING || paused || recoverable;
  const sameRun = Boolean(previous.activeRunId === snapshot.activeRunId);
  const session = createTrackingSessionFromSnapshot(snapshot);
  const trackingState = session.getState?.() || {};
  const paths = projectPaths({ snapshot, trackingState, previous, sameRun, status });
  const incomingDistanceMeters = Number(
    snapshot.distanceMeters ?? snapshot.distance ?? trackingState.stats?.distanceMeters ?? 0
  ) || 0;
  let distanceMeters = status === ACTIVE_RUN_STATUS.RUNNING && sameRun
    ? Math.max(Number(previous.distanceMeters) || 0, incomingDistanceMeters)
    : incomingDistanceMeters;
  let durationSeconds = calculateActiveRunDurationSeconds(snapshot, {
    nowMs: options.nowMs ?? Date.now(),
  });
  const elapsedRegressionBlocked = sameRun &&
    status === ACTIVE_RUN_STATUS.RUNNING &&
    durationSeconds < (Number(previous.durationSeconds) || 0);
  if (elapsedRegressionBlocked) durationSeconds = Number(previous.durationSeconds) || durationSeconds;
  const runStatus = getProjectedRunStatus(status, paused, recoverable);

  return {
    status,
    paused,
    recoverable,
    live,
    sameRun,
    session,
    runStatus,
    trustedPath: paths.trustedPath,
    rawPath: sanitizePath(snapshot.rawPath || snapshot.rawPoints || paths.trustedPath),
    livePath: paths.livePath,
    liveSegments: paths.liveSegments,
    distanceMeters,
    durationSeconds,
    location: snapshot.currentLocation || null,
    gpsQualityWarning: getGpsQualityWarning(snapshot.gpsQualitySummary || snapshot.pathQuality),
    emptyOverwriteBlocked: paths.emptyOverwriteBlocked,
    stalePathBlocked: paths.stalePathBlocked,
    distanceRegressionBlocked: status === ACTIVE_RUN_STATUS.RUNNING &&
      incomingDistanceMeters < (Number(previous.distanceMeters) || 0),
    elapsedRegressionBlocked,
    incomingPathLength: paths.incomingPathLength,
    incomingDistanceMeters,
  };
}
