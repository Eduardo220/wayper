import { RUN_LINE_MODE } from "./trackTypes.js";
import { normalizeTrackSegments, sanitizeRunPath } from "./trackSegments.js";

function toLngLat(point) {
  const latitude = Number(point?.latitude ?? point?.lat);
  const longitude = Number(point?.longitude ?? point?.lng ?? point?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return [longitude, latitude];
}

function pointsForSegment(segment, mode) {
  if (Array.isArray(segment)) return sanitizeRunPath(segment);
  if (mode === RUN_LINE_MODE.live) {
    return sanitizeRunPath(segment.liveRenderPath || segment.displayPoints || segment.filteredPoints || segment.trustedPath || []);
  }
  if (mode === RUN_LINE_MODE.zone) {
    return sanitizeRunPath(segment.filteredPoints || segment.trustedPath || segment.displayPoints || segment.summaryRenderPath || []);
  }
  return sanitizeRunPath(segment.displayPoints || segment.summaryRenderPath || segment.renderPath || segment.filteredPoints || segment.trustedPath || []);
}

function normalizeInputSegments(input = [], mode = RUN_LINE_MODE.result) {
  if (!Array.isArray(input)) return [];
  const looksLikePath = input.length > 0 && !Array.isArray(input[0]) && !input[0]?.filteredPoints && !input[0]?.trustedPath && input[0]?.latitude != null;
  if (looksLikePath) return [sanitizeRunPath(input)];

  const normalized = normalizeTrackSegments(input);
  if (normalized.length > 0) return normalized.map((segment) => pointsForSegment(segment, mode));
  return input.map((segment) => pointsForSegment(segment, mode));
}

export function buildRunLineFeature(segments = [], mode = RUN_LINE_MODE.result, properties = {}) {
  const lines = normalizeInputSegments(segments, mode)
    .map((segment) => segment.map(toLngLat).filter(Boolean))
    .filter((segment) => segment.length >= 2);

  if (lines.length === 0) return null;
  const geometry = lines.length === 1
    ? { type: "LineString", coordinates: lines[0] }
    : { type: "MultiLineString", coordinates: lines };

  return {
    type: "Feature",
    properties: {
      mode,
      kind: "run-line",
      ...properties,
    },
    geometry,
  };
}

export function buildRunLineGeoJson(segments = [], mode = RUN_LINE_MODE.result, properties = {}) {
  const normalizedSegments = normalizeInputSegments(segments, mode);
  const feature = buildRunLineFeature(normalizedSegments, mode, properties);
  return {
    type: "FeatureCollection",
    features: feature ? [feature] : [],
  };
}

export default {
  buildRunLineFeature,
  buildRunLineGeoJson,
};
