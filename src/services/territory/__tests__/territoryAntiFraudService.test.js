import { describe, expect, test } from "@jest/globals";
import { validateRunForTerritoryCapture } from "../territoryAntiFraudService.js";

function pathFromBbox([minLng, minLat, maxLng, maxLat], overrides = {}) {
  const points = [
    { latitude: minLat, longitude: minLng },
    { latitude: minLat, longitude: maxLng },
    { latitude: maxLat, longitude: maxLng },
    { latitude: maxLat, longitude: minLng },
    { latitude: minLat, longitude: minLng },
  ];

  return points.map((point, index) => ({
    ...point,
    accuracy: 5,
    speed: 3,
    timestamp: 1_700_000_000_000 + index * 30_000,
    ...overrides,
  }));
}

describe("territoryAntiFraudService", () => {
  test("aceita corrida territorial plausivel", () => {
    const result = validateRunForTerritoryCapture(pathFromBbox([0, 0, 0.002, 0.002]), {
      distanceMeters: 900,
      durationSeconds: 180,
      minPoints: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.suspiciousScore).toBeLessThan(65);
  });

  test("rejeita poucos pontos", () => {
    const result = validateRunForTerritoryCapture([{ latitude: 0, longitude: 0 }], {
      distanceMeters: 900,
      durationSeconds: 180,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_enough_points");
  });

  test("rejeita duracao curta", () => {
    const result = validateRunForTerritoryCapture(pathFromBbox([0, 0, 0.002, 0.002]), {
      distanceMeters: 900,
      durationSeconds: 10,
      minPoints: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("duration_too_short");
  });

  test("rejeita distancia curta", () => {
    const result = validateRunForTerritoryCapture(pathFromBbox([0, 0, 0.002, 0.002]), {
      distanceMeters: 20,
      durationSeconds: 180,
      minPoints: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("distance_too_short");
  });

  test("rejeita baixa precisao", () => {
    const result = validateRunForTerritoryCapture(pathFromBbox([0, 0, 0.002, 0.002], { accuracy: 90 }), {
      distanceMeters: 900,
      durationSeconds: 180,
      minPoints: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_accuracy");
  });

  test("rejeita velocidade impossivel", () => {
    const result = validateRunForTerritoryCapture(pathFromBbox([0, 0, 0.002, 0.002], { speed: 28 }), {
      distanceMeters: 900,
      durationSeconds: 180,
      minPoints: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("impossible_speed");
  });

  test("rejeita salto de GPS", () => {
    const path = [
      { latitude: 0, longitude: 0, accuracy: 5, speed: 3, timestamp: 1_700_000_000_000 },
      { latitude: 0, longitude: 0.002, accuracy: 5, speed: 3, timestamp: 1_700_000_030_000 },
      { latitude: 1, longitude: 1, accuracy: 5, speed: 3, timestamp: 1_700_000_060_000 },
      { latitude: 0.002, longitude: 0.002, accuracy: 5, speed: 3, timestamp: 1_700_000_090_000 },
      { latitude: 0, longitude: 0, accuracy: 5, speed: 3, timestamp: 1_700_000_120_000 },
    ];

    const result = validateRunForTerritoryCapture(path, {
      distanceMeters: 900,
      durationSeconds: 180,
      minPoints: 4,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("gps_jump");
  });

  test("rejeita area acima do limite", () => {
    const result = validateRunForTerritoryCapture(pathFromBbox([0, 0, 0.002, 0.002]), {
      distanceMeters: 900,
      durationSeconds: 180,
      minPoints: 5,
      minLoopPoints: 5,
      maxAreaM2: 10,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("area_too_large");
  });
});
