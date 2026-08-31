import { projectMapCamera } from "../mapCameraProjection.js";

const user = { latitude: -23.5, longitude: -46.6 };
const fallback = { latitude: -23.6, longitude: -46.7 };

describe("map camera projection", () => {
  test("live run follows user until manual interaction", () => {
    expect(projectMapCamera({ location: user, fallbackLocation: fallback, running: true,
      paused: false, replaying: false, mapFollowEnabled: true }).followUserLocation).toBe(true);
    const free = projectMapCamera({ location: user, fallbackLocation: fallback, running: true,
      paused: false, replaying: false, mapFollowEnabled: false });
    expect(free.followUserLocation).toBe(false);
    expect(free.showRecenter).toBe(true);
  });

  test("replay follows its last point", () => {
    const replayPoint = { latitude: -22, longitude: -45 };
    const camera = projectMapCamera({ location: user, fallbackLocation: fallback, running: false,
      paused: false, replaying: true, replayPath: [user, replayPoint] });
    expect(camera.location).toEqual(replayPoint);
    expect(camera.centerCoordinate).toEqual(replayPoint);
    expect(camera.followUserLocation).toBe(true);
  });

  test("idle territory focus wins without changing fallback", () => {
    const territory = { latitude: -21, longitude: -44 };
    const camera = projectMapCamera({ location: null, fallbackLocation: fallback, running: false,
      paused: false, replaying: false, mapFocusCenter: territory });
    expect(camera.location).toEqual(fallback);
    expect(camera.centerCoordinate).toEqual(territory);
    expect(camera.autoCenterOnCoordinate).toBe(true);
  });
});
