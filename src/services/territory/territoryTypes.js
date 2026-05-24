export const TERRITORY_STATUS = {
  active: "active",
  conquered: "conquered",
  split: "split",
  deleted: "deleted",
};

export const TERRITORY_SOURCE = {
  closed_loop: "closed_loop",
  zone_run: "zoneRun",
  path_buffer: "path_buffer",
};

export const TERRITORY_CAPTURE_FAILURE = {
  free_run: "free_run",
  not_closed_loop: "not_closed_loop",
  invalid_geometry: "invalid_geometry",
  area_too_small: "area_too_small",
  area_too_large: "area_too_large",
  bad_gps: "bad_gps",
  bad_accuracy: "bad_accuracy",
  duration_too_short: "duration_too_short",
  distance_too_short: "distance_too_short",
  gps_jump: "gps_jump",
  impossible_speed: "impossible_speed",
  not_enough_points: "not_enough_points",
  suspicious_activity: "suspicious_activity",
  turf_error: "turf_error",
};

export const TERRITORY_EVENT_TYPE = {
  capture: "capture",
  steal: "steal",
  merge: "merge",
  split: "split",
  conquered: "conquered",
  leader_changed: "leader_changed",
  lost_lead: "lost_lead",
  regained_lead: "regained_lead",
};
