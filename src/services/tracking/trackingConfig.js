export const TRACKING_SMOOTHING_VERSION = "wayper_tracking_v1";

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

    zigzagAngleDegrees: 115,
    zigzagMaxSegmentMeters: 18,
    zigzagMinAccuracyPenaltyMeters: 18,

    liveSimplifyToleranceMeters: 2.5,
    summarySimplifyToleranceMeters: 5.5,

    liveSmoothingStrength: 0.28,
    summarySmoothingStrength: 0.42,

    maxVisualCornerCutMeters: 8,

    minPointsForSmoothing: 4,
    minPointsForSpline: 6,

    currentPositionSmoothing: {
      minAlpha: 0.18,
      maxAlpha: 0.55,
      accuracyWeight: true,
      speedWeight: true,
    },

    quality: {
      excellentAccuracyMeters: 10,
      goodAccuracyMeters: 20,
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
    zigzagAngleDegrees: 118,
    zigzagMaxSegmentMeters: 14,
    zigzagMinAccuracyPenaltyMeters: 18,
    liveSimplifyToleranceMeters: 2,
    summarySimplifyToleranceMeters: 4.5,
    liveSmoothingStrength: 0.32,
    summarySmoothingStrength: 0.46,
    maxVisualCornerCutMeters: 7,
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
    zigzagAngleDegrees: 120,
    zigzagMaxSegmentMeters: 24,
    zigzagMinAccuracyPenaltyMeters: 18,
    liveSimplifyToleranceMeters: 3.2,
    summarySimplifyToleranceMeters: 6.5,
    liveSmoothingStrength: 0.22,
    summarySmoothingStrength: 0.36,
    maxVisualCornerCutMeters: 10,
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
  TRACKING_PRESETS,
  TRACKING_SMOOTHING_VERSION,
  getTrackingPreset,
};
