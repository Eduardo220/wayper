import { describe, expect, test } from "@jest/globals";
import * as turf from "@turf/turf";
import {
  buildCaptureGeometryFromPath,
  calculateGeometryAreaM2,
  calculateGeometryBbox,
  calculateGeometryCenter,
  differenceGeometries,
  geometryToPreviewCoords,
  intersectGeometries,
  isClosedLoop,
  isGeometryRenderable,
  routeToZoneGeometry,
  sanitizePathForTerritory,
  unionGeometries,
} from "../territoryGeometryService.js";
import {
  TERRITORY_CAPTURE_FAILURE,
  TERRITORY_SOURCE,
} from "../territoryTypes.js";

const baseLoop = [
  { latitude: -30.0000, longitude: -51.0000, timestamp: 1, accuracy: 8, speed: 3 },
  { latitude: -30.0000, longitude: -50.9990, timestamp: 2, accuracy: 8, speed: 3 },
  { latitude: -29.9995, longitude: -50.9988, timestamp: 3, accuracy: 8, speed: 3 },
  { latitude: -29.9990, longitude: -50.9990, timestamp: 4, accuracy: 8, speed: 3 },
  { latitude: -29.9988, longitude: -51.0000, timestamp: 5, accuracy: 8, speed: 3 },
  { latitude: -29.9990, longitude: -51.0010, timestamp: 6, accuracy: 8, speed: 3 },
  { latitude: -29.9995, longitude: -51.0012, timestamp: 7, accuracy: 8, speed: 3 },
  { latitude: -30.0001, longitude: -51.0001, timestamp: 8, accuracy: 8, speed: 3 },
];

const openPath = [
  { latitude: -30.0000, longitude: -51.0000 },
  { latitude: -30.0001, longitude: -50.9997 },
  { latitude: -30.0002, longitude: -50.9994 },
  { latitude: -30.0003, longitude: -50.9991 },
  { latitude: -30.0004, longitude: -50.9988 },
  { latitude: -30.0005, longitude: -50.9985 },
  { latitude: -30.0006, longitude: -50.9982 },
  { latitude: -30.0007, longitude: -50.9979 },
];

const smallLoop = [
  { latitude: -30.000000, longitude: -51.000000 },
  { latitude: -30.000000, longitude: -50.999990 },
  { latitude: -29.999995, longitude: -50.999988 },
  { latitude: -29.999990, longitude: -50.999990 },
  { latitude: -29.999988, longitude: -51.000000 },
  { latitude: -29.999990, longitude: -51.000010 },
  { latitude: -29.999995, longitude: -51.000012 },
  { latitude: -30.000001, longitude: -51.000001 },
];

const polygonA = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [0, 0.01],
      [0.01, 0.01],
      [0.01, 0],
      [0, 0],
    ],
  ],
};

const polygonB = {
  type: "Polygon",
  coordinates: [
    [
      [0.005, 0.005],
      [0.005, 0.015],
      [0.015, 0.015],
      [0.015, 0.005],
      [0.005, 0.005],
    ],
  ],
};

const multiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    polygonA.coordinates,
    [
      [
        [0.02, 0.02],
        [0.02, 0.03],
        [0.03, 0.03],
        [0.03, 0.02],
        [0.02, 0.02],
      ],
    ],
  ],
};

const ORIGIN = { latitude: -30, longitude: -51 };
const metersToLat = (northM) => northM / 111111;
const metersToLng = (eastM, latitude = ORIGIN.latitude) => eastM / (111111 * Math.cos((latitude * Math.PI) / 180));
const p = (eastM, northM, extra = {}) => ({
  latitude: ORIGIN.latitude + metersToLat(northM),
  longitude: ORIGIN.longitude + metersToLng(eastM),
  accuracy: 8,
  speed: 3,
  ...extra,
});
const withTime = (points) => points.map((point, index) => ({ ...point, timestamp: index * 10000 + 1 }));
const rectangle = () => withTime([p(0, 0), p(120, 0), p(120, 80), p(0, 80), p(0, 0)]);
const irregular = () => withTime([p(0, 0), p(45, -14), p(118, 8), p(140, 58), p(92, 102), p(18, 86), p(-20, 34), p(0, 0)]);
const concave = () => withTime([p(0, 0), p(140, 0), p(140, 100), p(92, 100), p(92, 36), p(48, 36), p(48, 100), p(0, 100), p(0, 0)]);
const imageLikeOne = () => withTime([p(0, 0), p(70, -20), p(160, 8), p(185, 70), p(142, 140), p(55, 160), p(-35, 110), p(-58, 38), p(0, 0)]);
const imageLikeTwo = () => withTime([p(0, 0), p(50, -24), p(92, 8), p(145, -12), p(178, 42), p(132, 75), p(166, 132), p(82, 156), p(44, 104), p(-18, 134), p(-48, 54), p(0, 0)]);
const almostClosed = () => withTime([p(0, 0), p(120, 0), p(120, 80), p(0, 80), p(18, 10)]);
const openRoute = () => withTime([p(0, 0), p(55, 8), p(100, 18), p(150, 26), p(210, 35), p(260, 50), p(320, 70), p(380, 85)]);
const selfIntersecting = () => withTime([p(0, 0), p(130, 110), p(0, 110), p(130, 0), p(0, 0)]);

describe("territoryGeometryService", () => {
  test("sanitizePathForTerritory remove pontos invalidos", () => {
    const result = sanitizePathForTerritory([
      null,
      { latitude: -30, longitude: -51, timestamp: 123, accuracy: 10, speed: 2 },
      { latitude: "bad", longitude: -51 },
      { latitude: 95, longitude: -51 },
      { latitude: -30.001, longitude: -51.001, accuracy: 60 },
      { latitude: -30.002, longitude: -51.002, speed: 12 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      latitude: -30,
      longitude: -51,
      timestamp: 123,
      accuracy: 10,
      speed: 2,
    });
  });

  test("sanitizePathForTerritory preserva pontos validos", () => {
    const result = sanitizePathForTerritory([
      { lat: -30.001, lng: -51.001, timestamp: 10, accuracy: 12, speed: 4 },
      { latitude: -30.0015, longitude: -51.0015, timestamp: 20 },
    ]);

    expect(result).toEqual([
      {
        latitude: -30.001,
        longitude: -51.001,
        timestamp: 10,
        accuracy: 12,
        speed: 4,
      },
      {
        latitude: -30.0015,
        longitude: -51.0015,
        timestamp: 20,
        accuracy: undefined,
        speed: undefined,
      },
    ]);
  });

  test("sanitizePathForTerritory remove duplicados", () => {
    const result = sanitizePathForTerritory([
      { latitude: -30, longitude: -51 },
      { latitude: -30, longitude: -51 },
      { latitude: -30.0002, longitude: -51.0002 },
    ]);

    expect(result).toHaveLength(2);
  });

  test("isClosedLoop retorna true para loop fechado", () => {
    const result = isClosedLoop(baseLoop);

    expect(result.closed).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.distanceToStartM).toBeGreaterThanOrEqual(0);
  });

  test("isClosedLoop retorna false para rota aberta", () => {
    const result = isClosedLoop(openPath);

    expect(result.closed).toBe(false);
    expect(result.reason).toBe(TERRITORY_CAPTURE_FAILURE.not_closed_loop);
  });

  test("buildCaptureGeometryFromPath cria Polygon valido", () => {
    const result = buildCaptureGeometryFromPath(baseLoop);

    expect(result.ok).toBe(true);
    expect(result.geometry.type).toBe("Polygon");
    expect(result.areaM2).toBeGreaterThan(50);
    expect(result.source).toBe(TERRITORY_SOURCE.closed_loop);
    expect(result.sanitizedPath).toHaveLength(baseLoop.length);
  });

  test("routeToZoneGeometry cria retangulo fechado valido", () => {
    const result = routeToZoneGeometry(rectangle(), { minLoopPoints: 4, minDistanceM: 40 });

    expect(result.status).toBe("completed");
    expect(result.geometry.type).toBe("Polygon");
    expect(result.routeGeometry.type).toBe("LineString");
    expect(result.areaM2).toBeGreaterThan(9000);
    expect(result.bbox).toHaveLength(4);
  });

  test("routeToZoneGeometry preserva formato irregular fechado", () => {
    const result = routeToZoneGeometry(irregular(), { minLoopPoints: 4, minDistanceM: 40 });

    expect(result.ok).toBe(true);
    expect(result.geometry.type).toBe("Polygon");
    expect(result.areaM2).toBeGreaterThan(10000);
    expect(result.coordsPreview.length).toBeGreaterThanOrEqual(6);
  });

  test("routeToZoneGeometry preserva concavidade sem virar convex hull", () => {
    const result = routeToZoneGeometry(concave(), { minLoopPoints: 4, minDistanceM: 40 });
    const notchPoint = turf.point([p(70, 70).longitude, p(70, 70).latitude]);

    expect(result.ok).toBe(true);
    expect(turf.booleanPointInPolygon(notchPoint, { type: "Feature", properties: {}, geometry: result.geometry })).toBe(false);
  });

  test("routeToZoneGeometry aceita rota ampla semelhante a imagem 1", () => {
    const result = routeToZoneGeometry(imageLikeOne(), { minLoopPoints: 4, minDistanceM: 40 });

    expect(result.ok).toBe(true);
    expect(result.areaM2).toBeGreaterThan(20000);
    expect(result.meta.closureDetected).toBe(true);
  });

  test("routeToZoneGeometry aceita rota quebrada semelhante a imagem 2", () => {
    const result = routeToZoneGeometry(imageLikeTwo(), { minLoopPoints: 4, minDistanceM: 40 });

    expect(result.ok).toBe(true);
    expect(result.areaM2).toBeGreaterThan(18000);
    expect(result.coordsPreview.length).toBeGreaterThanOrEqual(8);
  });

  test("routeToZoneGeometry rejeita rota aberta sem area fechada", () => {
    const result = routeToZoneGeometry(openRoute(), { minLoopPoints: 4, minDistanceM: 40 });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("partial");
    expect(result.reason).toBe(TERRITORY_CAPTURE_FAILURE.not_closed_loop);
  });

  test("routeToZoneGeometry fecha rota quase fechada por tolerancia", () => {
    const result = routeToZoneGeometry(almostClosed(), { minLoopPoints: 4, minDistanceM: 40 });

    expect(result.ok).toBe(true);
    expect(result.meta.distanceToStartM).toBeLessThanOrEqual(48);
  });

  test("routeToZoneGeometry suporta self-intersection com MultiPolygon quando necessario", () => {
    const result = routeToZoneGeometry(selfIntersecting(), { minLoopPoints: 4, minDistanceM: 40 });

    expect(result.ok).toBe(true);
    expect(result.geometry.type).toMatch(/Polygon/);
    expect(result.areaM2).toBeGreaterThan(0);
    expect(result.meta.candidateCount).toBeGreaterThanOrEqual(1);
  });

  test("routeToZoneGeometry limpa duplicados e salto de GPS", () => {
    const path = rectangle();
    const noisy = [path[0], path[0], p(2000, 2000), ...path.slice(1)];
    const result = routeToZoneGeometry(noisy, { minLoopPoints: 4, minDistanceM: 40, maxJumpM: 400 });

    expect(result.ok).toBe(true);
    expect(result.meta.quality.pointsDiscarded).toBeGreaterThanOrEqual(2);
  });

  test("routeToZoneGeometry preserva pausas como MultiLineString", () => {
    const first = rectangle().map((point) => ({ ...point, segmentId: 0 }));
    const second = rectangle().map((point) => ({
      ...point,
      latitude: point.latitude + metersToLat(220),
      segmentId: 1,
    }));
    const result = routeToZoneGeometry([...first, ...second], { minLoopPoints: 4, minDistanceM: 40 });

    expect(result.ok).toBe(true);
    expect(result.routeGeometry.type).toBe("MultiLineString");
    expect(result.geometry.type).toBe("MultiPolygon");
  });

  test("buildCaptureGeometryFromPath rejeita poucos pontos", () => {
    const result = buildCaptureGeometryFromPath(baseLoop.slice(0, 3));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe(TERRITORY_CAPTURE_FAILURE.not_enough_points);
  });

  test("buildCaptureGeometryFromPath rejeita loop aberto", () => {
    const result = buildCaptureGeometryFromPath(openPath);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe(TERRITORY_CAPTURE_FAILURE.not_closed_loop);
  });

  test("buildCaptureGeometryFromPath rejeita area pequena", () => {
    const result = buildCaptureGeometryFromPath(smallLoop);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe(TERRITORY_CAPTURE_FAILURE.area_too_small);
  });

  test("calculateGeometryAreaM2 retorna area positiva", () => {
    expect(calculateGeometryAreaM2(polygonA)).toBeGreaterThan(0);
  });

  test("calculateGeometryBbox retorna bbox valido", () => {
    const bbox = calculateGeometryBbox(polygonA);

    expect(bbox).toHaveLength(4);
    expect(bbox[0]).toBeLessThan(bbox[2]);
    expect(bbox[1]).toBeLessThan(bbox[3]);
  });

  test("calculateGeometryCenter retorna latitude/longitude", () => {
    const center = calculateGeometryCenter(polygonA);

    expect(center).toEqual({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    });
  });

  test("intersectGeometries detecta intersecao parcial", () => {
    const result = intersectGeometries(polygonA, polygonB);

    expect(result.ok).toBe(true);
    expect(result.geometry.type).toBe("Polygon");
    expect(result.areaM2).toBeGreaterThan(0);
    expect(result.areaM2).toBeLessThan(calculateGeometryAreaM2(polygonA));
  });

  test("differenceGeometries retorna restante", () => {
    const result = differenceGeometries(polygonA, polygonB);

    expect(result.ok).toBe(true);
    expect(result.geometry.type).toMatch(/Polygon/);
    expect(result.areaM2).toBeGreaterThan(0);
    expect(result.areaM2).toBeLessThan(calculateGeometryAreaM2(polygonA));
  });

  test("unionGeometries une geometrias", () => {
    const result = unionGeometries([polygonA, polygonB]);

    expect(result.ok).toBe(true);
    expect(result.geometry.type).toMatch(/Polygon/);
    expect(result.areaM2).toBeGreaterThan(calculateGeometryAreaM2(polygonA));
  });

  test("geometryToPreviewCoords retorna array renderizavel", () => {
    const preview = geometryToPreviewCoords(polygonA, 3);

    expect(preview).toHaveLength(3);
    expect(preview[0]).toEqual({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    });
  });

  test("isGeometryRenderable aceita Polygon", () => {
    expect(isGeometryRenderable(polygonA)).toBe(true);
  });

  test("isGeometryRenderable aceita MultiPolygon", () => {
    expect(isGeometryRenderable(multiPolygon)).toBe(true);
  });

  test("operacoes Turf nao lancam erro em input invalido", () => {
    expect(() => intersectGeometries(null, polygonA)).not.toThrow();
    expect(() => differenceGeometries(polygonA, { type: "Point", coordinates: [0, 0] })).not.toThrow();
    expect(() => unionGeometries([null, { type: "LineString", coordinates: [] }])).not.toThrow();

    expect(intersectGeometries(null, polygonA).ok).toBe(false);
    expect(differenceGeometries(polygonA, { type: "Point", coordinates: [0, 0] }).ok).toBe(false);
    expect(unionGeometries([null, { type: "LineString", coordinates: [] }]).ok).toBe(false);
  });
});

