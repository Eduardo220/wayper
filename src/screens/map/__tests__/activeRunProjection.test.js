import { describe, expect, test } from "@jest/globals";
import { ACTIVE_RUN_STATUS, TRACKING_CONFIG } from "../../../services/runTracking";
import { projectActiveRunSnapshot } from "../activeRunProjection.js";

const point = (latitude, timestamp) => ({ latitude, longitude: -51, timestamp });

describe("activeRunProjection", () => {
  test("snapshot atrasado nao regride path, distancia nem duracao da mesma corrida", () => {
    const previousPath = [point(-30, 1000), point(-30.001, 2000), point(-30.002, 3000)];
    const result = projectActiveRunSnapshot({
      activeRunId: "run-1",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: 1000,
      durationMs: 1000,
      distanceMeters: 50,
      trustedPath: previousPath.slice(0, 2),
    }, {
      activeRunId: "run-1",
      trustedPath: previousPath,
      livePath: previousPath,
      distanceMeters: 100,
      durationSeconds: 10,
    }, { nowMs: 2000 });

    expect(result).toMatchObject({
      stalePathBlocked: true,
      distanceRegressionBlocked: true,
      elapsedRegressionBlocked: true,
      distanceMeters: 100,
      durationSeconds: 10,
    });
    expect(result.trustedPath).toHaveLength(3);
  });

  test("nova corrida nao herda projecao anterior", () => {
    const result = projectActiveRunSnapshot({
      activeRunId: "run-2",
      status: ACTIVE_RUN_STATUS.PAUSED,
      trustedPath: [point(-31, 1000)],
      distanceMeters: 5,
    }, {
      activeRunId: "run-1",
      trustedPath: [point(-30, 1000), point(-30.1, 2000)],
      distanceMeters: 100,
    }, { nowMs: 2000 });

    expect(result.sameRun).toBe(false);
    expect(result.paused).toBe(true);
    expect(result.trustedPath).toHaveLength(1);
    expect(result.distanceMeters).toBe(5);
  });

  test("rota longa preserva trusted path e limita apenas a projecao visual", () => {
    const trustedPath = Array.from({ length: 12_000 }, (_, index) => ({
      latitude: -30 + index * 0.000001,
      longitude: -51,
      timestamp: 1_000 + index * 1_000,
    }));
    const result = projectActiveRunSnapshot({
      activeRunId: "long-run",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: 1_000,
      trustedPath,
    }, {}, { nowMs: 12_001_000 });

    expect(result.trustedPath).toHaveLength(trustedPath.length);
    expect(result.livePath.length).toBeLessThanOrEqual(TRACKING_CONFIG.DISPLAY_PATH_MAX_POINTS);
    expect(result.livePath.at(-1)).toMatchObject(trustedPath.at(-1));
  });
});
