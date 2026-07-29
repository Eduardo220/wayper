import { describe, expect, test } from "@jest/globals";
import {
  ACTIVE_RUN_STATUS,
  calculateActiveRunDurationSeconds,
  mergeActiveRunSnapshots,
  normalizeActiveRunSnapshot,
  reconcileRunState,
} from "../activeRunState.js";

const BASE_TIME = Date.parse("2026-06-16T22:34:16.874Z");
const BASE_LAT = -28.99;
const BASE_LNG = -49.43;

function point(index, extra = {}) {
  return {
    latitude: BASE_LAT + index * 0.00002,
    longitude: BASE_LNG + index * 0.00003,
    accuracy: 8,
    timestamp: BASE_TIME + index * 60_000,
    source: "expo-location",
    ...extra,
  };
}

function runningSnapshot(overrides = {}) {
  const points = overrides.trustedPath || overrides.points || [point(0), point(1)];
  return {
    activeRunId: "run-live",
    id: "run-live",
    userId: "user-1",
    mode: "free",
    status: ACTIVE_RUN_STATUS.RUNNING,
    startedAtMs: BASE_TIME,
    startedAt: new Date(BASE_TIME).toISOString(),
    lastUpdatedAtMs: BASE_TIME + 60_000,
    lastUpdatedAt: new Date(BASE_TIME + 60_000).toISOString(),
    trustedPath: points,
    path: points,
    rawPath: points,
    rawPoints: points,
    distanceMeters: 100,
    durationMs: 60_000,
    segments: [
      {
        id: `segment_0_${BASE_TIME}`,
        index: 0,
        reason: "active",
        startedAt: BASE_TIME,
        startTimestamp: BASE_TIME,
        endedAt: null,
        endTimestamp: null,
        endReason: null,
        trustedPath: points,
        rawPath: points,
      },
    ],
    ...overrides,
  };
}

describe("reconcileRunState active run consistency", () => {
  test("A. corrida em primeiro plano passa de 12 minutos e mantem UI/mapa pela mesma base", () => {
    const points = Array.from({ length: 14 }, (_, index) => point(index));
    const { state } = reconcileRunState({
      incomingState: runningSnapshot({
        trustedPath: points,
        path: points,
        rawPath: points,
        segments: [{ ...runningSnapshot().segments[0], trustedPath: points, rawPath: points }],
      }),
      now: BASE_TIME + 13 * 60_000,
      reason: "foreground_point",
    });

    expect(state.trustedPath).toHaveLength(14);
    expect(state.displayPoints.length).toBeGreaterThan(0);
    expect(calculateActiveRunDurationSeconds(state, { nowMs: BASE_TIME + 13 * 60_000 })).toBeGreaterThan(12 * 60);
    expect(state.distanceMeters).toBeGreaterThan(0);
  });

  test("B. corrida em background volta com tempo e distancia reconstruidos dos pontos", () => {
    const current = runningSnapshot({ trustedPath: [point(0), point(1)], distanceMeters: 80 });
    const backgroundPoints = [point(0), point(1), point(6), point(10), point(13)];
    const { state } = reconcileRunState({
      currentState: current,
      incomingState: runningSnapshot({
        trustedPath: backgroundPoints,
        path: backgroundPoints,
        rawPath: backgroundPoints,
        distanceMeters: 400,
        lastUpdatedAtMs: BASE_TIME + 13 * 60_000,
      }),
      now: BASE_TIME + 13 * 60_000,
      reason: "app_active",
    });

    expect(state.trustedPath).toHaveLength(backgroundPoints.length);
    expect(state.distanceMeters).toBeGreaterThanOrEqual(400);
    expect(calculateActiveRunDurationSeconds(state, { nowMs: BASE_TIME + 13 * 60_000 })).toBeGreaterThan(12 * 60);
  });

  test("C. tela desligada recalcula elapsed ao voltar mesmo sem updates de UI", () => {
    const { state } = reconcileRunState({
      currentState: runningSnapshot({ durationMs: 70_000 }),
      incomingState: runningSnapshot({
        trustedPath: [point(0), point(12)],
        rawPath: [point(0), point(12)],
        lastUpdatedAtMs: BASE_TIME + 12 * 60_000,
      }),
      now: BASE_TIME + 12 * 60_000,
      reason: "screen_on_recovery",
    });

    expect(calculateActiveRunDurationSeconds(state, { nowMs: BASE_TIME + 12 * 60_000 })).toBe(12 * 60);
  });

  test("D. notification_open nao congela corrida em 01:10", () => {
    const invalidSegment = {
      ...runningSnapshot().segments[0],
      endedAt: BASE_TIME + 70_000,
      endTimestamp: BASE_TIME + 70_000,
      endReason: null,
    };
    const { state, logs } = reconcileRunState({
      incomingState: runningSnapshot({
        durationMs: 70_000,
        trustedPath: [point(0), point(12)],
        rawPath: [point(0), point(12)],
        segments: [invalidSegment],
      }),
      now: BASE_TIME + 12 * 60_000,
      reason: "notification_open",
    });

    expect(state.segments[0].endedAt).toBeNull();
    expect(state.segments[0].endTimestamp).toBeNull();
    expect(logs.map((entry) => entry.event)).toContain("ACTIVE_SEGMENT_STALE_END_CLEARED");
    expect(calculateActiveRunDurationSeconds(state, { nowMs: BASE_TIME + 12 * 60_000 })).toBe(12 * 60);
  });

  test("E. segmento ativo invalido usa now/lastLocationAt e nao endedAt", () => {
    const snapshot = normalizeActiveRunSnapshot(runningSnapshot({
      segments: [{
        ...runningSnapshot().segments[0],
        endedAt: BASE_TIME + 69_572,
        endTimestamp: BASE_TIME + 69_572,
        endReason: null,
      }],
    }), { nowMs: BASE_TIME + 12 * 60_000 });

    expect(snapshot.segments[0].endedAt).toBeNull();
    expect(calculateActiveRunDurationSeconds(snapshot, { nowMs: BASE_TIME + 12 * 60_000 })).toBe(12 * 60);
  });

  test("F. snapshot stale nao regride elapsed de 72s para 70s", () => {
    const current = runningSnapshot({
      durationMs: 72_000,
      lastUpdatedAtMs: BASE_TIME + 72_000,
      distanceMeters: 120,
    });
    const incoming = runningSnapshot({
      durationMs: 70_000,
      lastUpdatedAtMs: BASE_TIME + 70_000,
      distanceMeters: 100,
    });
    const { state, logs } = reconcileRunState({
      currentState: current,
      incomingState: incoming,
      now: BASE_TIME + 72_000,
      reason: "route_chunks_restore",
    });

    expect(calculateActiveRunDurationSeconds(state, { nowMs: BASE_TIME + 72_000 })).toBeGreaterThanOrEqual(72);
    expect(logs.map((entry) => entry.event)).toContain("ACTIVE_RUN_STALE_SNAPSHOT_BLOCKED");
    expect(logs.map((entry) => entry.event)).toContain("ACTIVE_RUN_ELAPSED_REGRESSION_BLOCKED");
  });

  test("snapshot RUNNING stale nao reabre corrida PAUSED sem prova de retomada", () => {
    const pausedAtMs = BASE_TIME + 70_000;
    const current = runningSnapshot({
      status: ACTIVE_RUN_STATUS.PAUSED,
      pausedAtMs,
      pausedAt: new Date(pausedAtMs).toISOString(),
      durationMs: 70_000,
      lastUpdatedAtMs: BASE_TIME + 80_000,
      segments: [{
        ...runningSnapshot().segments[0],
        endedAt: pausedAtMs,
        endTimestamp: pausedAtMs,
        endReason: "pause",
      }],
    });
    const incoming = runningSnapshot({
      durationMs: 60_000,
      lastUpdatedAtMs: BASE_TIME + 60_000,
      trustedPath: [point(0), point(1), point(2)],
      rawPath: [point(0), point(1), point(2)],
      distanceMeters: 120,
    });

    const { state, logs } = reconcileRunState({
      currentState: current,
      incomingState: incoming,
      now: BASE_TIME + 80_000,
      reason: "stale_before_pause",
    });

    expect(state.status).toBe(ACTIVE_RUN_STATUS.PAUSED);
    expect(state.pausedAtMs).toBe(pausedAtMs);
    expect(calculateActiveRunDurationSeconds(state, {
      nowMs: BASE_TIME + 10 * 60_000,
    })).toBe(70);
    expect(logs.map((entry) => entry.event)).toContain(
      "ACTIVE_RUN_UNPROVEN_RESUME_BLOCKED"
    );
  });

  test("retomada stale comprovada pelo segmento e pausa acumulada continua valida", () => {
    const pausedAtMs = BASE_TIME + 20_000;
    const current = runningSnapshot({
      status: ACTIVE_RUN_STATUS.PAUSED,
      pausedAtMs,
      pausedAt: new Date(pausedAtMs).toISOString(),
      durationMs: 20_000,
      lastUpdatedAtMs: BASE_TIME + 70_000,
      segments: [{
        ...runningSnapshot().segments[0],
        endedAt: pausedAtMs,
        endTimestamp: pausedAtMs,
        endReason: "pause",
      }],
    });
    const resumedAtMs = BASE_TIME + 60_000;
    const incoming = runningSnapshot({
      pausedDurationMs: 40_000,
      totalPausedMs: 40_000,
      durationMs: 20_000,
      lastUpdatedAtMs: resumedAtMs,
      segments: [
        current.segments[0],
        {
          index: 1,
          reason: "resume",
          startedAt: resumedAtMs,
          startTimestamp: resumedAtMs,
          endedAt: null,
          endTimestamp: null,
          endReason: null,
          trustedPath: [],
          rawPath: [],
        },
      ],
    });

    const { state } = reconcileRunState({
      currentState: current,
      incomingState: incoming,
      now: BASE_TIME + 80_000,
      reason: "resume_proven_by_timeline",
    });

    expect(state.status).toBe(ACTIVE_RUN_STATUS.RUNNING);
    expect(state.pausedDurationMs).toBe(40_000);
    expect(calculateActiveRunDurationSeconds(state, {
      nowMs: BASE_TIME + 80_000,
    })).toBe(40);
  });

  test("G. distancia stale nao volta de 970m para 310m", () => {
    const merged = mergeActiveRunSnapshots(
      runningSnapshot({ distanceMeters: 970 }),
      runningSnapshot({ distanceMeters: 310, lastUpdatedAtMs: BASE_TIME + 90_000 }),
      { nowMs: BASE_TIME + 90_000 }
    );

    expect(merged.distanceMeters).toBe(970);
    expect(merged.meta.distancePreserved).toBe(true);
  });

  test("H. foreground/background duplicados sao deduplicados e nao inflam distancia", () => {
    const duplicate = point(2);
    const { state, logs } = reconcileRunState({
      currentState: runningSnapshot({ trustedPath: [point(0), point(1), duplicate] }),
      incomingState: runningSnapshot({ trustedPath: [duplicate, point(3)] }),
      gpsPoints: [duplicate, point(3)],
      now: BASE_TIME + 180_000,
      reason: "background_point",
    });

    const keys = new Set(state.trustedPath.map((item) => `${item.timestamp}:${item.latitude}:${item.longitude}`));
    expect(keys.size).toBe(state.trustedPath.length);
    expect(logs.map((entry) => entry.event)).toContain("RUN_POINTS_DEDUPED");
  });

  test("I. recovery merge une canonico, chunks e memoria sem duplicar pontos", () => {
    const chunkPoints = [point(1), point(2), point(3), point(4)];
    const { state } = reconcileRunState({
      currentState: runningSnapshot({ trustedPath: [point(0), point(1)] }),
      incomingState: runningSnapshot({ trustedPath: [point(1), point(2)] }),
      routeChunks: {
        trustedPath: chunkPoints,
        rawPath: chunkPoints,
      },
      gpsPoints: [point(4), point(5)],
      now: BASE_TIME + 5 * 60_000,
      reason: "recovery_merge",
    });

    const keys = new Set(state.trustedPath.map((item) => `${item.timestamp}:${item.latitude}:${item.longitude}`));
    expect(keys.size).toBe(state.trustedPath.length);
    expect(state.trustedPath.length).toBeGreaterThanOrEqual(4);
    expect(calculateActiveRunDurationSeconds(state, { nowMs: BASE_TIME + 5 * 60_000 })).toBe(5 * 60);
  });

  test("J. finalizacao usa maior duracao entre stored, finishedAt e lastLocationAt", () => {
    const final = normalizeActiveRunSnapshot({
      ...runningSnapshot({
        status: ACTIVE_RUN_STATUS.FINISHED,
        durationMs: 70_000,
        finishedAtMs: BASE_TIME + 12 * 60_000,
        finishedAt: new Date(BASE_TIME + 12 * 60_000).toISOString(),
        trustedPath: [point(0), point(12)],
        rawPath: [point(0), point(12)],
      }),
    });

    expect(final.status).toBe(ACTIVE_RUN_STATUS.FINISHED);
    expect(final.durationSeconds).toBe(12 * 60);
    expect(calculateActiveRunDurationSeconds(final)).toBe(12 * 60);
  });
});
