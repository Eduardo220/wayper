export const TRACKING_SMOOTHING_VERSION = "wayper_tracking_v2";
export const TRACKING_FILTER_VERSION = "wayper_gps_filter_v2";

export const TRACKING_DEBUG_ENABLED = false;

export const TRACKING_PRESETS = {
  run: {
    maxAccuracyMeters: 25,
    softMaxAccuracyMeters: 35,
    hardMaxAccuracyMeters: 50,

    minDistanceMeters: 3,
    minUsefulDistanceMeters: 2,
    stationaryDistanceMeters: 1.5,

    minTimeMs: 700,
    idealTimeMs: 1000,

    maxSpeedMps: 8.5,
    hardMaxSpeedMps: 10.5,

    maxAccelerationMps2: 4.5,

    gpsGapTimeMs: 15000,
    gpsGapMinDistanceMeters: 8,
    gpsGapDistanceMeters: 80,

    zigzagAngleDegrees: 115,
    zigzagMaxSegmentMeters: 18,
    zigzagMinAccuracyPenaltyMeters: 18,

    liveSimplifyToleranceMeters: 2.5,
    summarySimplifyToleranceMeters: 5.5,

    liveSmoothingStrength: 0.28,
    summarySmoothingStrength: 0.42,

    maxVisualCornerCutMeters: 5,

    minPointsForSmoothing: 4,
    minPointsForSpline: 6,

    currentPositionSmoothing: {
      minAlpha: 0.18,
      maxAlpha: 0.55,
      accuracyWeight: true,
      speedWeight: true,
    },

    quality: {
      excellentAccuracyMeters: 15,
      goodAccuracyMeters: 25,
      acceptableAccuracyMeters: 35,
      badAccuracyMeters: 50,
    },
  },
  walk: {
    maxAccuracyMeters: 28,
    softMaxAccuracyMeters: 42,
    hardMaxAccuracyMeters: 60,
    minDistanceMeters: 2,
    minUsefulDistanceMeters: 1.5,
    stationaryDistanceMeters: 1.2,
    minTimeMs: 800,
    idealTimeMs: 1200,
    maxSpeedMps: 3.2,
    hardMaxSpeedMps: 4.8,
    maxAccelerationMps2: 2.5,
    gpsGapTimeMs: 15000,
    gpsGapMinDistanceMeters: 6,
    gpsGapDistanceMeters: 70,
    zigzagAngleDegrees: 118,
    zigzagMaxSegmentMeters: 14,
    zigzagMinAccuracyPenaltyMeters: 18,
    liveSimplifyToleranceMeters: 2,
    summarySimplifyToleranceMeters: 4.5,
    liveSmoothingStrength: 0.32,
    summarySmoothingStrength: 0.46,
    maxVisualCornerCutMeters: 5,
    minPointsForSmoothing: 4,
    minPointsForSpline: 6,
    currentPositionSmoothing: {
      minAlpha: 0.14,
      maxAlpha: 0.46,
      accuracyWeight: true,
      speedWeight: true,
    },
    quality: {
      excellentAccuracyMeters: 10,
      goodAccuracyMeters: 22,
      acceptableAccuracyMeters: 40,
      badAccuracyMeters: 60,
    },
  },
  bike: {
    maxAccuracyMeters: 25,
    softMaxAccuracyMeters: 35,
    hardMaxAccuracyMeters: 55,
    minDistanceMeters: 4,
    minUsefulDistanceMeters: 3,
    stationaryDistanceMeters: 1.8,
    minTimeMs: 600,
    idealTimeMs: 1000,
    maxSpeedMps: 16,
    hardMaxSpeedMps: 22,
    maxAccelerationMps2: 6.5,
    gpsGapTimeMs: 15000,
    gpsGapMinDistanceMeters: 12,
    gpsGapDistanceMeters: 120,
    zigzagAngleDegrees: 120,
    zigzagMaxSegmentMeters: 24,
    zigzagMinAccuracyPenaltyMeters: 18,
    liveSimplifyToleranceMeters: 3.2,
    summarySimplifyToleranceMeters: 6.5,
    liveSmoothingStrength: 0.22,
    summarySmoothingStrength: 0.36,
    maxVisualCornerCutMeters: 7,
    minPointsForSmoothing: 4,
    minPointsForSpline: 6,
    currentPositionSmoothing: {
      minAlpha: 0.22,
      maxAlpha: 0.68,
      accuracyWeight: true,
      speedWeight: true,
    },
    quality: {
      excellentAccuracyMeters: 10,
      goodAccuracyMeters: 20,
      acceptableAccuracyMeters: 35,
      badAccuracyMeters: 55,
    },
  },
};

export const TRACKING_CONFIG = {
  GPS_ACCURACY_IDEAL_M: TRACKING_PRESETS.run.quality.excellentAccuracyMeters,
  GPS_ACCURACY_ACCEPTABLE_M: TRACKING_PRESETS.run.maxAccuracyMeters,
  GPS_ACCURACY_MAX_M: TRACKING_PRESETS.run.softMaxAccuracyMeters,
  GPS_ACCURACY_HARD_REJECT_M: TRACKING_PRESETS.run.hardMaxAccuracyMeters,
  GPS_GAP_TIME_MS: TRACKING_PRESETS.run.gpsGapTimeMs,
  GPS_GAP_DISTANCE_M: TRACKING_PRESETS.run.gpsGapDistanceMeters,
  MIN_DISTANCE_WHEN_STILL_M: TRACKING_PRESETS.run.stationaryDistanceMeters,
  MIN_DISTANCE_RUNNING_M: TRACKING_PRESETS.run.minDistanceMeters,
  MAX_RUNNING_SPEED_MPS: TRACKING_PRESETS.run.maxSpeedMps,
  MAX_REASONABLE_SPEED_KMH: TRACKING_PRESETS.run.maxSpeedMps * 3.6,
  MAX_HUMAN_SPRINT_SPEED_KMH: TRACKING_PRESETS.run.hardMaxSpeedMps * 3.6,
  DISPLAY_PATH_MAX_POINTS: 2500,
};

export function getTrackingPreset(nameOrPreset = "run") {
  if (nameOrPreset && typeof nameOrPreset === "object") {
    return {
      ...TRACKING_PRESETS.run,
      ...nameOrPreset,
      currentPositionSmoothing: {
        ...TRACKING_PRESETS.run.currentPositionSmoothing,
        ...(nameOrPreset.currentPositionSmoothing || {}),
      },
      quality: {
        ...TRACKING_PRESETS.run.quality,
        ...(nameOrPreset.quality || {}),
      },
    };
  }

  return TRACKING_PRESETS[nameOrPreset] || TRACKING_PRESETS.run;
}

export default {
  TRACKING_DEBUG_ENABLED,
  TRACKING_CONFIG,
  TRACKING_FILTER_VERSION,
  TRACKING_PRESETS,
  TRACKING_SMOOTHING_VERSION,
  getTrackingPreset,
};
