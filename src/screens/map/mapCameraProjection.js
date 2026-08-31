export const MAP_CAMERA_CONFIG = Object.freeze({
  followZoom: 17.2,
  followAnimationMs: 450,
  replayZoom: 18.1,
  replayAnimationMs: 240,
  replayMoveIntervalMs: 180,
  recenterAnimationMs: 700,
  cameraMoveIntervalMs: 900,
});

export function projectMapCamera({
  location,
  fallbackLocation,
  replayPath,
  replaying,
  running,
  paused,
  mapFollowEnabled,
  mapFocusCenter,
}) {
  const safeLocation = location || fallbackLocation;
  const replayCenter = replaying && Array.isArray(replayPath) && replayPath.length
    ? replayPath[replayPath.length - 1]
    : null;
  return {
    location: replayCenter || safeLocation,
    centerCoordinate: replayCenter || mapFocusCenter || safeLocation,
    autoCenterOnCoordinate: !running && !replaying,
    followUserLocation: replaying || Boolean(running && !paused && mapFollowEnabled),
    showRecenter: Boolean(running && !paused && !replaying && !mapFollowEnabled),
    initialZoom: replaying ? MAP_CAMERA_CONFIG.replayZoom : 15,
    followZoomLevel: replaying ? MAP_CAMERA_CONFIG.replayZoom : MAP_CAMERA_CONFIG.followZoom,
    followAnimationDuration: replaying
      ? MAP_CAMERA_CONFIG.replayAnimationMs
      : MAP_CAMERA_CONFIG.followAnimationMs,
    minCameraMoveIntervalMs: replaying
      ? MAP_CAMERA_CONFIG.replayMoveIntervalMs
      : MAP_CAMERA_CONFIG.cameraMoveIntervalMs,
  };
}

export default projectMapCamera;
