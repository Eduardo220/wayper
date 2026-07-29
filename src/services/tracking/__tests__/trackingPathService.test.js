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
  smoothCurrentPosition,
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
    expect(normalizeLocationPoint({ latitude: 0, longitude: 0, timestamp: BASE_TIME })).toBeNull();
    expect(shouldAcceptPoint({ latitude: 999, longitude: BASE_LNG }, {}, "run").reason).toBe(
      TRACKING_REJECT_REASON.invalid_coordinate
    );
  });

  test("ponto sem timestamp e rejeitado sem inventar horario atual", () => {
    const point = normalizeLocationPoint({ latitude: BASE_LAT, longitude: BASE_LNG });
    expect(point).toMatchObject({ latitude: BASE_LAT, longitude: BASE_LNG, timestamp: null });

    const verdict = shouldAcceptPoint({ latitude: BASE_LAT, longitude: BASE_LNG }, {}, "run");
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(TRACKING_REJECT_REASON.invalid_timestamp);
    expect(verdict.classification).toBe("discarded");
  });

  test("ponto com timestamp futuro absurdo e rejeitado", () => {
    const verdict = shouldAcceptPoint(
      p(1, 5, 0, { timestamp: BASE_TIME + 5 * 60_000 }),
      { trustedPath: [p(0)], nowMs: BASE_TIME },
      "run"
    );

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(TRACKING_REJECT_REASON.future_timestamp);
  });

  test("ponto antigo anterior ao inicio da corrida e rejeitado", () => {
    const verdict = shouldAcceptPoint(
      p(0, 0, 0, { timestamp: BASE_TIME - 60_000 }),
      { startedAt: BASE_TIME, nowMs: BASE_TIME },
      "run"
    );

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(TRACKING_REJECT_REASON.stale_point);
  });

  test("ponto duplicado e rejeitado", () => {
    const state = { trustedPath: [p(0)], previousSpeedMps: 0 };
    const verdict = shouldAcceptPoint(p(0), state, "run");
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(TRACKING_REJECT_REASON.duplicate_point);
  });

  test("mesmo timestamp com coordenada diferente nao entra como velocidade zero", () => {
    const candidate = p(0, 0, 12, { timestamp: BASE_TIME });
    const verdict = shouldAcceptPoint(candidate, { trustedPath: [p(0)], previousSpeedMps: 0 }, "run");

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(TRACKING_REJECT_REASON.out_of_order);
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
    expect(finish.pathQuality.smoothingVersion).toBe("wayper_tracking_v2");
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
    expect(paused.status).toBe("paused");
  });

  test("nao adiciona pontos durante paused", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    session.processLocationPoint(p(0, 0, 0));
    session.processLocationPoint(p(2, 0, 6));
    session.pause({ endedAt: BASE_TIME + 5000 });
    const ignored = session.processLocationPoint(p(3, 20, 20));
    expect(ignored.accepted).toBe(false);
    expect(ignored.reason).toBe("paused");
    expect(ignored.trustedPath).toHaveLength(2);
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

  test("ingestao reutiliza paths canonicos e nao faz rebuild completo por amostra", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    const points = makeRunPath(320);
    const first = session.processLocationPoint(points[0]);
    let latest = first;

    for (let index = 1; index < points.length; index += 1) {
      latest = session.processLocationPoint(points[index]);
    }

    const hotPathCounters = session.__getWorkCountersForTests();
    expect(latest.rawPath).toBe(first.rawPath);
    expect(latest.trustedPath).toBe(first.trustedPath);
    expect(latest.liveRenderPath).toBe(first.liveRenderPath);
    expect(hotPathCounters).toMatchObject({
      fullPathRebuilds: 0,
      liveRenderBuilds: 0,
      hotPathSnapshots: points.length,
      incrementalRawAppends: points.length,
    });
    expect(hotPathCounters.incrementalTrustedAppends).toBe(latest.trustedPath.length);

    const explicitState = session.getState();
    const afterExplicitRead = session.__getWorkCountersForTests();
    expect(afterExplicitRead.fullPathRebuilds).toBe(0);
    expect(afterExplicitRead.liveRenderBuilds).toBeGreaterThan(0);
    expect(explicitState.liveRenderPath.length).toBeGreaterThan(1);
  });

  test("distancia e accuracy incrementais permanecem corretas ao substituir zigzag", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    const first = session.processLocationPoint(p(0, 0, 0, { accuracy: 8 }));
    session.processLocationPoint(p(2, 0, 8, { accuracy: 24 }));
    const result = session.processLocationPoint(p(4, 0.5, 1, { accuracy: 8 }));
    const expectedPosition = smoothCurrentPosition(
      first.currentPosition,
      result.point,
      "run"
    );

    expect(result.trustedPath).toHaveLength(2);
    expect(result.stats.distanceMeters).toBeCloseTo(
      calculatePathDistanceMeters(result.trustedPath),
      6
    );
    expect(result.pathQuality.averageAccuracy).toBe(8);
    expect(result.pathQuality.maxAccuracy).toBe(8);
    expect(result.pathQuality.acceptedPoints).toBe(2);
    expect(result.pathQuality.lastCalculatedSpeedMps).toBeCloseTo(
      result.calculatedSpeedMps,
      12
    );
    expect(result.accelerationMps2).toBeCloseTo(
      Math.abs(result.calculatedSpeedMps) / (result.timeFromPreviousMs / 1000),
      12
    );
    expect(result.currentPosition.latitude).toBeCloseTo(
      expectedPosition.latitude,
      12
    );
    expect(result.currentPosition.longitude).toBeCloseTo(
      expectedPosition.longitude,
      12
    );
    expect(session.__getWorkCountersForTests()).toMatchObject({
      fullPathRebuilds: 0,
      incrementalTrustedRemovals: 1,
    });
  });

  test("recovery permite corrigir velocidade maxima ao substituir a cauda", () => {
    const foreground = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    foreground.processLocationPoint(p(0, 0, 0, { accuracy: 8 }));
    const beforeRecovery = foreground.processLocationPoint(p(2, 0, 8, { accuracy: 24 }));
    const recovered = createTrackingSession({
      mode: "run",
      snapshot: JSON.parse(JSON.stringify(foreground.getState({ fullRender: false }))),
    });

    const corrected = recovered.processLocationPoint(p(4, 0.5, 1, { accuracy: 8 }));
    const expectedMaxSpeed = Math.max(
      ...corrected.trustedPath.map((point) => Number(point.calculatedSpeedMps) || 0)
    );

    expect(corrected.trustedPath).toHaveLength(2);
    expect(corrected.stats.maxSpeedMps).toBeCloseTo(expectedMaxSpeed, 6);
    expect(corrected.stats.maxSpeedMps).toBeLessThan(beforeRecovery.stats.maxSpeedMps);
  });

  test("accuracy ausente nao entra como zero nas metricas incrementais", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });

    session.processLocationPoint(p(0, 0, 0, { accuracy: null }));
    const result = session.processLocationPoint(p(2, 0, 6, { accuracy: undefined }));

    expect(result.pathQuality).toMatchObject({
      averageAccuracy: null,
      maxAccuracy: null,
      poorAccuracyRatio: 0,
      lastAccuracyMeters: null,
    });
  });

  test("sessao hidratada continua incremental no caminho headless", () => {
    const points = makeRunPath(18);
    const foreground = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    points.slice(0, 10).forEach((point) => foreground.processLocationPoint(point));
    const persistedSnapshot = foreground.getState({ fullRender: false });
    const headless = createTrackingSession({
      mode: "run",
      snapshot: persistedSnapshot,
    });
    const rawPathReference = headless.state.rawPath;
    const trustedPathReference = headless.state.trustedPath;
    const before = headless.__getWorkCountersForTests();

    points.slice(10).forEach((point) => headless.processLocationPoint(point));

    const after = headless.__getWorkCountersForTests();
    expect(headless.state.rawPath).toBe(rawPathReference);
    expect(headless.state.trustedPath).toBe(trustedPathReference);
    expect(after.fullPathRebuilds).toBe(before.fullPathRebuilds);
    expect(after.liveRenderBuilds).toBe(before.liveRenderBuilds);
    expect(headless.state.distanceMeters).toBeCloseTo(
      headless.state.segments.reduce(
        (total, segment) => total + calculatePathDistanceMeters(segment.trustedPath),
        0
      ),
      6
    );
  });

  test("snapshot pausado hidratado ignora GPS ate resume explicito", () => {
    const foreground = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    foreground.processLocationPoint(p(0, 0, 0));
    foreground.processLocationPoint(p(2, 0, 6));
    const paused = foreground.pause({ endedAt: BASE_TIME + 5_000 });
    const recovered = createTrackingSession({
      mode: "run",
      snapshot: paused,
    });
    const rawCount = recovered.state.rawPath.length;
    const trustedCount = recovered.state.trustedPath.length;

    const ignored = recovered.processLocationPoint(p(4, 0, 12));

    expect(ignored).toMatchObject({
      accepted: false,
      reason: "paused",
      isRunning: false,
      isPaused: true,
    });
    expect(recovered.state.rawPath).toHaveLength(rawCount);
    expect(recovered.state.trustedPath).toHaveLength(trustedCount);

    recovered.resume({ startedAt: BASE_TIME + 8_000 });
    const resumed = recovered.processLocationPoint(p(5, 0, 15));
    expect(resumed.reason).not.toBe("paused");
    expect(resumed.isRunning).toBe(true);
    expect(resumed.isPaused).toBe(false);
  });

  test("filtro nao remove ponto do novo segmento usando geometria anterior", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    session.processLocationPoint(p(0, 0, 0));
    session.processLocationPoint(p(2, 0, 8));
    session.pause({ endedAt: BASE_TIME + 5_000 });
    session.resume({ startedAt: BASE_TIME + 7_000 });
    session.processLocationPoint(p(4, 0, 16, { accuracy: 24 }));

    const secondPoint = session.processLocationPoint(p(6, 0, 9, { accuracy: 8 }));
    const activeSegments = secondPoint.segments.filter(
      (segment) => segment.trustedPath.length > 0
    );

    expect(activeSegments).toHaveLength(2);
    expect(activeSegments[1].trustedPath).toHaveLength(2);
    expect(secondPoint.pathQuality.rejectedByZigzag).toBe(0);
  });

  test("finalizacao materializa o render lazy sem carregar o vetor incremental", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    makeRunPath(2_305).forEach((point) => session.processLocationPoint(point));
    const explicitRender = session.getState().liveRenderPath;

    const finish = session.finishTrackingSession({ durationMs: 2_305 * 2_000 });

    expect(finish.liveRenderPath).toEqual(explicitRender);
    expect(finish.liveRenderPath.length).toBeLessThan(finish.trustedPath.length);
    expect(finish.liveRenderPath.length).toBeLessThanOrEqual(2_200);
    expect(finish.segments[0].liveRenderPath).toEqual(explicitRender);
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

  test("finalizar congela a sessao e ignora callbacks atrasados", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    session.processLocationPoint(p(0, 0, 0));
    session.processLocationPoint(p(2, 0, 6));
    const finish = session.finishTrackingSession({ durationMs: 4000 });
    const late = session.processLocationPoint(p(4, 0, 12));
    expect(finish.status).toBe("finished");
    expect(late.accepted).toBe(false);
    expect(late.reason).toBe("finished");
    expect(late.trustedPath).toHaveLength(2);
    expect(late.isRunning).toBe(false);
  });

  test("payload final expoe aliases rawPoints e routeSegments para persistencia", () => {
    const { finish } = processPath(makeRunPath(6));
    expect(finish.rawPoints).toEqual(finish.rawPath);
    expect(finish.routeSegments).toEqual(finish.segments);
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

  test("MapLibre usa MultiLineString quando ha pausa real", () => {
    const mapLibre = fs.readFileSync(path.join(process.cwd(), "src/components/Map/WayperMapLibre.js"), "utf8");
    expect(mapLibre).toContain("type: \"MultiLineString\"");
    expect(mapLibre).toContain("buildRunLineGeoJson(");
    expect(mapLibre).toContain("routeSegments");
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

  test("gap longo com retorno plausivel cria novo segmento sem somar ponte", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    session.processLocationPoint(p(0, 0, 0));
    session.processLocationPoint(p(3, 0, 9));
    const afterGap = session.processLocationPoint(p(25, 0, 180, { timestamp: BASE_TIME + 75_000, accuracy: 8 }));

    expect(afterGap.accepted).toBe(true);
    expect(afterGap.segments.filter((segment) => segment.trustedPath.length > 0)).toHaveLength(2);
    expect(afterGap.stats.distanceMeters).toBeLessThan(20);
    expect(afterGap.pathQuality.gpsGapCount).toBeGreaterThan(0);
  });

  test("perda curta de sinal nao fragmenta segmento quando deslocamento e plausivel", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    session.processLocationPoint(p(0, 0, 0));
    session.processLocationPoint(p(3, 0, 9));
    const afterShortGap = session.processLocationPoint(p(14, 0, 28, { timestamp: BASE_TIME + 28_000, accuracy: 8 }));

    expect(afterShortGap.accepted).toBe(true);
    expect(afterShortGap.segments.filter((segment) => segment.trustedPath.length > 0)).toHaveLength(1);
    expect(afterShortGap.pathQuality.gpsGapCount).toBe(0);
  });

  test("smoothing nao atrasa demais a currentPosition", () => {
    const session = createTrackingSession({ mode: "run", startedAt: 0 });
    session.processLocationPoint(p(0, 0, 0));
    const result = session.processLocationPoint(p(2, 0, 6, { speed: 3 }));
    expect(result.currentPosition).toBeTruthy();
    expect(calculateDistanceMeters(result.currentPosition, p(2, 0, 6))).toBeLessThan(5);
  });
});
