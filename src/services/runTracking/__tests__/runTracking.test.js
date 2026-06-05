import { describe, expect, test } from "@jest/globals";
import {
  buildSummaryRenderPath,
  buildRunLineGeoJson,
  calculateDistanceMeters,
  calculatePathDistanceMeters,
  calculateTurnAngle,
  createDisplayPoints,
  createTrackingSession,
  getDisplaySegmentsForRun,
  simplifyPathByDistance,
  shouldAcceptPoint,
} from "../index.js";
import {
  applyPolygonSmoothWithFallback,
  routeToZoneGeometry,
} from "../../territory/territoryGeometryService.js";
import {
  BASE_TIME,
  impossibleJump,
  irregularClosedZone,
  irregularDrawingLikeRoute,
  p,
  pauseAndResumeFarAway,
  rightAngleCorner,
  smoothCurve,
  straightWithLateralNoise,
} from "../__fixtures__/manualTracks.js";

function process(points) {
  const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
  points.forEach((point) => session.processLocationPoint(point));
  return session.finishTrackingSession({ durationMs: points.length * 3000 });
}

function maxTurn(points = []) {
  let value = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    value = Math.max(value, calculateTurnAngle(points[index - 1], points[index], points[index + 1]));
  }
  return value;
}

describe("runTracking central pipeline", () => {
  test("aceita pontos bons em linha reta", () => {
    const previous = p(0, 0, 0);
    const candidate = p(1, 0, 8);
    const result = shouldAcceptPoint(previous, candidate, { filteredPoints: [previous], preset: "run" });
    expect(result.accepted).toBe(true);
  });

  test("remove ponto com salto impossivel", () => {
    const finish = process(impossibleJump());
    expect(finish.filteredPoints.length).toBeLessThan(finish.rawPoints.length);
    expect(finish.pathQuality.rejectedBySpeed).toBeGreaterThan(0);
  });

  test("remove jitter lateral parado ou quase parado", () => {
    const finish = process([
      p(0, 0, 0),
      p(1, 0.2, 0.4),
      p(2, -0.3, -0.2),
      p(3, 0.4, 0.1),
    ]);
    expect(finish.filteredPoints).toHaveLength(1);
    expect(finish.distanceMeters).toBeLessThan(1);
  });

  test("mantem curva real", () => {
    const finish = process(smoothCurve());
    expect(finish.filteredPoints.length).toBeGreaterThanOrEqual(7);
    expect(calculatePathDistanceMeters(finish.filteredPoints)).toBeGreaterThan(45);
  });

  test("mantem esquina real", () => {
    const finish = process(rightAngleCorner());
    const display = buildSummaryRenderPath(finish.filteredPoints);
    const corner = rightAngleCorner()[2];
    const nearestCornerDistance = Math.min(...display.map((point) => calculateDistanceMeters(point, corner)));
    expect(nearestCornerDistance).toBeLessThan(5);
    expect(maxTurn(display)).toBeGreaterThan(55);
  });

  test("nao conecta segmentos apos pausa", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    const { first, second } = pauseAndResumeFarAway();
    first.forEach((point) => session.processLocationPoint(point));
    session.pause({ endedAt: BASE_TIME + 8000 });
    session.resume({ startedAt: BASE_TIME + 12000 });
    second.forEach((point) => session.processLocationPoint(point));
    const finish = session.finishTrackingSession({ durationMs: 42000 });
    const segments = getDisplaySegmentsForRun(finish, "result");
    expect(segments).toHaveLength(2);
  });

  test("GeoJSON de rota usa MultiLineString para segmentos separados", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    const { first, second } = pauseAndResumeFarAway();
    first.forEach((point) => session.processLocationPoint(point));
    session.pause({ endedAt: BASE_TIME + 8000 });
    session.resume({ startedAt: BASE_TIME + 12000 });
    second.forEach((point) => session.processLocationPoint(point));

    const finish = session.finishTrackingSession({ durationMs: 42000 });
    const geojson = buildRunLineGeoJson(finish.routeSegments, "result");

    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0].geometry.type).toBe("MultiLineString");
    expect(geojson.features[0].geometry.coordinates).toHaveLength(2);
  });

  test("nao conecta segmentos apos gap de GPS", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    const { first, second } = pauseAndResumeFarAway();
    [...first, ...second].forEach((point) => session.processLocationPoint(point));
    const finish = session.finishTrackingSession({ durationMs: 42000 });
    const segments = getDisplaySegmentsForRun(finish, "result");
    expect(segments).toHaveLength(2);
    expect(finish.gpsQualitySummary.gpsGapCount).toBeGreaterThan(0);
  });

  test("simplifica reta sem destruir distancia", () => {
    const raw = straightWithLateralNoise(22);
    const simplified = simplifyPathByDistance(raw, 2.5);
    const rawDistance = calculatePathDistanceMeters(raw);
    const simplifiedDistance = calculatePathDistanceMeters(simplified);
    expect(simplified.length).toBeLessThan(raw.length);
    expect(simplifiedDistance).toBeGreaterThan(rawDistance * 0.86);
    expect(simplifiedDistance).toBeLessThan(rawDistance * 1.08);
  });

  test("suaviza display sem alterar filteredPoints", () => {
    const filtered = straightWithLateralNoise(16);
    const before = JSON.stringify(filtered);
    const display = createDisplayPoints(filtered, { mode: "result" });
    expect(JSON.stringify(filtered)).toBe(before);
    expect(display).not.toBe(filtered);
    expect(display.length).toBeGreaterThan(1);
  });

  test("zona fechada mantem formato real", () => {
    const result = routeToZoneGeometry(irregularClosedZone(), {
      minLoopPoints: 6,
      minDistanceM: 40,
      minAreaM2: 20,
    });
    expect(result.ok).toBe(true);
    expect(result.coordsPreview.length).toBeGreaterThanOrEqual(6);
  });

  test("rota irregular de zona nao vira forma perfeita", () => {
    const result = routeToZoneGeometry(irregularDrawingLikeRoute(), {
      minLoopPoints: 6,
      minDistanceM: 40,
      minAreaM2: 20,
    });
    expect(result.ok).toBe(true);
    expect(result.coordsPreview.length).toBeGreaterThanOrEqual(7);
  });

  test("polygonSmooth invalido cai em fallback", () => {
    const original = routeToZoneGeometry(irregularClosedZone(), {
      minLoopPoints: 6,
      minDistanceM: 40,
      minAreaM2: 20,
    });
    const smoothed = applyPolygonSmoothWithFallback(original.geometry, {
      polygonSmoothIterations: 1,
      smoothFn: () => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } }),
    });
    expect(smoothed).toEqual(original.geometry);
  });
});
