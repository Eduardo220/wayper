import {
  buildLiveRenderPath,
  buildSummaryRenderPath,
  removeDuplicateVisualPoints,
  removeTinyBacktracks,
  simplifyPathByDistance,
  validateRenderPath,
} from "../tracking/trackingRenderPath.js";
import {
  preventCornerOvercut,
  smoothPathCatmullRom,
  smoothPathChaikin,
  smoothPathMovingAverage,
} from "../tracking/trackingSmoothing.js";
import {
  calculatePathDistanceMeters,
  isValidCoordinate,
} from "../tracking/trackingMath.js";

export function createDisplayPoints(filteredPoints = [], options = {}) {
  const points = (Array.isArray(filteredPoints) ? filteredPoints : []).filter(isValidCoordinate);
  const mode = options.mode || "result";
  if (points.length < 3) return points.map((point) => ({ ...point }));
  if (mode === "live") return buildLiveRenderPath(points, options);
  return buildSummaryRenderPath(points, options);
}

export function smoothDisplayPath(path = [], context = {}) {
  return createDisplayPoints(path, {
    mode: context.mode || "live",
    preset: context.preset || context.config || "run",
  });
}

export function finalizeRoutePath(path = [], options = {}) {
  const points = (Array.isArray(path) ? path : []).filter(isValidCoordinate);
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const toleranceMeters = Number(options.toleranceM ?? options.toleranceMeters ?? 2.5);
  const simplified = simplifyPathByDistance(removeDuplicateVisualPoints(points, options.minPointDistanceM ?? 0.9), toleranceMeters);
  return simplified.length >= 2 ? simplified : points.slice(0, 2);
}

export function beautifyRoutePath(path = [], options = {}) {
  const points = finalizeRoutePath(path, options);
  return createDisplayPoints(points, {
    ...options,
    mode: options.mode || "result",
    maxPoints: options.maxPoints || 1200,
  });
}

export const calculateRouteDistance = calculatePathDistanceMeters;
export const calculateTrackDistanceMeters = calculatePathDistanceMeters;

export {
  buildLiveRenderPath,
  buildSummaryRenderPath,
  preventCornerOvercut,
  removeDuplicateVisualPoints,
  removeTinyBacktracks,
  simplifyPathByDistance,
  smoothPathCatmullRom,
  smoothPathChaikin,
  smoothPathMovingAverage,
  validateRenderPath,
};

export default {
  beautifyRoutePath,
  buildLiveRenderPath,
  buildSummaryRenderPath,
  calculateRouteDistance,
  calculateTrackDistanceMeters,
  createDisplayPoints,
  finalizeRoutePath,
  smoothDisplayPath,
  preventCornerOvercut,
  removeDuplicateVisualPoints,
  removeTinyBacktracks,
  simplifyPathByDistance,
  smoothPathCatmullRom,
  smoothPathChaikin,
  smoothPathMovingAverage,
  validateRenderPath,
};
