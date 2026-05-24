export const TRACKING_POINT_SOURCE = {
  expoLocation: "expo-location",
  fallback: "fallback",
  unknown: "unknown",
};

export const TRACKING_REJECT_REASON = {
  invalid_coordinate: "invalid_coordinate",
  bad_accuracy: "bad_accuracy",
  duplicate_point: "duplicate_point",
  too_close: "too_close",
  too_fast: "too_fast",
  too_much_acceleration: "too_much_acceleration",
  short_zigzag: "short_zigzag",
  gps_jump: "gps_jump",
  gps_gap: "gps_gap",
  mocked: "mocked",
  out_of_order: "out_of_order",
  warmup_bad_point: "warmup_bad_point",
  unknown: "unknown",
};

export const TRACKING_FILTER_ACTION = {
  accept: "accept",
  reject: "reject",
  replace_previous: "replace_previous",
  ignore: "ignore",
  pending: "pending",
  segment_break: "segment_break",
};

export default {
  TRACKING_FILTER_ACTION,
  TRACKING_POINT_SOURCE,
  TRACKING_REJECT_REASON,
};
