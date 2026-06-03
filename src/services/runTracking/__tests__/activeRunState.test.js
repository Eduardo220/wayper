import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import {
  ACTIVE_RUN_STATUS,
  buildRunDataFromActiveSnapshot,
  calculateActiveRunDurationSeconds,
  createSnapshotFromTrackingSession,
  createTrackingSession,
  createTrackingSessionFromSnapshot,
  normalizeActiveRunSnapshot,
} from "../index.js";

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
    timestamp: BASE_TIME + index * 2000,
    source: "expo-location",
    ...extra,
  };
}

function makeRunningSnapshot() {
  const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
  session.processLocationPoint(p(0, 0, 0));
  session.processLocationPoint(p(2, 0, 8));
  return createSnapshotFromTrackingSession(
    session,
    {
      activeRunId: "run_active_1",
      userId: "user_1",
      mode: "free",
      startedAtMs: BASE_TIME,
      startedAt: new Date(BASE_TIME).toISOString(),
    },
    { status: ACTIVE_RUN_STATUS.RUNNING, nowMs: BASE_TIME + 5000 }
  );
}

describe("active run persistence state", () => {
  test("iniciar corrida cria snapshot local com status RUNNING", () => {
    const snapshot = makeRunningSnapshot();
    expect(snapshot.activeRunId).toBe("run_active_1");
    expect(snapshot.status).toBe(ACTIVE_RUN_STATUS.RUNNING);
    expect(snapshot.pendingSync).toBe(true);
    expect(snapshot.trustedPath).toHaveLength(2);
  });

  test("novo ponto GPS atualiza snapshot sem perder pontos anteriores", () => {
    const restored = createTrackingSessionFromSnapshot(makeRunningSnapshot());
    restored.processLocationPoint(p(4, 0, 16));
    const next = createSnapshotFromTrackingSession(restored, makeRunningSnapshot(), {
      status: ACTIVE_RUN_STATUS.RUNNING,
      nowMs: BASE_TIME + 9000,
    });
    expect(next.trustedPath).toHaveLength(3);
    expect(next.distanceMeters).toBeGreaterThan(12);
  });

  test("app reiniciado restaura corrida ativa a partir do snapshot", () => {
    const snapshot = makeRunningSnapshot();
    const restored = createTrackingSessionFromSnapshot(snapshot);
    const state = restored.getState();
    expect(state.status).toBe("active");
    expect(state.trustedPath).toEqual(snapshot.trustedPath);
    expect(state.segments).toHaveLength(1);
  });

  test("pausa encerra segmento e duracao ignora tempo parado", () => {
    const session = createTrackingSession({ mode: "run", startedAt: BASE_TIME });
    session.processLocationPoint(p(0, 0, 0));
    session.processLocationPoint(p(2, 0, 8));
    session.pause({ endedAt: BASE_TIME + 6000 });
    session.resume({ startedAt: BASE_TIME + 16_000 });
    session.processLocationPoint(p(9, 30, 30, { timestamp: BASE_TIME + 18_000 }));
    session.processLocationPoint(p(10, 36, 30, { timestamp: BASE_TIME + 20_000 }));
    const snapshot = createSnapshotFromTrackingSession(session, {
      activeRunId: "paused_run",
      startedAtMs: BASE_TIME,
    }, { status: ACTIVE_RUN_STATUS.RUNNING, nowMs: BASE_TIME + 22_000 });

    expect(snapshot.segments).toHaveLength(2);
    expect(calculateActiveRunDurationSeconds(snapshot, { nowMs: BASE_TIME + 22_000 })).toBe(12);
  });

  test("finalizar corrida usa pontos persistidos no snapshot", () => {
    const run = buildRunDataFromActiveSnapshot({
      ...makeRunningSnapshot(),
      status: ACTIVE_RUN_STATUS.FINISHED,
      finishedAtMs: BASE_TIME + 12_000,
      finishedAt: new Date(BASE_TIME + 12_000).toISOString(),
    });
    expect(run.id).toBe("run_active_1");
    expect(run.trustedPath).toHaveLength(2);
    expect(run.pendingSync).toBe(true);
    expect(run.synced).toBe(false);
  });

  test("falha de Firestore nao implica descarte do snapshot pendente", () => {
    const snapshot = normalizeActiveRunSnapshot({
      ...makeRunningSnapshot(),
      status: ACTIVE_RUN_STATUS.FINISHED,
      synced: false,
      pendingSync: true,
    });
    expect(snapshot.pendingSync).toBe(true);
    expect(snapshot.synced).toBe(false);
  });

  test("sync de corridas usa runId deterministico e merge idempotente", () => {
    const syncSource = fs.readFileSync(path.join(process.cwd(), "src/utils/sync.js"), "utf8");
    expect(syncSource).toContain('batch.set(doc(db, "runs", run.id), payload, { merge: true })');
    expect(syncSource).toContain('batch.set(doc(db, "users", uid, "runs", run.id), payload, { merge: true })');
    expect(syncSource).toContain("uniqueById(next)");
  });

  test("desmontar MapScreen nao para background tracking da corrida ativa", () => {
    const mapScreen = fs.readFileSync(path.join(process.cwd(), "src/screens/MapScreen.js"), "utf8");
    const cleanupStart = mapScreen.indexOf("return () => {", mapScreen.indexOf("flushTimer = setInterval"));
    const cleanupEnd = mapScreen.indexOf("}, [refreshForegroundLocation]", cleanupStart);
    const cleanup = mapScreen.slice(cleanupStart, cleanupEnd);
    expect(cleanup).not.toContain("stopBackgroundLocationService()");
    expect(mapScreen).toContain("activeRunTrackingService.startActiveRun");
  });
});
