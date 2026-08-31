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

  test("duracao canonica cobre corrida, pausa e retomada pelos escalares de tempo", () => {
    const canonicalTiming = {
      version: 2,
      schemaVersion: 2,
      formatVersion: 2,
      startedAtMs: BASE_TIME,
      durationMs: 0,
    };

    expect(calculateActiveRunDurationSeconds({
      ...canonicalTiming,
      status: ACTIVE_RUN_STATUS.RUNNING,
      pausedDurationMs: 0,
    }, { nowMs: BASE_TIME + 12_000 })).toBe(12);

    expect(calculateActiveRunDurationSeconds({
      ...canonicalTiming,
      status: ACTIVE_RUN_STATUS.PAUSED,
      pausedDurationMs: 4000,
      pausedAtMs: BASE_TIME + 10_000,
    }, { nowMs: BASE_TIME + 60_000 })).toBe(6);

    expect(calculateActiveRunDurationSeconds({
      ...canonicalTiming,
      status: ACTIVE_RUN_STATUS.RUNNING,
      pausedDurationMs: 10_000,
    }, { nowMs: BASE_TIME + 22_000 })).toBe(12);
  });

  test("timeline canonica vence duracao armazenada contaminada pela pausa", () => {
    const contaminatedTiming = {
      version: 2,
      schemaVersion: 2,
      formatVersion: 2,
      startedAtMs: BASE_TIME,
      pausedDurationMs: 10_000,
      totalPausedMs: 10_000,
      durationMs: 22_000,
      durationSeconds: 22,
      lastUpdatedAtMs: BASE_TIME + 22_000,
    };

    expect(calculateActiveRunDurationSeconds({
      ...contaminatedTiming,
      status: ACTIVE_RUN_STATUS.RUNNING,
    }, { nowMs: BASE_TIME + 20_000 })).toBe(10);

    expect(calculateActiveRunDurationSeconds({
      ...contaminatedTiming,
      status: ACTIVE_RUN_STATUS.PAUSED,
      pausedAtMs: BASE_TIME + 20_000,
    }, { nowMs: BASE_TIME + 60_000 })).toBe(10);

    expect(calculateActiveRunDurationSeconds({
      ...contaminatedTiming,
      status: ACTIVE_RUN_STATUS.FINISHED,
      finishedAtMs: BASE_TIME + 20_000,
      currentLocation: {
        timestamp: BASE_TIME + 30_000,
      },
    }, { nowMs: BASE_TIME + 60_000 })).toBe(10);
  });

  test("total pausado canonico preserva o maior alias monotonicamente", () => {
    expect(calculateActiveRunDurationSeconds({
      version: 2,
      schemaVersion: 2,
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: BASE_TIME,
      pausedDurationMs: 0,
      totalPausedMs: 10_000,
      totalPausedTime: 5000,
      durationMs: 20_000,
    }, { nowMs: BASE_TIME + 20_000 })).toBe(10);
  });

  test("duracao canonica usa observacao coerente se o relogio regredir", () => {
    const snapshot = {
      version: 2,
      schemaVersion: 2,
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: BASE_TIME,
      pausedDurationMs: 10_000,
      durationMs: 30_000,
      lastUpdatedAtMs: BASE_TIME + 40_000,
      currentLocation: {
        timestamp: BASE_TIME + 35_000,
      },
    };

    expect(calculateActiveRunDurationSeconds(snapshot, {
      nowMs: BASE_TIME + 34_000,
    })).toBe(30);
  });

  test("transicoes terminais e recovery pausado permanecem congelados", () => {
    const frozenTiming = {
      version: 2,
      schemaVersion: 2,
      startedAtMs: BASE_TIME,
      pausedDurationMs: 10_000,
      durationMs: 50_000,
      lastUpdatedAtMs: BASE_TIME + 60_000,
    };

    expect(calculateActiveRunDurationSeconds({
      ...frozenTiming,
      status: ACTIVE_RUN_STATUS.FINISHING,
      finishedAtMs: BASE_TIME + 20_000,
    }, { nowMs: BASE_TIME + 90_000 })).toBe(10);

    expect(calculateActiveRunDurationSeconds({
      ...frozenTiming,
      status: ACTIVE_RUN_STATUS.FINISHING,
      finishedAtMs: null,
      lastUpdatedAtMs: BASE_TIME + 20_000,
    }, { nowMs: BASE_TIME + 90_000 })).toBe(10);

    expect(calculateActiveRunDurationSeconds({
      ...frozenTiming,
      status: ACTIVE_RUN_STATUS.STOPPING,
      lastUpdatedAtMs: BASE_TIME + 20_000,
    }, { nowMs: BASE_TIME + 90_000 })).toBe(10);

    expect(calculateActiveRunDurationSeconds({
      ...frozenTiming,
      status: ACTIVE_RUN_STATUS.CANCELLED,
      endedAt: BASE_TIME + 20_000,
    }, { nowMs: BASE_TIME + 90_000 })).toBe(10);

    expect(calculateActiveRunDurationSeconds({
      ...frozenTiming,
      status: ACTIVE_RUN_STATUS.RECOVERING,
      pausedAtMs: BASE_TIME + 20_000,
    }, { nowMs: BASE_TIME + 90_000 })).toBe(10);
  });

  test("normalizacoes sucessivas preservam a origem pausada do recovery", () => {
    const recoveredOnce = normalizeActiveRunSnapshot({
      version: 2,
      schemaVersion: 2,
      activeRunId: "paused-recovery",
      status: ACTIVE_RUN_STATUS.RECOVERING,
      startedAtMs: BASE_TIME,
      pausedDurationMs: 10_000,
      pausedAtMs: BASE_TIME + 20_000,
      durationMs: 50_000,
    }, { nowMs: BASE_TIME + 60_000 });
    const recoveredTwice = normalizeActiveRunSnapshot(recoveredOnce, {
      nowMs: BASE_TIME + 90_000,
    });

    expect(recoveredOnce.pausedAtMs).toBe(BASE_TIME + 20_000);
    expect(recoveredTwice.pausedAtMs).toBe(BASE_TIME + 20_000);
    expect(recoveredOnce.durationSeconds).toBe(10);
    expect(recoveredTwice.durationSeconds).toBe(10);
  });

  test("snapshot pausado legado sem fronteira preserva o fallback armazenado", () => {
    const recoveredOnce = normalizeActiveRunSnapshot({
      activeRunId: "legacy-paused-recovery",
      status: ACTIVE_RUN_STATUS.PAUSED,
      startedAtMs: BASE_TIME,
      durationMs: 60_000,
      segments: [],
    }, { nowMs: BASE_TIME + 60 * 60_000 });
    const recoveredTwice = normalizeActiveRunSnapshot(recoveredOnce, {
      nowMs: BASE_TIME + 2 * 60 * 60_000,
    });

    expect(recoveredOnce.durationSeconds).toBe(60);
    expect(recoveredOnce.pausedAtMs).toBe(BASE_TIME + 60_000);
    expect(recoveredTwice.durationSeconds).toBe(60);
    expect(recoveredTwice.pausedAtMs).toBe(BASE_TIME + 60_000);
  });

  test("fast path canonico nao le geometria em nenhum estado temporal", () => {
    const canonicalTiming = {
      version: 2,
      schemaVersion: 2,
      startedAtMs: BASE_TIME,
      pausedDurationMs: 10_000,
      durationMs: 10_000,
    };
    const snapshots = [
      { status: ACTIVE_RUN_STATUS.RUNNING },
      { status: ACTIVE_RUN_STATUS.PAUSED, pausedAtMs: BASE_TIME + 20_000 },
      { status: ACTIVE_RUN_STATUS.FINISHING, finishedAtMs: BASE_TIME + 20_000 },
      { status: ACTIVE_RUN_STATUS.STOPPING, lastUpdatedAtMs: BASE_TIME + 20_000 },
      { status: ACTIVE_RUN_STATUS.FINISHED, finishedAtMs: BASE_TIME + 20_000 },
      { status: ACTIVE_RUN_STATUS.CANCELLED, endedAt: BASE_TIME + 20_000 },
      { status: ACTIVE_RUN_STATUS.RECOVERING, pausedAtMs: BASE_TIME + 20_000 },
    ].map((timing) => ({ ...canonicalTiming, ...timing }));
    const geometryKeys = [
      "segments",
      "routeSegments",
      "trustedPath",
      "filteredPoints",
      "points",
      "path",
      "rawPath",
      "rawPoints",
      "liveRenderPath",
      "displayPoints",
    ];
    for (const snapshot of snapshots) {
      for (const key of geometryKeys) {
        Object.defineProperty(snapshot, key, {
          configurable: true,
          get() {
            throw new Error(`geometry read on canonical duration fast path: ${key}`);
          },
        });
      }

      expect(calculateActiveRunDurationSeconds(snapshot, {
        nowMs: BASE_TIME + 20_000,
      })).toBe(10);
    }
  });

  test("normalizacao v2 reconcilia escalares de pausa antes do fast path", () => {
    const snapshot = normalizeActiveRunSnapshot({
      version: 2,
      schemaVersion: 2,
      activeRunId: "v2-stale-pause-scalars",
      status: ACTIVE_RUN_STATUS.RUNNING,
      startedAtMs: BASE_TIME,
      pausedDurationMs: 0,
      durationMs: 20_000,
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
          reason: "resume",
          trustedPath: [p(9, 30, 30, { timestamp: BASE_TIME + 18_000 })],
        },
      ],
    }, { nowMs: BASE_TIME + 20_000 });

    expect(snapshot.pausedDurationMs).toBe(10_000);
    expect(snapshot.durationSeconds).toBe(10);
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
    const mapRunResources = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useMapRunResources.js"),
      "utf8"
    );
    const mapRunControls = fs.readFileSync(
      path.join(process.cwd(), "src/screens/map/MapRunControls.js"),
      "utf8"
    );
    const finalizationService = fs.readFileSync(
      path.join(process.cwd(), "src/services/run/runFinalizationService.js"),
      "utf8"
    );
    const finalizationHook = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useRunFinalization.js"),
      "utf8"
    );
    const finishFailureRecovery = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/runFinishFailureRecovery.js"),
      "utf8"
    );
    const startExecutor = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/runStartExecutor.js"),
      "utf8"
    );
    const reentry = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useActiveRunReentry.js"),
      "utf8"
    );
    const lifecycle = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useMapScreenLifecycle.js"),
      "utf8"
    );
    const activeRunProjection = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useActiveRunProjection.js"),
      "utf8"
    );
    const locationResources = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useRunLocationResources.js"),
      "utf8"
    );
    const activeRunFlow = `${mapScreen}\n${mapRunResources}\n${finalizationHook}\n${finishFailureRecovery}\n${startExecutor}\n${reentry}\n${activeRunProjection}`;
    const cleanupStart = lifecycle.indexOf("return () => {");
    const cleanupEnd = lifecycle.indexOf("  }, [", cleanupStart);
    expect(cleanupStart).toBeGreaterThanOrEqual(0);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);
    const cleanup = lifecycle.slice(cleanupStart, cleanupEnd);
    expect(cleanup).not.toContain("stopBackgroundLocationService()");
    expect(cleanup).not.toContain("resetTrackingPipeline");
    expect(cleanup).not.toContain("resetRunVisuals");
    expect(startExecutor).toContain("startActiveRun");
    expect(mapRunResources).toContain("useActiveRunReentry");
    expect(lifecycle).toContain("checkpointOnLocationError");
    expect(finalizationHook).toContain("freezeActiveRunForFinalization");
    expect(finalizationService).toContain('reason: "before_finish"');
    expect(finishFailureRecovery).toContain("RUN_FINISH_FAILURE_STATE_RESTORED");
    expect(finishFailureRecovery).toContain("context.applyActiveRunSnapshotToUi(snapshot");
    expect(finishFailureRecovery).toContain('"finish_failure_snapshot_timeout"');
    expect(finishFailureRecovery).toContain("activeSnapshot: snapshot || null");
    expect(finishFailureRecovery).toContain("RUN_FINISH_FAILURE_RECOVERY_UNAVAILABLE");
    expect(finishFailureRecovery).toContain("RUN_FINISH_FAILURE_LIVE_RESTORE_FAILED");
    expect(finishFailureRecovery).toContain("await Promise.all([");
    expect(activeRunFlow).toContain("backgroundStopPromise");
    expect(activeRunProjection).toContain('"MAP_ROUTE_HYDRATED"');
    expect(activeRunFlow).toContain("hydrateActiveRunFromRuntime");
    expect(reentry).toContain("useFocusEffect");
    expect(reentry).toContain("RUN_SCREEN_FOCUS");
    expect(reentry).toContain("recordNotificationOpen");
    expect(activeRunProjection).toContain("non_live_snapshot_guard");
    expect(mapScreen).not.toContain("flushTimer = setInterval");
    expect(mapScreen).not.toContain("FLUSH_INTERVAL_MS = 300");
    expect(activeRunProjection).toContain("RUN_UI_UPDATE_INTERVAL_MS = 1000");
    expect(locationResources).toContain("ZONE_PREVIEW_INTERVAL_MS = 5000");
    const locationHandler = locationResources.slice(
      locationResources.indexOf("function ingestLocation"),
      locationResources.indexOf("export default function useRunLocationResources")
    );
    expect(locationHandler).toContain("recordLocation(");
    expect(locationHandler).not.toContain("trackingSessionRef.current.processLocationPoint");
    expect(mapRunControls).toContain("!running && !replaying && !runtimeRecovering");
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
    const startFlow = fs.readFileSync(path.join(process.cwd(), "src/hooks/useRunStartFlow.js"), "utf8");

    expect(config).toContain("RUN_START_COUNTDOWN_SECONDS = 1");
    expect(startFlow).toContain('recordRunEvent("START_BUTTON_PRESSED"');
    expect(startFlow).toContain('recordRunEvent("COUNTDOWN_SHOWN"');
    expect(startFlow).toContain('recordRunEvent("START_FAILED"');
    expect(startFlow).toContain("startingRef.current = true");
    expect(startFlow).toContain("setIsStartingRun(true)");
    expect(startFlow).toContain("setCounting(RUN_START_COUNTDOWN_SECONDS > 0)");
    expect(startFlow).toContain("waitCountdown(selectedMode, pressedAtMs)");
    expect(startFlow.indexOf("setCounting(RUN_START_COUNTDOWN_SECONDS > 0)")).toBeLessThan(
      startFlow.indexOf("await Promise.all([runPreflight")
    );
    expect(startFlow).not.toContain("warmUpGpsForRun");
    expect(startFlow).not.toContain("refreshForegroundLocation({ updatePosition: true })");
    expect(startFlow).not.toContain("requestBackgroundLocationPermission()");
  });

  test("inicio de corrida bloqueia clique duplo e preserva modos livre/zonas", () => {
    const runState = fs.readFileSync(path.join(process.cwd(), "src/hooks/useMapRunState.js"), "utf8");
    const runOperations = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useMapRunOperations.js"),
      "utf8"
    );
    const mapRunControls = fs.readFileSync(
      path.join(process.cwd(), "src/screens/map/MapRunControls.js"),
      "utf8"
    );
    const mapRunDialogs = fs.readFileSync(
      path.join(process.cwd(), "src/screens/map/MapRunDialogs.js"),
      "utf8"
    );
    const runUi = `${mapRunControls}\n${mapRunDialogs}`;
    const startFlow = fs.readFileSync(path.join(process.cwd(), "src/hooks/useRunStartFlow.js"), "utf8");

    expect(startFlow).toContain("const [isStartingRun, setIsStartingRun] = useState(false)");
    expect(runState).toContain("const [isFinishingRun, setIsFinishingRun] = useState(false)");
    expect(runOperations).toContain("const isRunStartBusy = start.isStartingRun || start.counting || run.running ||");
    expect(runOperations).toContain("resources.runtimeRecovering || run.isFinishingRun");
    expect(startFlow).toContain("startingRef.current");
    expect(startFlow).toContain("context.runningRef.current");
    expect(startFlow).toContain("runtimeRecovering");
    expect(startFlow).toContain("isFinishingRunRef.current");
    expect(startFlow).toContain("isFinishingRun");
    expect(runUi).toContain("disabled={isRunStartBusy}");
    expect(runUi).toContain("startMainBtnDisabled");
    expect(runUi).toContain("modeOptionDisabled");
    expect(runUi).toContain('startWithCountdown("free")');
    expect(runUi).toContain('startWithCountdown("zones")');
  });

  test("startRun confirma owner canonico e watcher antes da busca pontual de GPS", () => {
    const startRunFlow = fs.readFileSync(path.join(process.cwd(), "src/hooks/runStartExecutor.js"), "utf8");
    const canonicalStartIndex = startRunFlow.indexOf("await startActiveRun?.({");
    const foregroundStartIndex = startRunFlow.indexOf("await context.startLocationWatcher();");
    const currentPositionIndex = startRunFlow.indexOf("Location.getCurrentPositionAsync");

    expect(startRunFlow).toContain('recordRunEvent("TRACKING_START_REQUESTED"');
    expect(startRunFlow).toContain('recordRunEvent("TRACKING_STARTED"');
    expect(canonicalStartIndex).toBeGreaterThanOrEqual(0);
    expect(foregroundStartIndex).toBeGreaterThanOrEqual(0);
    expect(currentPositionIndex).toBeGreaterThanOrEqual(0);
    expect(canonicalStartIndex).toBeLessThan(foregroundStartIndex);
    expect(foregroundStartIndex).toBeLessThan(currentPositionIndex);
    expect(startRunFlow).toContain('return { ok: false, reason: "location_permission_denied", permission }');
    expect(startRunFlow).toContain("let activeRunStarted = false");
    expect(startRunFlow).toContain('error.code = "RUN_START_NOT_CONFIRMED"');
    expect(startRunFlow).toContain("if (!activeRunStarted)");
    expect(startRunFlow).toContain("context.setRunning(false)");
    expect(startRunFlow).toContain("context.currentRunIdRef.current = null");
    expect(startRunFlow).toContain("return { ok: true, runId: context.currentRunIdRef.current }");
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

  test("pausa acumulada nao regride quando a retomada e reconciliada como stale", () => {
    const existing = normalizeActiveRunSnapshot({
      ...makeRunningSnapshot(),
      status: ACTIVE_RUN_STATUS.PAUSED,
      lastUpdatedAtMs: BASE_TIME + 80_000,
      pausedDurationMs: 0,
      totalPausedMs: 0,
      pausedAtMs: BASE_TIME + 10_000,
    }, { nowMs: BASE_TIME + 80_000 });
    const incoming = normalizeActiveRunSnapshot({
      ...existing,
      status: ACTIVE_RUN_STATUS.RUNNING,
      lastUpdatedAtMs: BASE_TIME + 70_000,
      pausedDurationMs: 60_000,
      totalPausedMs: 60_000,
      pausedAtMs: null,
      pausedAt: null,
    }, { nowMs: BASE_TIME + 70_000 });

    const merged = mergeActiveRunSnapshots(existing, incoming, {
      nowMs: BASE_TIME + 70_000,
    });

    expect(merged.status).toBe(ACTIVE_RUN_STATUS.RUNNING);
    expect(merged.pausedDurationMs).toBe(60_000);
    expect(merged.totalPausedMs).toBe(60_000);
    expect(merged.meta.staleSnapshotIgnored).toBe(true);
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
    const finalizationHook = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useRunFinalization.js"),
      "utf8"
    );
    const stopRunStart = finalizationHook.indexOf("async function executeStopRun");
    const stopRunFlow = finalizationHook.slice(stopRunStart);

    expect(stopRunFlow).toContain("let finishLockAcquired = false");
    expect(stopRunFlow).toContain("finishLockAcquired = true");
    expect(stopRunFlow).toContain("if (finishLockAcquired)");
    expect(stopRunFlow.indexOf("if (context.finishInFlightRef.current)")).toBeLessThan(
      stopRunFlow.indexOf("finishLockAcquired = true")
    );
    expect(stopRunFlow).not.toMatch(
      /FINISH_FAILED[\s\S]{0,250}finish_already_in_flight/
    );
  });

  test("tela exige transicao confirmada e preserva retry do resumo final", () => {
    const summaryModal = fs.readFileSync(
      path.join(process.cwd(), "src/components/Runs/RunSummaryModal.js"),
      "utf8"
    );
    const summarySave = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useRunSummarySave.js"),
      "utf8"
    );
    const finalizationHook = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useRunFinalization.js"),
      "utf8"
    );
    const pauseResume = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useRunPauseResume.js"),
      "utf8"
    );

    expect(pauseResume).toContain("RUN_PAUSE_NOT_CONFIRMED");
    expect(pauseResume).toContain("RUN_RESUME_NOT_CONFIRMED");
    expect(finalizationHook).toContain("buildFinishedRunData");
    const stopRunFlow = finalizationHook;
    expect(stopRunFlow).toContain("const requestedFinishedAtMs = Date.now()");
    expect(stopRunFlow).toContain("finishedAtMs: requestedFinishedAtMs");
    expect(stopRunFlow).toContain("buildFinishedRunData");
    expect(stopRunFlow).not.toContain("finishTrackingSession");
    expect(stopRunFlow).not.toContain("finishedAt: requestedFinishedAtMs");
    expect(summarySave).toContain("forceWrite: true");
    expect(summarySave).toMatch(/useCallback\(async[\s\S]+catch \(error\) \{[\s\S]+throw error;/);
    expect(summaryModal).toContain("setSaveError(");
    expect(summaryModal).toContain("A corrida continua preservada");
    expect(summaryModal).toContain("Salvar detalhes");
  });
});
