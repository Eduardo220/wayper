import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  GPS_DEBUG_SHADOW_MODE,
  __resetGpsShadowForTests,
  __setGpsDebugShadowModeForTests,
  evaluateGpsShadowPoint,
  isGpsDebugShadowEnabled,
} from "../gpsDebugShadowService.js";

function point(index = 0, extra = {}) {
  return {
    latitude: -30,
    longitude: -51 + index * 0.00006,
    accuracy: 8,
    timestamp: 1_000 + index * 3_000,
    ...extra,
  };
}

describe("gpsDebugShadowService mode", () => {
  beforeEach(() => {
    __resetGpsShadowForTests();
  });

  test("fica desabilitado por padrao fora de __DEV__", () => {
    expect(GPS_DEBUG_SHADOW_MODE).toBe(false);
    expect(isGpsDebugShadowEnabled()).toBe(false);
    expect(evaluateGpsShadowPoint(point(), { runId: "prod-run" })).toEqual({
      enabled: false,
      acceptedByRelaxedFilter: null,
      relaxedRejectReason: null,
    });
  });

  test("override explicito habilita o diagnostico relaxado em teste", () => {
    expect(__setGpsDebugShadowModeForTests(true)).toBe(true);

    const first = evaluateGpsShadowPoint(point(), {
      runId: "test-run",
      startedAt: 1_000,
      nowMs: 1_000,
    });
    const moderateAccuracy = evaluateGpsShadowPoint(point(1, { accuracy: 55 }), {
      runId: "test-run",
      startedAt: 1_000,
      nowMs: 4_000,
    });

    expect(first).toMatchObject({
      enabled: true,
      acceptedByRelaxedFilter: true,
      relaxedAcceptedPoints: 1,
    });
    expect(moderateAccuracy).toMatchObject({
      enabled: true,
      acceptedByRelaxedFilter: true,
      relaxedAcceptedPoints: 2,
    });
  });

  test("reset remove estado e override de teste", () => {
    __setGpsDebugShadowModeForTests(true);
    evaluateGpsShadowPoint(point(), {
      runId: "reset-run",
      startedAt: 1_000,
      nowMs: 1_000,
    });

    __resetGpsShadowForTests();

    expect(isGpsDebugShadowEnabled()).toBe(false);
    expect(evaluateGpsShadowPoint(point(1), { runId: "reset-run" }).enabled).toBe(false);
  });
});
