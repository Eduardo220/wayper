import { isValidCoordinate } from "../tracking/trackingMath.js";
import { TRACK_SEGMENT_REASON } from "./trackTypes.js";

const clonePoint = (point) => ({ ...point });

export function sanitizeRunPath(path = []) {
  return (Array.isArray(path) ? path : [])
    .map((point, index) => {
      if (!point) return null;
      const latitude = Number(point.latitude ?? point.lat ?? point.coords?.latitude);
      const longitude = Number(point.longitude ?? point.lng ?? point.lon ?? point.coords?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
      return {
        ...point,
        latitude,
        longitude,
        timestamp: point.timestamp ?? point.time ?? point.t ?? null,
        index: Number.isFinite(Number(point.index)) ? Number(point.index) : index,
      };
    })
    .filter(Boolean);
}

function withSegmentId(path = [], segmentIndex = 0) {
  return sanitizeRunPath(path).map((point) => ({
    ...point,
    segmentId: Number.isFinite(Number(point.segmentId)) ? Number(point.segmentId) : segmentIndex,
  }));
}

export function normalizeTrackSegment(segment = {}, index = 0) {
  const segmentIndex = Number.isFinite(Number(segment.index ?? segment.segmentId))
    ? Number(segment.index ?? segment.segmentId)
    : index;
  const rawPoints = withSegmentId(segment.rawPoints || segment.rawPath || [], segmentIndex);
  const filteredPoints = withSegmentId(segment.filteredPoints || segment.trustedPath || segment.path || [], segmentIndex);
  const displayPoints = withSegmentId(
    segment.displayPoints ||
      segment.summaryRenderPath ||
      segment.renderPath ||
      segment.liveRenderPath ||
      filteredPoints,
    segmentIndex
  );

  return {
    id: String(segment.id || `segment_${segmentIndex}`),
    index: segmentIndex,
    reason: segment.reason || TRACK_SEGMENT_REASON.active,
    startTimestamp: segment.startTimestamp ?? segment.startedAt ?? filteredPoints[0]?.timestamp ?? rawPoints[0]?.timestamp ?? null,
    endTimestamp: segment.endTimestamp ?? segment.endedAt ?? filteredPoints[filteredPoints.length - 1]?.timestamp ?? rawPoints[rawPoints.length - 1]?.timestamp ?? null,
    rawPoints,
    filteredPoints,
    displayPoints,
    rawPath: rawPoints,
    trustedPath: filteredPoints,
    liveRenderPath: withSegmentId(segment.liveRenderPath || displayPoints, segmentIndex),
    summaryRenderPath: displayPoints,
    startedAt: segment.startedAt ?? segment.startTimestamp ?? null,
    endedAt: segment.endedAt ?? segment.endTimestamp ?? null,
    endReason: segment.endReason || null,
  };
}

export function normalizeTrackSegments(segments = []) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment, index) => normalizeTrackSegment(segment, index))
    .filter((segment) =>
      segment.rawPoints.length > 0 ||
      segment.filteredPoints.length > 0 ||
      segment.displayPoints.length > 0
    );
}

export function flattenSegments(segments = [], key = "filteredPoints") {
  return normalizeTrackSegments(segments).flatMap((segment) => segment[key] || []);
}

export function splitPathIntoSegments(path = []) {
  const points = sanitizeRunPath(path).filter(isValidCoordinate);
  if (points.length === 0) return [];
  const segments = [];
  let current = [];
  for (const point of points) {
    const last = current[current.length - 1];
    const segmentChanged = last && Number(point.segmentId || 0) !== Number(last.segmentId || 0);
    if (current.length > 0 && segmentChanged) {
      if (current.length >= 2) segments.push(current.map(clonePoint));
      current = [];
    }
    current.push(point);
  }
  if (current.length >= 2) segments.push(current.map(clonePoint));
  return segments;
}

export function getDisplaySegmentsForRun(run = {}, mode = "result") {
  const segments = normalizeTrackSegments(run.routeSegments || run.segments || []);
  if (segments.length > 0) {
    return segments
      .map((segment) => {
        if (mode === "live") return segment.liveRenderPath.length >= 2 ? segment.liveRenderPath : segment.filteredPoints;
        if (mode === "zone") return segment.filteredPoints.length >= 2 ? segment.filteredPoints : segment.displayPoints;
        return segment.displayPoints.length >= 2 ? segment.displayPoints : segment.filteredPoints;
      })
      .filter((segment) => segment.length >= 2);
  }

  const fallback = sanitizeRunPath(
    run.displayPoints ||
      run.displayPath ||
      run.renderPath ||
      run.summaryRenderPath ||
      run.filteredPoints ||
      run.trustedPath ||
      run.path ||
      []
  );
  return splitPathIntoSegments(fallback.length >= 2 ? fallback : []);
}

export function limitPathForRendering(path = [], maxPoints = 2500) {
  const points = Array.isArray(path) ? path : [];
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index === 0 || index === points.length - 1 || index % step === 0);
}

export default {
  flattenSegments,
  getDisplaySegmentsForRun,
  limitPathForRendering,
  normalizeTrackSegment,
  normalizeTrackSegments,
  sanitizeRunPath,
  splitPathIntoSegments,
};
