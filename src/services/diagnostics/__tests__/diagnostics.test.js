import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const storage = new Map();
let failSetItem = false;

const AsyncStorageMock = {
  getItem: jest.fn(async (key) => storage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => {
    if (failSetItem) throw new Error("storage unavailable");
    storage.set(key, value);
  }),
  removeItem: jest.fn(async (key) => {
    storage.delete(key);
  }),
};

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: AsyncStorageMock,
}));

jest.unstable_mockModule("../../permissions.js", () => ({
  checkLocationPermission: jest.fn(async () => ({ granted: true, status: "granted" })),
  checkBackgroundLocationPermission: jest.fn(async () => ({ granted: false, status: "denied" })),
}));

jest.unstable_mockModule("../../runTracking/activeRunTrackingService.js", () => ({
  default: {
    getActiveRunSnapshot: jest.fn(async () => ({
      activeRunId: "run-export",
      status: "RUNNING",
      trustedPath: [{ latitude: -30.123456, longitude: -51.123456, timestamp: 1000 }],
      distanceMeters: 42,
      token: "secret-token",
    })),
    getTrackingRuntimeStatus: jest.fn(() => ({
      watcherStatus: "foreground_started",
      taskName: "WAYPER_ACTIVE_RUN_LOCATION",
    })),
  },
}));

jest.unstable_mockModule("../../runOfflineStorageService.js", () => ({
  loadActiveRun: jest.fn(async () => ({
    localRunId: "local-export",
    status: "RUNNING",
    points: [{ latitude: -30, longitude: -51 }],
    segments: [{ index: 0 }],
    distanceMeters: 42,
    refreshToken: "refresh-secret",
  })),
}));

const config = await import("../../../config/diagnosticsConfig.js");
const loggerModule = await import("../../../utils/logger.js");
const storageService = await import("../logStorageService.js");
const diagnostics = await import("../runDiagnosticsService.js");
const gpsShadow = await import("../gpsDebugShadowService.js");

const { logger, LOG_CATEGORIES, sanitizeLogContext } = loggerModule;

describe("diagnostics logging", () => {
  beforeEach(async () => {
    storage.clear();
    failSetItem = false;
    jest.clearAllMocks();
    config.resetDiagnosticsConfigForTests();
    config.updateDiagnosticsConfig({
      consoleEnabled: false,
      persistEnabled: true,
      minLevel: "debug",
      maxStoredLogs: 1000,
      locationPrecisionMode: "masked",
    });
    storageService.__resetLogStorageForTests();
    gpsShadow.__resetGpsShadowForTests();
    await storageService.clearLogs();
  });

  test("logger cria evento valido", async () => {
    const event = logger.info(LOG_CATEGORIES.RUN_RECOVERY, "Loaded active run from storage", {
      runId: "run-1",
      status: "RUNNING",
    });
    await storageService.__flushLogWritesForTests();
    const logs = await storageService.getLogs();

    expect(event).toMatchObject({
      level: "info",
      category: LOG_CATEGORIES.RUN_RECOVERY,
      event: "Loaded active run from storage",
      runId: "run-1",
    });
    expect(event.id).toBeTruthy();
    expect(Date.parse(event.timestamp)).not.toBeNaN();
    expect(logs).toHaveLength(1);
  });

  test("logger respeita nivel minimo", async () => {
    config.updateDiagnosticsConfig({ minLevel: "warn" });

    expect(logger.info(LOG_CATEGORIES.RUN_SESSION, "ignored_info")).toBeNull();
    expect(logger.warn(LOG_CATEGORIES.RUN_SESSION, "kept_warn")).toMatchObject({ level: "warn" });
    await storageService.__flushLogWritesForTests();

    const logs = await storageService.getLogs();
    expect(logs.map((log) => log.event)).toEqual(["kept_warn"]);
  });

  test("logger sanitiza dados sensiveis e mascara coordenadas em producao", () => {
    config.updateDiagnosticsConfig({ locationPrecisionMode: "masked" });

    const sanitized = sanitizeLogContext({
      email: "runner@example.com",
      password: "123456",
      token: "secret",
      nested: {
        latitude: -30.1234567,
        longitude: -51.7654321,
      },
    });

    expect(sanitized.email).toBe("ru***@example.com");
    expect(sanitized.password).toBe("[redacted]");
    expect(sanitized.token).toBe("[redacted]");
    expect(sanitized.nested.latitude).toBe(-30.123);
    expect(sanitized.nested.longitude).toBe(-51.765);
  });

  test("dev padrao nao habilita coordenadas exatas e full exige opt-in", () => {
    config.resetDiagnosticsConfigForTests();
    expect(config.getDiagnosticsConfig()).toMatchObject({
      allowPreciseLocationLogs: false,
      locationPrecisionMode: "masked",
    });

    config.updateDiagnosticsConfig({ locationPrecisionMode: "full" });
    expect(config.getDiagnosticsConfig().locationPrecisionMode).toBe("masked");

    config.updateDiagnosticsConfig({
      allowPreciseLocationLogs: true,
      locationPrecisionMode: "full",
    });
    expect(config.getDiagnosticsConfig().locationPrecisionMode).toBe("full");
  });

  test("storage limita numero maximo de logs e remove antigos", async () => {
    for (let index = 0; index < 5; index += 1) {
      await storageService.appendLog({
        id: `log-${index}`,
        timestamp: new Date(1000 + index).toISOString(),
        level: "info",
        category: LOG_CATEGORIES.RUN_SESSION,
        event: `event-${index}`,
      }, { maxStoredLogs: 3 });
    }

    const logs = await storageService.getLogs();
    expect(logs.map((log) => log.event)).toEqual(["event-2", "event-3", "event-4"]);
  });

  test("storage persiste logs frequentes em lote", async () => {
    const writesBefore = AsyncStorageMock.setItem.mock.calls.length;
    const writes = Array.from({ length: 10 }, (_, index) =>
      storageService.appendLog({
        id: `batch-${index}`,
        timestamp: new Date(2000 + index).toISOString(),
        level: "debug",
        category: LOG_CATEGORIES.LOCATION,
        event: "LOCATION_POINT_RECEIVED",
      }, { flushDelayMs: 1000 })
    );

    await storageService.__flushLogWritesForTests();
    await Promise.all(writes);

    const writesAfter = AsyncStorageMock.setItem.mock.calls.length;
    const logs = await storageService.getLogs();
    expect(writesAfter - writesBefore).toBe(1);
    expect(logs).toHaveLength(10);
  });

  test("erro no storage nao quebra o app", async () => {
    failSetItem = true;
    await expect(storageService.appendLog({ id: "x", level: "error", category: "UNKNOWN", event: "fail" })).resolves.toBeNull();
  });

  test("runDiagnosticsService registra eventos de corrida", async () => {
    diagnostics.recordRunEvent("RUN_STARTED", {
      runId: "run-diagnostics",
      status: "RUNNING",
      distance: 0,
    });
    await storageService.__flushLogWritesForTests();

    const logs = await storageService.getLogs({ runId: "run-diagnostics" });
    expect(logs[0]).toMatchObject({
      category: LOG_CATEGORIES.RUN_SESSION,
      event: "RUN_STARTED",
    });
  });

  test("eventos GPS criticos persistem em prod mesmo abaixo do nivel minimo", async () => {
    config.updateDiagnosticsConfig({ minLevel: "warn" });

    diagnostics.recordLocationPointEvent("LOCATION_POINT_RECEIVED", {
      latitude: -30.123456,
      longitude: -51.123456,
      accuracy: 12,
      timestamp: 10_000,
    }, {
      runId: "run-prod",
      source: "background",
    });
    await storageService.__flushLogWritesForTests();

    const logs = await storageService.getLogs({ runId: "run-prod" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "debug",
      event: "LOCATION_POINT_RECEIVED",
    });
  });

  test("gpsFilterReport compara filtro atual com shadow relaxado", () => {
    const makeLog = (event, timestamp, context = {}) => ({
      event,
      timestamp: new Date(timestamp).toISOString(),
      context: {
        timestamp,
        ...context,
      },
    });
    const logs = [
      makeLog("LOCATION_POINT_RECEIVED", 1_000, { accuracy: 10, point: { speed: 1.4 } }),
      makeLog("LOCATION_POINT_ACCEPTED", 1_000, {
        acceptedByRelaxedFilter: true,
        distanceFromPreviousMeters: 0,
      }),
      makeLog("LOCATION_POINT_RECEIVED", 3_000, { accuracy: 55, point: { speed: 1.6 } }),
      makeLog("LOCATION_POINT_REJECTED", 3_000, {
        reason: "bad_accuracy",
        acceptedByRelaxedFilter: true,
        distanceFromPreviousMeters: 4,
      }),
      makeLog("LOCATION_POINT_RECEIVED", 8_000, { accuracy: 14, point: { speed: 1.8 } }),
      makeLog("LOCATION_POINT_ACCEPTED", 8_000, {
        acceptedByRelaxedFilter: true,
        distanceFromPreviousMeters: 9,
      }),
      makeLog("LOCATION_POINT_RECEIVED", 12_000, { accuracy: 11, point: { speed: 0 } }),
      makeLog("LOCATION_POINT_REJECTED", 12_000, {
        reason: "duplicate_point",
        acceptedByRelaxedFilter: false,
        distanceFromPreviousMeters: 0.2,
      }),
    ];

    const report = diagnostics.buildGpsFilterReport(logs, { nowMs: 15_000 });

    expect(report).toMatchObject({
      rawPoints: 4,
      acceptedByCurrentFilter: 2,
      rejectedByCurrentFilter: 2,
      acceptedByRelaxedFilter: 3,
      longestGapBetweenAcceptedPointsMs: 7_000,
      longestGapBetweenRawPointsMs: 5_000,
      timeSinceLastAcceptedPointMs: 7_000,
      topRejectReasons: {
        bad_accuracy: 1,
        duplicate_point: 1,
      },
    });
    expect(report.accuracyStats).toMatchObject({ min: 10, max: 55, avg: 22.5 });
  });

  test("gpsFilterReport marca shadow relaxado como indisponível sem decisões shadow", () => {
    const logs = [{
      event: "LOCATION_POINT_ACCEPTED",
      timestamp: new Date(1_000).toISOString(),
      context: { timestamp: 1_000 },
    }, {
      event: "LOCATION_POINT_REJECTED",
      timestamp: new Date(2_000).toISOString(),
      context: { timestamp: 2_000, reason: "bad_accuracy" },
    }];

    expect(diagnostics.buildGpsFilterReport(logs, { nowMs: 3_000 })).toMatchObject({
      acceptedByCurrentFilter: 1,
      rejectedByCurrentFilter: 1,
      acceptedByRelaxedFilter: null,
    });
  });

  test("shadow relaxado aceita accuracy moderada rejeitada pelo filtro oficial", () => {
    gpsShadow.__setGpsDebugShadowModeForTests(true);

    const first = gpsShadow.evaluateGpsShadowPoint({
      latitude: -30,
      longitude: -51,
      accuracy: 8,
      timestamp: 1_000,
    }, {
      runId: "shadow-run",
      startedAt: 1_000,
      nowMs: 1_000,
    });
    const moderate = gpsShadow.evaluateGpsShadowPoint({
      latitude: -30,
      longitude: -50.99994,
      accuracy: 55,
      timestamp: 4_000,
    }, {
      runId: "shadow-run",
      startedAt: 1_000,
      nowMs: 4_000,
    });

    expect(first.acceptedByRelaxedFilter).toBe(true);
    expect(moderate.acceptedByRelaxedFilter).toBe(true);
    expect(moderate.relaxedAcceptedPoints).toBe(2);
  });

  test("exportDiagnosticsBundle remove dados sensiveis", async () => {
    logger.error(LOG_CATEGORIES.FIREBASE, "firebase failed", {
      email: "athlete@example.com",
      accessToken: "token-secret",
    });
    await storageService.__flushLogWritesForTests();

    const bundle = await diagnostics.exportDiagnosticsBundle({ limit: 20 });
    const json = JSON.stringify(bundle);

    expect(json).not.toContain("token-secret");
    expect(json).not.toContain("refresh-secret");
    expect(json).not.toContain("athlete@example.com");
    expect(json).toContain("at***@example.com");
    expect(bundle.activeRun.runId).toBe("run-export");
    expect(bundle.metadata).toMatchObject({
      preciseLocationLogsEnabled: false,
      locationPrecisionMode: "masked",
    });
  });

  test("snapshot de emergencia resume corrida ativa sem coordenadas exatas", async () => {
    diagnostics.recordEmergencyRunDiagnosticsSnapshot({
      event: "ui_heartbeat",
      runId: "run-emergency",
      status: "RUNNING",
      elapsedMs: 120000,
      distanceMeters: 456.7,
      lastUiTickAt: "2026-06-20T10:00:01.000Z",
      lastLocationReceivedAt: "2026-06-20T10:00:02.000Z",
      lastLocationAcceptedAt: "2026-06-20T10:00:03.000Z",
      lastRenderPathUpdatedAt: "2026-06-20T10:00:04.000Z",
      watcherStatus: "foreground_started",
      notificationStatus: "visible",
      timerStatus: "running",
      appState: "active",
      pathCounts: {
        rawPointsCount: 4,
        trustedPointsCount: 3,
        renderPointsCount: 3,
        segmentsCount: 1,
      },
      discardedPointReasons: { bad_accuracy: 1 },
      stallCounters: { ui: 1, timer: 2, drawer: 1 },
      snapshot: {
        rawPath: [{ latitude: -30.1234567, longitude: -51.7654321 }],
      },
    });
    await storageService.__flushLogWritesForTests();

    const logs = await storageService.getLogs();
    const event = logs.find((log) => log.event === "EMERGENCY_RUN_DIAGNOSTIC_SNAPSHOT");
    const json = JSON.stringify(event);

    expect(event.context).toMatchObject({
      runId: "run-emergency",
      status: "RUNNING",
      lastUiTickAt: "2026-06-20T10:00:01.000Z",
      timerStatus: "running",
      watcherStatus: "foreground_started",
      preciseCoordinatesIncluded: false,
      pathCounts: {
        rawPointsCount: 4,
        trustedPointsCount: 3,
        renderPointsCount: 3,
        segmentsCount: 1,
      },
      discardedPointReasons: { bad_accuracy: 1 },
    });
    expect(json).not.toContain("-30.1234567");
    expect(json).not.toContain("-51.7654321");
  });

  test("exportDiagnosticsBundle inclui snapshots de emergencia, drawer e stalls", async () => {
    diagnostics.recordRunEvent("RUN_DRAWER_OPEN_REQUESTED", {
      runId: "run-emergency",
      source: "header_menu",
    });
    diagnostics.recordRunEvent("RUN_DRAWER_OPEN_TIMEOUT", {
      runId: "run-emergency",
      source: "header_menu",
      timeoutMs: 900,
    });
    diagnostics.recordRunEvent("RUN_UI_TIMER_STALL", {
      runId: "run-emergency",
      elapsedSinceLastTickMs: 4200,
    });
    diagnostics.recordEmergencyRunDiagnosticsSnapshot({
      runId: "run-emergency",
      status: "RUNNING",
      lastUiTickAt: "2026-06-20T10:00:01.000Z",
      lastRenderPathUpdatedAt: "2026-06-20T10:00:02.000Z",
      timerStatus: "running",
      watcherStatus: "foreground_started",
      pathCounts: {
        rawPointsCount: 2,
        trustedPointsCount: 2,
        renderPointsCount: 2,
        segmentsCount: 1,
      },
    });
    await storageService.__flushLogWritesForTests();

    const bundle = await diagnostics.exportDiagnosticsBundle({ limit: 50 });

    expect(bundle.latestEmergencyRunDiagnosticsSnapshot).toMatchObject({
      runId: "run-emergency",
      lastUiTickAt: "2026-06-20T10:00:01.000Z",
      timerStatus: "running",
      watcherStatus: "foreground_started",
    });
    expect(bundle.drawerMenuAttempts).toMatchObject({
      requested: 1,
      timedOut: 1,
    });
    expect(bundle.stallCounters).toMatchObject({
      timer: 1,
      drawer: 1,
    });
    expect(bundle.uiInteractionEvents.map((event) => event.event)).toEqual(
      expect.arrayContaining(["RUN_DRAWER_OPEN_REQUESTED", "RUN_DRAWER_OPEN_TIMEOUT", "RUN_UI_TIMER_STALL"])
    );
  });

  test("MapScreen expoe diagnostico de emergencia sem navegar para Configuracoes", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/screens/MapScreen.js"), "utf8");

    expect(source).toContain('testID="emergency-diagnostics-button"');
    expect(source).toContain("createActiveRunLightDiagnosticsArtifact");
    expect(source).toContain("fullExportDeferred");
    expect(source).toContain("Sharing.shareAsync");
    expect(source).toContain("RUN_EMERGENCY_DIAGNOSTICS_EXPORT_STARTED");
    expect(source).toContain("RUN_DIAGNOSTIC_EXPORT_TIMEOUT");
    expect(source).toContain("RUN_DIAGNOSTIC_EXPORT_CANCELLED_FOR_FINISH");
    expect(source).toContain('recordEmergencyDiagnosticsSnapshot("ui_heartbeat"');
    expect(source).toContain("hitSlop={EMERGENCY_DIAGNOSTICS_HIT_SLOP}");
    expect(source).not.toContain("createDiagnosticsArchive({");
    expect(source).not.toContain('navigation.navigate("Diagnostico"');
  });

  test("diagnostico ativo usa artefato leve e deixa ZIP completo fora da MapScreen", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/diagnostics/diagnosticExportService.js"), "utf8");
    const lightExportStart = source.indexOf("export async function createActiveRunLightDiagnosticsArtifact");
    const fullZipStart = source.indexOf("async function createDiagnosticsArchiveInternal");

    expect(source).toContain("export function buildActiveRunLightDiagnosticsPayload");
    expect(source).toContain("format: \"wayper-active-run-light-diagnostics\"");
    expect(source).toContain("mimeType: \"application/json\"");
    expect(source).toContain("fullExportDeferred: true");
    expect(lightExportStart).toBeGreaterThan(-1);
    expect(fullZipStart).toBeGreaterThan(lightExportStart);
    expect(source.slice(lightExportStart, fullZipStart)).not.toContain("new JSZip");
    expect(source.slice(lightExportStart, fullZipStart)).not.toContain("getDiagnosticNdjson");
  });

  test("finalizacao da corrida salva local antes de tarefas pesadas", () => {
    const mapScreen = fs.readFileSync(path.join(process.cwd(), "src/screens/MapScreen.js"), "utf8");
    const finalizationService = fs.readFileSync(
      path.join(process.cwd(), "src/services/run/runFinalizationService.js"),
      "utf8"
    );
    const minimumSaveCall = mapScreen.indexOf("await persistMinimumFinishedRun(runData");
    const uiReleased = mapScreen.indexOf("RUN_FINISH_UI_RELEASED");
    const deferredEnqueue = mapScreen.indexOf("await enqueuePostRunProcessing(savedLocalRun", uiReleased);
    const deferredQueueProcessing = mapScreen.indexOf(
      "const processResult = await runDeferredTaskQueueRepository.process({",
      uiReleased
    );

    expect(finalizationService).toContain("RUN_FINISH_LOCAL_MIN_SAVE_STARTED");
    expect(finalizationService).toContain("RUN_FINISH_LOCAL_MIN_SAVE_COMPLETED");
    expect(finalizationService).toContain("RUN_FINISH_DEFERRED_TASKS_SCHEDULED");
    expect(mapScreen).toContain("territoryCaptureStatus = \"PENDING\"");
    expect(mapScreen).toContain('includeTerritory: activeMode === "zones"');
    expect(mapScreen).toContain('trigger: "finish_ui_released"');
    expect(mapScreen).toContain("isFinishingRun ? \"Finalizando...\"");
    expect(minimumSaveCall).toBeGreaterThan(-1);
    expect(uiReleased).toBeGreaterThan(minimumSaveCall);
    expect(deferredEnqueue).toBeGreaterThan(uiReleased);
    expect(deferredQueueProcessing).toBeGreaterThan(uiReleased);
  });

  test("MainNavigator registra tentativa e timeout do drawer", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/navigation/MainNavigator.js"), "utf8");

    expect(source).toContain("RUN_DRAWER_OPEN_REQUESTED");
    expect(source).toContain("RUN_DRAWER_OPEN_TIMEOUT");
    expect(source).toContain("drawerOpen");
    expect(source).toContain("hitSlop={12}");
  });

  test("ErrorBoundary registra erro via errorReporter", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/ErrorBoundary.js"), "utf8");
    expect(source).toContain("reportError(error");
    expect(source).toContain("REACT_ERROR_BOUNDARY");
  });
});
