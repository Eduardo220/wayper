import {
  buildRunReplayTimeline,
  getReplayIndexForElapsed,
  getReplayRunStats,
} from "../runReplay.js";
import { isRunOwnedByCurrentUser } from "../runOwnership.js";

describe("run replay helpers", () => {
  test("builds timeline from the original point order and timestamps", () => {
    const timeline = buildRunReplayTimeline({
      trustedPath: [
        { latitude: -23.56, longitude: -46.64, timestamp: 1000 },
        { latitude: -23.561, longitude: -46.641, timestamp: 2000 },
        { latitude: -23.562, longitude: -46.642, timestamp: 3500 },
      ],
      duration: 99,
    }).timeline;

    expect(timeline.map((point) => point.cumulativeTime)).toEqual([0, 1, 2.5]);
    expect(getReplayIndexForElapsed(timeline, 1.2)).toBe(1);
  });

  test("uses run distance and duration fallbacks when present", () => {
    const { timeline } = buildRunReplayTimeline({
      path: [
        { latitude: -23.56, longitude: -46.64 },
        { latitude: -23.561, longitude: -46.641 },
      ],
      distance: 5000,
      duration: 1800,
    });

    expect(getReplayRunStats({ distance: 5000, duration: 1800 }, timeline)).toEqual({
      distanceMeters: 5000,
      durationSeconds: 1800,
    });
  });

  test("respects saved segments without connecting pause gaps", () => {
    const replay = buildRunReplayTimeline({
      segments: [
        {
          trustedPath: [
            { latitude: -23.56, longitude: -46.64, timestamp: 1000 },
            { latitude: -23.56, longitude: -46.6401, timestamp: 2000 },
          ],
        },
        {
          trustedPath: [
            { latitude: -23.57, longitude: -46.65, timestamp: 6000 },
            { latitude: -23.5701, longitude: -46.65, timestamp: 7000 },
          ],
        },
      ],
    });

    expect(replay.segments).toHaveLength(2);
    expect(replay.timeline[2].segmentId).toBe(1);
    expect(replay.timeline[2].cumulativeMeters).toBeCloseTo(replay.timeline[1].cumulativeMeters, 5);
    expect(replay.totalMeters).toBeLessThan(40);
  });

  test("requires ownership when an owner id exists but allows legacy local runs", () => {
    expect(isRunOwnedByCurrentUser({ userId: "me" }, "me")).toBe(true);
    expect(isRunOwnedByCurrentUser({ ownerId: "other" }, "me")).toBe(false);
    expect(isRunOwnedByCurrentUser({ name: "local" }, "me")).toBe(true);
    expect(isRunOwnedByCurrentUser({ name: "local" }, "me", { allowLegacyLocal: false })).toBe(false);
  });
});
