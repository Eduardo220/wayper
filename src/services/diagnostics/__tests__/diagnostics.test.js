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
      locationPrecisionMode: "full",
    });
    storageService.__resetLogStorageForTests();
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
  });

  test("ErrorBoundary registra erro via errorReporter", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/ErrorBoundary.js"), "utf8");
    expect(source).toContain("reportError(error");
    expect(source).toContain("REACT_ERROR_BOUNDARY");
  });
});
