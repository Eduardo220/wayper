import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const nativeModule = {
  configureRunNotificationActions: jest.fn(async () => true),
  startRunNotification: jest.fn(async () => true),
  updateRunNotification: jest.fn(async () => true),
  stopRunNotification: jest.fn(async () => true),
};

let currentSnapshot = null;
const listeners = new Set();

const trackingService = {
  getActiveRunSnapshot: jest.fn(async () => currentSnapshot),
  onActiveRunSnapshot: jest.fn((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }),
  pauseActiveRun: jest.fn(async () => {
    currentSnapshot = {
      ...currentSnapshot,
      status: "PAUSED",
      segments: [{ startedAt: BASE_TIME, endedAt: BASE_TIME + 503000 }],
      durationSeconds: 503,
    };
    return currentSnapshot;
  }),
  resumeActiveRun: jest.fn(async () => {
    currentSnapshot = {
      ...currentSnapshot,
      status: "RUNNING",
      segments: [{ startedAt: BASE_TIME, endedAt: BASE_TIME + 503000 }, { startedAt: BASE_TIME + 600000 }],
      durationSeconds: 503,
    };
    return currentSnapshot;
  }),
};

await jest.unstable_mockModule("react-native", () => ({
  NativeModules: {
    WayperRunNotificationAndroid: nativeModule,
  },
  PermissionsAndroid: {
    PERMISSIONS: {
      POST_NOTIFICATIONS: "android.permission.POST_NOTIFICATIONS",
    },
    RESULTS: {
      GRANTED: "granted",
      DENIED: "denied",
    },
    check: jest.fn(async () => true),
    request: jest.fn(async () => "granted"),
  },
  Platform: {
    OS: "android",
    Version: 33,
  },
}));

await jest.unstable_mockModule("../../runTracking/activeRunTrackingService.js", () => ({
  default: trackingService,
  ...trackingService,
}));

const service = await import("../runNotificationService.js");

const BASE_TIME = 1700000000000;

function runningSnapshot(mode = "free", distanceMeters = 1420) {
  return {
    activeRunId: `run_${mode}`,
    id: `run_${mode}`,
    mode,
    status: "RUNNING",
    startedAtMs: BASE_TIME,
    startedAt: new Date(BASE_TIME).toISOString(),
    lastUpdatedAtMs: BASE_TIME + 503000,
    segments: [{ startedAt: BASE_TIME }],
    distanceMeters,
    trustedPath: [],
  };
}

function pausedSnapshot() {
  return {
    ...runningSnapshot(),
    status: "PAUSED",
    segments: [{ startedAt: BASE_TIME, endedAt: BASE_TIME + 503000 }],
    durationSeconds: 503,
  };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function emitSnapshot(event, snapshot) {
  listeners.forEach((listener) => listener({ event, snapshot }));
}

beforeEach(() => {
  currentSnapshot = null;
  listeners.clear();
  Object.values(nativeModule).forEach((fn) => fn.mockClear());
  Object.values(trackingService).forEach((fn) => {
    if (typeof fn?.mockClear === "function") fn.mockClear();
  });
  trackingService.getActiveRunSnapshot.mockImplementation(async () => currentSnapshot);
});

afterEach(() => {
  service.__resetRunNotificationServiceForTests();
});

describe("run notification service", () => {
  test("ao iniciar corrida, cria notificacao persistente com acao Parar", async () => {
    await service.startRunNotification({
      elapsedTimeSeconds: 503,
      distanceKm: 1.42,
      isPaused: false,
    }, { scheduleTimer: false });

    expect(nativeModule.startRunNotification).toHaveBeenCalledTimes(1);
    expect(nativeModule.startRunNotification.mock.calls[0][0]).toMatchObject({
      title: "Wayper",
      text: "Corrida · 08:23 · 1,42 km",
      actionLabel: "Parar",
      action: "pause",
    });
  });

  test("atualizar tempo e distancia usa a mesma notificacao", async () => {
    await service.startRunNotification({
      elapsedTimeSeconds: 500,
      distanceKm: 1.4,
      isPaused: false,
    }, { scheduleTimer: false });
    await service.startRunNotification({
      elapsedTimeSeconds: 505,
      distanceKm: 1.43,
      isPaused: false,
    }, { scheduleTimer: false });

    expect(nativeModule.startRunNotification).toHaveBeenCalledTimes(1);
    expect(nativeModule.updateRunNotification).toHaveBeenCalledTimes(1);
    expect(nativeModule.updateRunNotification.mock.calls[0][0]).toMatchObject({
      text: "Corrida · 08:25 · 1,43 km",
      actionLabel: "Parar",
    });
  });

  test("ao pausar pelo app, notificacao muda para acao Iniciar", async () => {
    await service.startRunNotification({
      elapsedTimeSeconds: 503,
      distanceKm: 1.42,
      isPaused: false,
    }, { scheduleTimer: false });
    await service.updateRunNotification({
      elapsedTimeSeconds: 503,
      distanceKm: 1.42,
      isPaused: true,
    });

    expect(nativeModule.updateRunNotification.mock.calls[0][0]).toMatchObject({
      text: "Corrida pausada · 08:23 · 1,42 km",
      actionLabel: "Iniciar",
      action: "resume",
    });
  });

  test("ao pausar pela notificacao, estado real muda para PAUSED sem zerar dados", async () => {
    currentSnapshot = runningSnapshot();
    await service.startRunNotification({
      elapsedTimeSeconds: 503,
      distanceKm: 1.42,
      isPaused: false,
    }, { scheduleTimer: false });

    const paused = await service.pauseRunFromNotification();

    expect(trackingService.pauseActiveRun).toHaveBeenCalledWith(expect.objectContaining({
      source: "notification",
    }));
    expect(paused.status).toBe("PAUSED");
    const payload = nativeModule.updateRunNotification.mock.calls.at(-1)[0];
    expect(payload).toMatchObject({
      isPaused: true,
      actionLabel: "Iniciar",
    });
    expect(payload.elapsedTimeSeconds).toBeGreaterThan(0);
    expect(payload.distanceKm).toBeCloseTo(1.42);
  });

  test("ao retomar pela notificacao, estado real muda para RUNNING sem perder segmentos", async () => {
    currentSnapshot = pausedSnapshot();
    await service.startRunNotification({
      elapsedTimeSeconds: 503,
      distanceKm: 1.42,
      isPaused: true,
    }, { scheduleTimer: false });

    const resumed = await service.resumeRunFromNotification();

    expect(trackingService.resumeActiveRun).toHaveBeenCalledWith(expect.objectContaining({
      source: "notification",
    }));
    expect(resumed.status).toBe("RUNNING");
    expect(resumed.segments.length).toBe(2);
    const payload = nativeModule.updateRunNotification.mock.calls.at(-1)[0];
    expect(payload).toMatchObject({
      isPaused: false,
      actionLabel: "Parar",
    });
    expect(payload.distanceKm).toBeCloseTo(1.42);
  });

  test("ao finalizar corrida, notificacao e timer sao removidos", async () => {
    currentSnapshot = null;
    service.startRunNotificationCoordinator();
    await flushPromises();
    nativeModule.stopRunNotification.mockClear();

    emitSnapshot("run_started", runningSnapshot());
    await flushPromises();
    emitSnapshot("run_finished_snapshot_saved", {
      ...runningSnapshot(),
      status: "FINISHED",
    });
    await flushPromises();

    expect(nativeModule.startRunNotification).toHaveBeenCalledTimes(1);
    expect(nativeModule.stopRunNotification).toHaveBeenCalledTimes(1);
  });

  test("corrida livre e corrida por zonas usam o mesmo coordenador", async () => {
    currentSnapshot = runningSnapshot("free");
    service.startRunNotificationCoordinator();
    await flushPromises();
    expect(trackingService.onActiveRunSnapshot).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);

    emitSnapshot("run_paused", {
      ...pausedSnapshot(),
      activeRunId: "run_zones",
      id: "run_zones",
      mode: "zones",
      distanceMeters: 1520,
    });
    await flushPromises();

    expect(nativeModule.startRunNotification).toHaveBeenCalledTimes(1);
    expect(nativeModule.updateRunNotification).toHaveBeenCalled();
  });
});
