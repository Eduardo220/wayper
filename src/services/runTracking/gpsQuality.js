import { getTrackingPreset } from "../tracking/trackingConfig.js";
import { calculateAverageAccuracy } from "../tracking/trackingMath.js";
import {
  GPS_QUALITY_LEVEL,
  RUN_TRACKING_FILTER_VERSION,
  RUN_TRACKING_SMOOTHING_VERSION,
  TRACK_SEGMENT_REASON,
} from "./trackTypes.js";

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function collectAccuracies(points = []) {
  return (Array.isArray(points) ? points : [])
    .map((point) => finite(point?.accuracy))
    .filter((value) => value != null && value >= 0);
}

export function getGpsQualityLevel(accuracy, presetInput = "run") {
  const preset = getTrackingPreset(presetInput);
  const value = finite(accuracy);
  if (value == null) return GPS_QUALITY_LEVEL.unknown;
  if (value <= preset.quality.excellentAccuracyMeters) return GPS_QUALITY_LEVEL.excellent;
  if (value <= preset.quality.goodAccuracyMeters) return GPS_QUALITY_LEVEL.good;
  if (value <= preset.maxAccuracyMeters) return GPS_QUALITY_LEVEL.acceptable;
  if (value <= preset.quality.badAccuracyMeters) return GPS_QUALITY_LEVEL.poor;
  return GPS_QUALITY_LEVEL.bad;
}

export function getGpsQualityWarning(summary = {}) {
  const level = summary.qualityLevel || GPS_QUALITY_LEVEL.unknown;
  if (level === GPS_QUALITY_LEVEL.bad || Number(summary.poorAccuracyRatio || 0) >= 0.45) {
    return "GPS instavel. Va para uma area aberta para melhorar a precisao.";
  }
  if (level === GPS_QUALITY_LEVEL.poor || Number(summary.poorAccuracyRatio || 0) >= 0.22) {
    return "Sinal GPS fraco. A rota pode ficar menos precisa.";
  }
  return null;
}

export function summarizeGpsQuality({
  rawPoints = [],
  filteredPoints = [],
  rejectedPoints = null,
  segments = [],
  pathQuality = null,
  preset = "run",
} = {}) {
  const presetConfig = getTrackingPreset(preset);
  const raw = Array.isArray(rawPoints) ? rawPoints : [];
  const filtered = Array.isArray(filteredPoints) ? filteredPoints : [];
  const rawAccuracies = collectAccuracies(raw);
  const filteredAccuracies = collectAccuracies(filtered);
  const averageAccuracy =
    calculateAverageAccuracy(filtered) ??
    (rawAccuracies.length > 0
      ? rawAccuracies.reduce((sum, value) => sum + value, 0) / rawAccuracies.length
      : null);
  const poorAccuracyCount = rawAccuracies.filter((value) => value > presetConfig.maxAccuracyMeters).length;
  const poorAccuracyRatio = rawAccuracies.length > 0 ? poorAccuracyCount / rawAccuracies.length : 0;
  const gpsGapCount = (Array.isArray(segments) ? segments : []).filter(
    (segment) => segment?.reason === TRACK_SEGMENT_REASON.gps_gap || segment?.endReason === TRACK_SEGMENT_REASON.gps_gap
  ).length + Number(pathQuality?.gpsGapCount || 0);
  const totalRawPoints = Number(pathQuality?.totalRawPoints ?? pathQuality?.rawPoints ?? raw.length) || 0;
  const acceptedPoints = Number(pathQuality?.acceptedPoints ?? filtered.length) || 0;
  const rejected = rejectedPoints == null
    ? Number(pathQuality?.rejectedPoints ?? Math.max(0, totalRawPoints - acceptedPoints)) || 0
    : Number(rejectedPoints) || 0;

  let qualityLevel = getGpsQualityLevel(averageAccuracy, preset);
  if (poorAccuracyRatio >= 0.45 || gpsGapCount >= 3) qualityLevel = GPS_QUALITY_LEVEL.bad;
  else if (poorAccuracyRatio >= 0.22 || gpsGapCount > 0) qualityLevel = GPS_QUALITY_LEVEL.poor;
  else if (filteredAccuracies.length === 0 && totalRawPoints > 0) qualityLevel = GPS_QUALITY_LEVEL.unknown;

  const summary = {
    totalRawPoints,
    acceptedPoints,
    rejectedPoints: rejected,
    averageAccuracy,
    poorAccuracyRatio,
    gpsGapCount,
    smoothingVersion: pathQuality?.smoothingVersion || RUN_TRACKING_SMOOTHING_VERSION,
    filterVersion: pathQuality?.filterVersion || RUN_TRACKING_FILTER_VERSION,
    qualityLevel,
  };

  return {
    ...summary,
    warning: getGpsQualityWarning(summary),
  };
}

export default {
  getGpsQualityLevel,
  getGpsQualityWarning,
  summarizeGpsQuality,
};
