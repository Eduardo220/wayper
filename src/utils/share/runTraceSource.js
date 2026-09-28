import logger, { LOG_CATEGORIES } from "../logger.js";

export class TracePointsInsufficientError extends Error {
  constructor(message = "Tracado indisponivel para esta corrida.") {
    super(message);
    this.name = "TracePointsInsufficientError";
    this.code = "TRACE_POINTS_INSUFFICIENT";
  }
}

export function normalizeRunPath(path = []) {
  return (Array.isArray(path) ? path : [])
    .map((point) => {
      let latitude;
      let longitude;

      if (Array.isArray(point)) {
        latitude = Number(point[0]);
        longitude = Number(point[1]);

        if (Math.abs(latitude) > 90 && Math.abs(longitude) <= 90) {
          const temp = latitude;
          latitude = longitude;
          longitude = temp;
        }
      } else {
        latitude = Number(point?.latitude ?? point?.lat ?? point?.coords?.latitude);
        longitude = Number(point?.longitude ?? point?.lon ?? point?.lng ?? point?.coords?.longitude);
      }

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      ) {
        return null;
      }

      return { latitude, longitude, timestamp: point?.timestamp ?? point?.time ?? null };
    })
    .filter(Boolean);
}

export function normalizeTraceSegments(segments = []) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) =>
      normalizeRunPath(
        Array.isArray(segment)
          ? segment
          : segment?.displayPoints ||
              segment?.summaryRenderPath ||
              segment?.renderPath ||
              segment?.displayPath ||
              segment?.filteredPoints ||
              segment?.trustedPath ||
              []
      )
    )
    .filter((segment) => segment.length >= 2);
}

export function getRenderableTraceSource({ path = [], segments = [], zoneCoords = [], isZone = false } = {}) {
  const normalizedPath = normalizeRunPath(path);
  const normalizedSegments = normalizeTraceSegments(segments);
  const normalizedZone = normalizeRunPath(zoneCoords);

  if (isZone && normalizedZone.length >= 3) {
    return { points: normalizedZone, segments: [], type: "zone" };
  }

  if (normalizedSegments.length > 0) {
    return { points: normalizedSegments.flat(), segments: normalizedSegments, type: "route" };
  }

  if (normalizedPath.length >= 2) {
    return { points: normalizedPath, segments: [], type: "route" };
  }

  return { points: normalizedPath, segments: [], type: "route" };
}

export function assertTraceHasEnoughPoints({ path = [], segments = [], zoneCoords = [], isZone = false } = {}) {
  const source = getRenderableTraceSource({ path, segments, zoneCoords, isZone });
  const minPoints = source.type === "zone" ? 3 : 2;

  if (source.points.length < minPoints) {
    logger.warn(LOG_CATEGORIES.SHARE, "SHARE_TRACE_POINTS_INSUFFICIENT", {
      type: source.type,
      points: source.points.length,
      minPoints,
    }, { forcePersist: true });
    throw new TracePointsInsufficientError();
  }

  return source;
}

export default {
  TracePointsInsufficientError,
  assertTraceHasEnoughPoints,
  getRenderableTraceSource,
  normalizeRunPath,
  normalizeTraceSegments,
};
