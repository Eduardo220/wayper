import {
  TRACKING_FILTER_ACTION,
  TRACKING_POINT_SOURCE,
  TRACKING_REJECT_REASON,
} from "../tracking/trackingTypes.js";
import {
  TRACKING_FILTER_VERSION,
  TRACKING_SMOOTHING_VERSION,
} from "../tracking/trackingConfig.js";

export const RUN_TRACKING_FILTER_VERSION = TRACKING_FILTER_VERSION || "wayper_gps_filter_v2";
export const RUN_TRACKING_SMOOTHING_VERSION = TRACKING_SMOOTHING_VERSION || "wayper_tracking_v2";

export const TRACK_POINT_SOURCE = TRACKING_POINT_SOURCE;
export const TRACK_FILTER_ACTION = {
  ...TRACKING_FILTER_ACTION,
  segment_break: "segment_break",
};
export const TRACK_REJECT_REASON = {
  ...TRACKING_REJECT_REASON,
  mocked: "mocked",
  out_of_order: "out_of_order",
  gps_gap: "gps_gap",
};

export const TRACK_SEGMENT_REASON = {
  active: "active",
  pause: "pause",
  gps_gap: "gps_gap",
  resume: "resume",
};

export const RUN_LINE_MODE = {
  live: "live",
  result: "result",
  history: "history",
  share: "share",
  zone: "zone",
};

export const GPS_QUALITY_LEVEL = {
  excellent: "excellent",
  good: "good",
  acceptable: "acceptable",
  poor: "poor",
  bad: "bad",
  unknown: "unknown",
};

export default {
  GPS_QUALITY_LEVEL,
  RUN_LINE_MODE,
  RUN_TRACKING_FILTER_VERSION,
  RUN_TRACKING_SMOOTHING_VERSION,
  TRACK_FILTER_ACTION,
  TRACK_POINT_SOURCE,
  TRACK_REJECT_REASON,
  TRACK_SEGMENT_REASON,
};
