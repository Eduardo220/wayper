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
  mergeActiveRunSnapshots,
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
    expect(snapshot.version).toBe(2);
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.runId).toBe("run_active_1");
    expect(snapshot.updatedAt).toBeTruthy();
    expect(snapshot.lastPoint).toEqual(snapshot.rawPath[snapshot.rawPath.length - 1]);
    expect(snapshot.lastValidPoint).toEqual(snapshot.currentLocation);
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
    expect(snapshot.totalPausedMs).toBe(10_000);
    expect(snapshot.pausedAt).toBeNull();
    expect(calculateActiveRunDurationSeconds(snapshot, { nowMs: BASE_TIME + 22_000 })).toBe(12);
  });

  test("duracao antiga nao reincorpora pausa depois da retomada", () => {
    const snapshot = normalizeActiveRunSnapshot({
      activeRunId: "paused-stored-duration",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: BASE_TIME,
      durationMs: 22_000,
      durationSeconds: 22,
      pausedDurationMs: 10_000,
      totalPausedMs: 10_000,
      segments: [
        {
          index: 0,
          startedAt: BASE_TIME,
          endedAt: BASE_TIME + 6000,
          endReason: "pause",
          trustedPath: [p(0), p(2)],
        },
        {
          index: 1,
          startedAt: BASE_TIME + 16_000,
          endedAt: null,
          reason: "resume",
          trustedPath: [p(9, 30, 30, { timestamp: BASE_TIME + 18_000 })],
        },
      ],
    }, { nowMs: BASE_TIME + 20_000 });

    expect(snapshot.durationSeconds).toBe(10);
    expect(calculateActiveRunDurationSeconds(snapshot, { nowMs: BASE_TIME + 20_000 })).toBe(10);
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
    expect(syncSource).toContain('batch.set(doc(db, "runs", remoteRunId), payload, { merge: true })');
    expect(syncSource).toContain('batch.set(doc(db, "users", uid, "runs", remoteRunId), payload, { merge: true })');
    expect(syncSource).toContain('return { remoteRunId: localRunId, source: "localRunId" }');
    expect(syncSource).toContain("uniqueById(next)");
    expect(syncSource).toContain("remoteRunId: remoteResult.remoteRunId");
    expect(syncSource).toContain("RUN_OFFLINE_STATUS.SYNC_FAILED");
  });

  test("desmontar MapScreen nao para background tracking da corrida ativa", () => {
    const mapScreen = fs.readFileSync(path.join(process.cwd(), "src/screens/MapScreen.js"), "utf8");
    const finalizationService = fs.readFileSync(
      path.join(process.cwd(), "src/services/run/runFinalizationService.js"),
      "utf8"
    );
    const cleanupStart = mapScreen.indexOf("return () => {", mapScreen.indexOf("/* ===== INIT ===== */"));
    const cleanupEnd = mapScreen.indexOf("}, [refreshForegroundLocation]", cleanupStart);
    const cleanup = mapScreen.slice(cleanupStart, cleanupEnd);
    expect(cleanup).not.toContain("stopBackgroundLocationService()");
    expect(cleanup).not.toContain("resetTrackingPipeline");
    expect(cleanup).not.toContain("resetRunVisuals");
    expect(mapScreen).toContain("activeRunTrackingService.startActiveRun");
    expect(mapScreen).toContain("restoreActiveRunForReentry");
    expect(mapScreen).toContain("checkpointOnLocationError");
    expect(mapScreen).toContain("freezeActiveRunForFinalization");
    expect(finalizationService).toContain('reason: "before_finish"');
    expect(mapScreen).toContain("hydrated route points count");
    expect(mapScreen).toContain("hydrateActiveRunFromRuntime");
    expect(mapScreen).toContain("useFocusEffect");
    expect(mapScreen).toContain("RUN_SCREEN_FOCUS");
    expect(mapScreen).toContain("recordNotificationOpen");
    expect(mapScreen).toContain("non_live_snapshot_guard");
    expect(mapScreen).not.toContain("flushTimer = setInterval");
    expect(mapScreen).not.toContain("FLUSH_INTERVAL_MS = 300");
    expect(mapScreen).toContain("RUN_UI_UPDATE_INTERVAL_MS = 1000");
    expect(mapScreen).toContain("ZONE_PREVIEW_INTERVAL_MS = 5000");
    const locationHandler = mapScreen.slice(
      mapScreen.indexOf("const handleLocationUpdate = useCallback"),
      mapScreen.indexOf("const stopBackgroundLocationService", mapScreen.indexOf("const handleLocationUpdate = useCallback"))
    );
    expect(locationHandler).toContain("activeRunTrackingService.recordLocation");
    expect(locationHandler).not.toContain("trackingSessionRef.current.processLocationPoint");
    expect(mapScreen).toContain("!running && !replaying && !runtimeRecovering");
    expect(finalizationService).toContain('"RUN_FINISH_SAVED"');
    expect(finalizationService.indexOf('"RUN_FINISH_SAVED"')).toBeLessThan(
      finalizationService.indexOf("markRecoveredRunLocallySaved?.({")
    );
  });

  test("task de localizacao e registrada no bootstrap fora da interface", () => {
    const indexSource = fs.readFileSync(path.join(process.cwd(), "index.js"), "utf8");
    const taskSource = fs.readFileSync(path.join(process.cwd(), "src/tasks/activeRunLocationTask.js"), "utf8");
    const serviceSource = fs.readFileSync(path.join(process.cwd(), "src/services/runTracking/activeRunTrackingService.js"), "utf8");
    const mapScreen = fs.readFileSync(path.join(process.cwd(), "src/screens/MapScreen.js"), "utf8");

    expect(indexSource.indexOf("./src/tasks/activeRunLocationTask.js")).toBeLessThan(indexSource.indexOf("./App"));
    expect(taskSource).toContain("TaskManager.defineTask(ACTIVE_RUN_LOCATION_TASK, handleActiveRunLocationTask)");
    expect(serviceSource).not.toContain("TaskManager.defineTask");
    expect(mapScreen).not.toContain("TaskManager.defineTask");
  });

  test("inicio de corrida mostra feedback antes de preparacao pesada", () => {
    const config = fs.readFileSync(path.join(process.cwd(), "src/config/runStartConfig.js"), "utf8");
    const mapScreen = fs.readFileSync(path.join(process.cwd(), "src/screens/MapScreen.js"), "utf8");
    const startFlowStart = mapScreen.indexOf("const startWithCountdown = useCallback");
    const startFlowEnd = mapScreen.indexOf("const startRun = useCallback", startFlowStart);
    const startFlow = mapScreen.slice(startFlowStart, startFlowEnd);

    expect(config).toContain("RUN_START_COUNTDOWN_SECONDS = 1");
    expect(startFlow).toContain('recordRunEvent("START_BUTTON_PRESSED"');
    expect(mapScreen).toContain('recordRunEvent("COUNTDOWN_SHOWN"');
    expect(startFlow).toContain('recordRunEvent("START_FAILED"');
    expect(startFlow).toContain("isStartingRunRef.current = true");
    expect(startFlow).toContain("setIsStartingRun(true)");
    expect(startFlow).toContain("setCounting(RUN_START_COUNTDOWN_SECONDS > 0)");
    expect(startFlow).toContain("waitRunStartCountdown(selectedMode, pressedAtMs)");
    expect(startFlow.indexOf("setCounting(RUN_START_COUNTDOWN_SECONDS > 0)")).toBeLessThan(startFlow.indexOf("ensureLocationForRun()"));
    expect(startFlow).not.toContain("warmUpGpsForRun");
    expect(startFlow).not.toContain("refreshForegroundLocation({ updatePosition: true })");
    expect(startFlow).not.toContain("requestBackgroundLocationPermission()");
  });

  test("inicio de corrida bloqueia clique duplo e preserva modos livre/zonas", () => {
    const mapScreen = fs.readFileSync(path.join(process.cwd(), "src/screens/MapScreen.js"), "utf8");
    const startFlowStart = mapScreen.indexOf("const startWithCountdown = useCallback");
    const startFlowEnd = mapScreen.indexOf("const startRun = useCallback", startFlowStart);
    const startFlow = mapScreen.slice(startFlowStart, startFlowEnd);

    expect(mapScreen).toContain("const [isStartingRun, setIsStartingRun] = useState(false)");
    expect(mapScreen).toContain("const [isFinishingRun, setIsFinishingRun] = useState(false)");
    expect(mapScreen).toContain("const isRunStartBusy = isStartingRun || counting || running || runtimeRecovering || isFinishingRun");
    expect(startFlow).toContain("isStartingRunRef.current");
    expect(startFlow).toContain("runningRef.current");
    expect(startFlow).toContain("runtimeRecovering");
    expect(startFlow).toContain("isFinishingRunRef.current");
    expect(startFlow).toContain("isFinishingRun");
    expect(mapScreen).toContain("disabled={isRunStartBusy}");
    expect(mapScreen).toContain("startMainBtnDisabled");
    expect(mapScreen).toContain("modeOptionDisabled");
    expect(mapScreen).toContain('startWithCountdown("free")');
    expect(mapScreen).toContain('startWithCountdown("zones")');
  });

  test("startRun solicita tracking antes da busca pontual de GPS", () => {
    const mapScreen = fs.readFileSync(path.join(process.cwd(), "src/screens/MapScreen.js"), "utf8");
    const startRunStart = mapScreen.indexOf("const startRun = useCallback");
    const startRunEnd = mapScreen.indexOf("const pauseRun = useCallback", startRunStart);
    const startRunFlow = mapScreen.slice(startRunStart, startRunEnd);

    expect(startRunFlow).toContain('recordRunEvent("TRACKING_START_REQUESTED"');
    expect(startRunFlow).toContain('recordRunEvent("TRACKING_STARTED"');
    expect(startRunFlow.indexOf("await startLocationWatcher();")).toBeLessThan(startRunFlow.indexOf("Location.getCurrentPositionAsync"));
    expect(startRunFlow.indexOf("await startBackgroundLocationService();")).toBeLessThan(startRunFlow.indexOf("Location.getCurrentPositionAsync"));
    expect(startRunFlow).toContain('return { ok: false, reason: "location_permission_denied", permission }');
    expect(startRunFlow).toContain("let activeRunStarted = false");
    expect(startRunFlow).toContain('throw new Error("activeRunTrackingService.startActiveRun returned empty snapshot")');
    expect(startRunFlow).toContain("if (!activeRunStarted)");
    expect(startRunFlow).toContain("setRunning(false)");
    expect(startRunFlow).toContain("currentRunIdRef.current = null");
    expect(startRunFlow).toContain("return { ok: true, runId: currentRunIdRef.current }");
  });

  test("merge seguro nao sobrescreve segments reais com default vazio", () => {
    const existing = makeRunningSnapshot();
    const incomingEmpty = normalizeActiveRunSnapshot({
      activeRunId: existing.activeRunId,
      userId: existing.userId,
      mode: existing.mode,
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: existing.startedAtMs,
      lastUpdatedAtMs: existing.lastUpdatedAtMs + 1000,
      points: [],
      path: [],
      trustedPath: [],
      filteredPoints: [],
      rawPath: [],
      rawPoints: [],
      liveRenderPath: [],
      displayPoints: [],
      segments: [],
      routeSegments: [],
      distanceMeters: 0,
    });

    const merged = mergeActiveRunSnapshots(existing, incomingEmpty);

    expect(merged.trustedPath).toHaveLength(existing.trustedPath.length);
    expect(merged.segments).toHaveLength(1);
    expect(merged.segments[0].trustedPath).toHaveLength(existing.trustedPath.length);
    expect(merged.meta.ignoredEmptyGeometryOverwrite).toBe(true);
  });

  test("distancia nao regride durante RUNNING com geometria parcial", () => {
    const existing = {
      ...makeRunningSnapshot(),
      distanceMeters: 930,
      distance: 930,
    };
    const incomingPartial = normalizeActiveRunSnapshot({
      ...existing,
      points: existing.trustedPath.slice(-1),
      path: existing.trustedPath.slice(-1),
      trustedPath: existing.trustedPath.slice(-1),
      filteredPoints: existing.trustedPath.slice(-1),
      segments: [],
      routeSegments: [],
      distanceMeters: 880,
      distance: 880,
      lastUpdatedAtMs: existing.lastUpdatedAtMs + 1000,
    });

    const merged = mergeActiveRunSnapshots(existing, incomingPartial);

    expect(merged.distanceMeters).toBe(930);
    expect(merged.trustedPath).toHaveLength(existing.trustedPath.length);
    expect(merged.meta.distancePreserved).toBe(true);
  });

  test("recovery deduplica o mesmo ponto com timestamp numerico e ISO", () => {
    const numericPoint = p(1);
    const isoPoint = {
      ...numericPoint,
      timestamp: new Date(numericPoint.timestamp).toISOString(),
    };
    const existing = normalizeActiveRunSnapshot({
      activeRunId: "run-timestamp-dedupe",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: BASE_TIME,
      lastUpdatedAtMs: BASE_TIME + 3000,
      trustedPath: [numericPoint],
      rawPath: [numericPoint],
      distanceMeters: 0,
    }, { nowMs: BASE_TIME + 3000 });
    const incoming = normalizeActiveRunSnapshot({
      ...existing,
      lastUpdatedAtMs: BASE_TIME + 4000,
      trustedPath: [isoPoint],
      rawPath: [isoPoint],
    }, { nowMs: BASE_TIME + 4000 });

    const merged = mergeActiveRunSnapshots(existing, incoming, {
      nowMs: BASE_TIME + 4000,
    });

    expect(merged.trustedPath).toHaveLength(1);
    expect(merged.rawPath).toHaveLength(1);
    expect(merged.meta.dedupedTrustedPointsCount).toBeGreaterThan(0);
  });

  test("duplo toque em finalizar nao libera o lock adquirido pela primeira chamada", () => {
    const mapScreen = fs.readFileSync(path.join(process.cwd(), "src/screens/MapScreen.js"), "utf8");
    const stopRunStart = mapScreen.indexOf("const stopRun = useCallback");
    const stopRunEnd = mapScreen.indexOf("const restoreRecoveryCandidateToUi", stopRunStart);
    const stopRunFlow = mapScreen.slice(stopRunStart, stopRunEnd);

    expect(stopRunFlow).toContain("let finishLockAcquired = false");
    expect(stopRunFlow).toContain("finishLockAcquired = true");
    expect(stopRunFlow).toContain("if (finishLockAcquired)");
    expect(stopRunFlow.indexOf("if (finishInFlightRef.current)")).toBeLessThan(
      stopRunFlow.indexOf("finishLockAcquired = true")
    );
    expect(stopRunFlow).not.toMatch(
      /FINISH_FAILED[\s\S]{0,250}finish_already_in_flight/
    );
  });

  test("tela exige transicao confirmada e preserva retry do resumo final", () => {
    const mapScreen = fs.readFileSync(path.join(process.cwd(), "src/screens/MapScreen.js"), "utf8");
    const summaryModal = fs.readFileSync(
      path.join(process.cwd(), "src/components/Runs/RunSummaryModal.js"),
      "utf8"
    );

    expect(mapScreen).toContain("RUN_PAUSE_NOT_CONFIRMED");
    expect(mapScreen).toContain("RUN_RESUME_NOT_CONFIRMED");
    expect(mapScreen).toContain("resolveFinalRunTiming");
    expect(mapScreen).toContain("forceWrite: true");
    expect(mapScreen).toMatch(/onSave=\{async[\s\S]+catch \(e\) \{[\s\S]+throw e;/);
    expect(summaryModal).toContain("setSaveError(");
    expect(summaryModal).toContain("A corrida continua preservada");
    expect(summaryModal).toContain("Salvar detalhes");
  });
});
