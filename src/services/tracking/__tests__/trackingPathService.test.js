import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import {
  buildLiveRenderPath,
  buildSummaryRenderPath,
  createTrackingSession,
  getRenderablePathForRun,
  getRenderableSegmentsForRun,
  normalizeLocationPoint,
  shouldAcceptPoint,
} from "../index.js";
import {
  calculateDistanceMeters,
  calculatePathDistanceMeters,
  calculateTurnAngle,
} from "../trackingMath.js";
import { TRACKING_REJECT_REASON } from "../trackingTypes.js";

const BASE_LAT = -23.56;
const BASE_LNG = -46.64;
const BASE_TIME = 1_700_000_000_000;
const metersToLat = (meters) => meters / 111_320;
const metersToLng = (meters, latitude = BASE_LAT) => meters / (111_320 * Math.cos((latitude * Math.PI) / 180));

function p(index, north = 0, east = 0, extra = {}) {
  return {
    latitude: BASE_LAT + metersToLat(north),
    longitude: BASE_LNG + metersToLng(east),
    accuracy: 8,
    speed: null,
    heading: null,
    altitude: null,
    altitudeAccuracy: null,
    timestamp: BASE_TIME + index * 2000,
    source: "expo-location",
    ...extra,
  };
}

function makeRunPath(count = 12, noise = 0) {
  return Array.from({ length: count }, (_, index) =>
    p(index, index * 4, index * 3 + (index % 2 === 0 ? noise : -noise))
  );
}

function processPath(points) {
  const session = createTrackingSession({ mode: "run", startedAt: 0 });
  const results = points.map((point) => session.processLocationPoint(point));
  return { session, results, finish: session.finishTrackingSession({ durationMs: points.length * 2000 }) };
}

function totalTurn(pathPoints = []) {
  let total = 0;
  for (let i = 1; i < pathPoints.length - 1; i += 1) {
    total += calculateTurnAngle(pathPoints[i - 1], pathPoints[i], pathPoints[i + 1]);
  }
  return total;
}

function averageTurn(pathPoints = []) {
  return totalTurn(pathPoints) / Math.max(1, pathPoints.length - 2);
}

describe("tracking pipeline", () => {
  test("normalizeLocationPoint aceita formato Expo Location", () => {
    const normalized = normalizeLocationPoint({
      coords: {
        latitude: BASE_LAT,
        longitude: BASE_LNG,
        accuracy: 7,
        speed: 2,
        heading: 90,
        altitude: 740,
        altitudeAccuracy: 3,
      },
      timestamp: BASE_TIME,
      source: "expo-location",
    });

    expect(normalized).toMatchObject({
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      accuracy: 7,
      speed: 2,
      heading: 90,
      altitude: 740,
      altitudeAccuracy: 3,
      timestamp: BASE_TIME,
      source: "expo-location",
    });
  });

  test("normalizeLocationPoint aceita formato antigo latitude/longitude", () => {
    expect(normalizeLocationPoint({ latitude: BASE_LAT, longitude: BASE_LNG, timestamp: BASE_TIME })).toMatchObject({
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      timestamp: BASE_TIME,
    });
  });

  test("coordenada invalida e rejeitada", () => {
    expect(normalizeLocationPoint({ latitude: 999, longitude: BASE_LNG })).toBeNull();
    expect(shouldAcceptPoint({ latitude: 999, longitude: BASE_LNG }, {}, "run").reason).toBe(
      TRACKING_REJECT_REASON.invalid_coordinate
    );
  });

  test("ponto duplicado e rejeitado", () => {
    const state = { trustedPath: [p(0)], previousSpeedMps: 0 };
    const verdict = shouldAcceptPoint(p(0), state, "run");
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(TRACKING_REJECT_REASON.duplicate_point);
  });

  test("ponto com accuracy acima de hardMaxAccuracyMeters e rejeitado", () => {
    const verdict = shouldAcceptPoint(p(1, 5, 0, { accuracy: 80 }), { trustedPath: [p(0)] }, "run");
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(TRACKING_REJECT_REASON.bad_accuracy);
  });

  test("ponto muito proximo e ignorado", () => {
    const verdict = shouldAcceptPoint(p(1, 2, 0), { trustedPath: [p(0)] }, "run");
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(TRACKING_REJECT_REASON.too_close);
  });

  test("ponto rapido demais com intervalo curto e ignorado", () => {
    const fast = p(1, 0, 18, { timestamp: BASE_TIME + 300 });
    const verdict = shouldAcceptPoint(fast, { trustedPath: [p(0)], previousSpeedMps: 0 }, "run");
    expect(verdict.accepted).toBe(false);
    expect([TRACKING_REJECT_REASON.too_fast, TRACKING_REJECT_REASON.too_much_acceleration]).toContain(verdict.reason);
  });

  test("salto impossivel e rejeitado", () => {
    const jump = p(1, 0, 140, { timestamp: BASE_TIME + 1000, accuracy: 12 });
    const verdict = shouldAcceptPoint(jump, { trustedPath: [p(0)], previousSpeedMps: 0 }, "run");
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(TRACKING_REJECT_REASON.gps_jump);
  });

  test("velocidade maxima nao considera spike rejeitado", () => {
    const { finish } = processPath([p(0), p(2, 0, 6), p(3, 0, 180, { timestamp: BASE_TIME + 5000 }), p(4, 0, 12)]);
    expect(finish.maxSpeedMps).toBeLessThan(8.5);
    expect(finish.pathQuality.rejectedBySpeed).toBeGreaterThan(0);
  });

  test("zigzag curto remove ponto intermediario ruim", () => {
    const { finish } = processPath([
      p(0, 0, 0),
      p(2, 0, 8, { accuracy: 24 }),
      p(4, 0.5, 1, { accuracy: 8 }),
    ]);
    expect(finish.trustedPath).toHaveLength(2);
    expect(finish.pathQuality.rejectedByZigzag).toBeGreaterThan(0);
  });

  test("curva real nao e destruida pelo anti-zigzag", () => {
    const points = [
      p(0, 0, 0),
      p(3, 0, 20),
      p(6, 20, 20),
    ];
    const { finish } = processPath(points);
    expect(finish.trustedPath).toHaveLength(3);
    expect(finish.pathQuality.rejectedByZigzag).toBe(0);
  });

  test("trustedPath mantem formato geral do trajeto", () => {
    const points = makeRunPath(10);
    const { finish } = processPath(points);
    const trustedDistance = calculatePathDistanceMeters(finish.trustedPath);
    const expectedDistance = calculatePathDistanceMeters(points);
    expect(trustedDistance).toBeGreaterThan(expectedDistance * 0.82);
    expect(trustedDistance).toBeLessThan(expectedDistance * 1.08);
  });

  test("liveRenderPath tem menos ruido que rawPath", () => {
    const noisy = makeRunPath(18, 1.2);
    const { finish } = processPath(noisy);
    expect(finish.liveRenderPath.length).toBeLessThanOrEqual(finish.rawPath.length);
  });

  test("summaryRenderPath e mais suave que liveRenderPath", () => {
    const trusted = makeRunPath(18, 1.6);
    const live = buildLiveRenderPath(trusted);
    const summary = buildSummaryRenderPath(trusted);
    expect(averageTurn(summary)).toBeLessThanOrEqual(averageTurn(live) + 0.5);
  });

  test("renderPath mantem primeiro e ultimo ponto", () => {
    const trusted = makeRunPath(10, 0.8);
    const summary = buildSummaryRenderPath(trusted);
    expect(calculateDistanceMeters(summary[0], trusted[0])).toBeLessThan(0.01);
    expect(calculateDistanceMeters(summary[summary.length - 1], trusted[trusted.length - 1])).toBeLessThan(0.01);
  });

  test("renderPath nao gera NaN", () => {
    const summary = buildSummaryRenderPath(makeRunPath(14, 1));
    expect(summary.every((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))).toBe(true);
  });

  test("renderPath nao explode distancia total", () => {
    const trusted = makeRunPath(16, 1.4);
    const summary = buildSummaryRenderPath(trusted);
    const trustedDistance = calculatePathDistanceMeters(trusted);
    const renderDistance = calculatePathDistanceMeters(summary);
    expect(renderDistance).toBeGreaterThan(trustedDistance * 0.82);
    expect(renderDistance).toBeLessThan(trustedDistance * 1.12);
  });

  test("finishTrackingSession retorna rawPath, trustedPath, renderPath e pathQuality", () => {
    const { finish } = processPath(makeRunPath(8));
    expect(finish.rawPath.length).toBeGreaterThan(0);
    expect(finish.trustedPath.length).toBeGreaterThan(1);
    expect(finish.renderPath.length).toBeGreaterThan(1);
    expect(finish.segments).toHaveLength(1);
    expect(finish.pathQuality.smoothingVersion).toBe("wayper_tracking_v1");
  });

  test("corrida sem pausas mantem um unico segmento", () => {
    const { finish } = processPath(makeRunPath(6));
    const activeSegments = finish.segments.filter((segment) => segment.trustedPath.length > 0);
    expect(activeSegments).toHaveLength(1);
    expect(activeSegments[0].trustedPath.length).toBe(finish.trustedPath.length);
  });

  test("pausa encerra o segmento atual", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    session.processLocationPoint(p(0, 0, 0));
    session.processLocationPoint(p(2, 0, 6));
    const paused = session.pause({ endedAt: BASE_TIME + 5000 });
    expect(paused.segments[0].endedAt).toBe(BASE_TIME + 5000);
    expect(paused.isPaused).toBe(true);
  });

  test("resume cria novo segmento sem conectar com o anterior", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    session.processLocationPoint(p(0, 0, 0));
    session.processLocationPoint(p(2, 0, 6));
    session.pause({ endedAt: BASE_TIME + 5000 });
    session.resume({ startedAt: BASE_TIME + 7000 });
    session.processLocationPoint(p(4, 80, 80, { timestamp: BASE_TIME + 8000 }));
    session.processLocationPoint(p(5, 86, 80, { timestamp: BASE_TIME + 10000 }));
    const finish = session.finishTrackingSession({ durationMs: 10000 });
    const activeSegments = finish.segments.filter((segment) => segment.trustedPath.length > 0);
    expect(activeSegments).toHaveLength(2);
    expect(calculatePathDistanceMeters(finish.trustedPath)).toBeGreaterThan(finish.distanceMeters);
  });

  test("segmentos anteriores permanecem intactos apos resume", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    session.processLocationPoint(p(0, 0, 0));
    session.processLocationPoint(p(2, 0, 6));
    session.pause({ endedAt: BASE_TIME + 5000 });
    const beforeResume = session.getSegments()[0].trustedPath.map((point) => ({ ...point }));
    session.resume({ startedAt: BASE_TIME + 7000 });
    session.processLocationPoint(p(4, 80, 80, { timestamp: BASE_TIME + 8000 }));
    session.processLocationPoint(p(5, 86, 80, { timestamp: BASE_TIME + 10000 }));
    const afterResume = session.getSegments()[0].trustedPath;
    expect(afterResume).toEqual(beforeResume);
  });

  test("trustedPath cresce continuamente durante corrida ativa", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    const lengths = [p(0, 0, 0), p(2, 0, 6), p(4, 0, 12)].map(
      (point) => session.processLocationPoint(point).trustedPath.length
    );
    expect(lengths).toEqual([1, 2, 3]);
  });

  test("liveRenderPath cresce sem reiniciar automaticamente", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    const lengths = [p(0, 0, 0), p(2, 0, 6), p(4, 0, 12), p(6, 0, 18)].map(
      (point) => session.processLocationPoint(point).liveRenderPath.length
    );
    expect(lengths[0]).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < lengths.length; i += 1) {
      expect(lengths[i]).toBeGreaterThanOrEqual(lengths[i - 1]);
    }
  });

  test("getRenderableSegmentsForRun preserva segmentos salvos", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    session.processLocationPoint(p(0, 0, 0));
    session.processLocationPoint(p(2, 0, 6));
    session.pause({ endedAt: BASE_TIME + 5000 });
    session.resume({ startedAt: BASE_TIME + 7000 });
    session.processLocationPoint(p(4, 80, 80, { timestamp: BASE_TIME + 8000 }));
    session.processLocationPoint(p(5, 86, 80, { timestamp: BASE_TIME + 10000 }));
    const finish = session.finishTrackingSession({ durationMs: 10000 });
    const renderSegments = getRenderableSegmentsForRun(finish);
    expect(renderSegments).toHaveLength(2);
    expect(renderSegments.every((segment) => segment.length >= 2)).toBe(true);
  });

  test("corrida antiga so com path ainda renderiza no detalhe", () => {
    const oldRun = { path: makeRunPath(8) };
    expect(getRenderablePathForRun(oldRun).length).toBeGreaterThan(1);
  });

  test("territorio recebe trustedPath, nao renderPath", () => {
    const { finish } = processPath(makeRunPath(12, 1.1));
    const territoryInput = finish.path;
    expect(territoryInput).toEqual(finish.trustedPath);
    expect(territoryInput).not.toBe(finish.renderPath);
  });

  test("MapScreen nao renderiza rawPath como linha principal", () => {
    const mapScreen = fs.readFileSync(path.join(process.cwd(), "src/screens/MapScreen.js"), "utf8");
    expect(mapScreen).toContain("routePath={liveRoutePath}");
    expect(mapScreen).toContain("routeSegments={liveRouteSegments}");
    expect(mapScreen).toContain("const liveRoutePath = running || paused ? displayRouteState : routeState");
    expect(mapScreen).not.toContain("routePath={rawPathRef.current}");
  });

  test("pontos ruins no inicio da corrida nao criam linha deslocada", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    const first = session.processLocationPoint(p(0, 0, 0, { accuracy: 40 }));
    const second = session.processLocationPoint(p(1, 0, 4, { accuracy: 8 }));
    expect(first.accepted).toBe(false);
    expect(first.reason).toBe(TRACKING_REJECT_REASON.warmup_bad_point);
    expect(second.trustedPath).toHaveLength(1);
  });

  test("quando usuario esta parado, tremedeira nao aumenta distancia", () => {
    const { finish } = processPath([
      p(0, 0, 0),
      p(1, 0.3, 0.2),
      p(2, -0.2, 0.1),
      p(3, 0.4, -0.2),
    ]);
    expect(finish.distanceMeters).toBeLessThan(1);
    expect(finish.trustedPath).toHaveLength(1);
  });

  test("buraco de GPS nao gera corte absurdo quando retorno e ruim", () => {
    const session = createTrackingSession({ mode: "run", startedAt: 0 });
    session.processLocationPoint(p(0, 0, 0));
    const badReturn = session.processLocationPoint(p(60, 0, 1000, { timestamp: BASE_TIME + 60_000, accuracy: 35 }));
    expect(badReturn.accepted).toBe(false);
    expect(badReturn.trustedPath).toHaveLength(1);
  });

  test("smoothing nao atrasa demais a currentPosition", () => {
    const session = createTrackingSession({ mode: "run", startedAt: 0 });
    session.processLocationPoint(p(0, 0, 0));
    const result = session.processLocationPoint(p(2, 0, 6, { speed: 3 }));
    expect(result.currentPosition).toBeTruthy();
    expect(calculateDistanceMeters(result.currentPosition, p(2, 0, 6))).toBeLessThan(5);
  });
});
