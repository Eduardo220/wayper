import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const nativeModule = {
  configureRunNotificationActions: jest.fn(async () => true),
  startRunNotification: jest.fn(async () => true),
  updateRunNotification: jest.fn(async () => true),
  stopRunNotification: jest.fn(async () => true),
  isActive: jest.fn(async () => false),
  getState: jest.fn(async () => ({
    isActive: false,
    channelId: "wayper_run_tracking",
    notificationId: 4217,
    status: "UNKNOWN",
    hasForegroundService: false,
  })),
};

let currentSnapshot = null;
const listeners = new Set();
const notificationPermissionCheck = jest.fn(async () => true);
const notificationPermissionRequest = jest.fn(async () => "granted");
const flushActiveRunCheckpoint = jest.fn(async () => ({ ok: true }));

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

const runtimeService = {
  hydrateActiveRunFromRuntime: jest.fn(async () => ({
    snapshot: currentSnapshot,
    source: "test_runtime",
    runtime: {
      status: currentSnapshot?.status || "IDLE",
    },
  })),
  recordNotificationAction: jest.fn(),
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
    check: notificationPermissionCheck,
    request: notificationPermissionRequest,
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

await jest.unstable_mockModule("../runAutoSaveService.js", () => ({
  flushActiveRunCheckpoint,
}));

const service = await import("../runNotificationService.js");

const BASE_TIME = 1700000000000;

function runningSnapshot(mode = "free", distanceMeters = 1420) {
  return {
    activeRunId: `run_${mode}`,
    id: `run_${mode}`,
    userId: "user-1",
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
  notificationPermissionCheck.mockClear();
  notificationPermissionCheck.mockResolvedValue(true);
  notificationPermissionRequest.mockClear();
  notificationPermissionRequest.mockResolvedValue("granted");
  flushActiveRunCheckpoint.mockClear();
  flushActiveRunCheckpoint.mockResolvedValue({ ok: true });
  runtimeService.hydrateActiveRunFromRuntime.mockClear();
  runtimeService.hydrateActiveRunFromRuntime.mockImplementation(async () => ({
    snapshot: currentSnapshot,
    source: "test_runtime",
    runtime: {
      status: currentSnapshot?.status || "IDLE",
    },
  }));
  runtimeService.recordNotificationAction.mockClear();
  service.__setRunNotificationDependenciesForTests({
    nativeModule,
    trackingService,
    runtimeService,
  });
});

afterEach(() => {
  service.__resetRunNotificationServiceForTests();
});

describe("run notification service", () => {
  test("ao iniciar corrida, cria notificacao persistente com acao Pausar", async () => {
    await service.startRunNotification({
      elapsedTimeSeconds: 503,
      distanceKm: 1.42,
      isPaused: false,
    }, { scheduleTimer: false });

    expect(nativeModule.startRunNotification).toHaveBeenCalledTimes(1);
    expect(nativeModule.startRunNotification.mock.calls[0][0]).toMatchObject({
      title: "Wayper",
      text: "Correndo - 08:23 - 1,42 km",
      statusLabel: "Correndo",
      actionLabel: "Pausar",
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
      text: "Correndo - 08:25 - 1,43 km",
      statusLabel: "Correndo",
      actionLabel: "Pausar",
    });
  });

  test("ao pausar pelo app, notificacao muda para acao Retomar", async () => {
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
      text: "Pausada - 08:23 - 1,42 km",
      statusLabel: "Pausada",
      actionLabel: "Retomar",
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

    expect(runtimeService.recordNotificationAction).toHaveBeenCalledWith("pause", expect.objectContaining({
      source: "notification_action_handler",
    }));
    expect(runtimeService.hydrateActiveRunFromRuntime).toHaveBeenCalledWith("notification_action:pause", expect.objectContaining({
      userId: "user-1",
      restartTracking: true,
      forceNotification: true,
    }));
    expect(trackingService.pauseActiveRun).toHaveBeenCalledWith(expect.objectContaining({
      source: "notification",
    }));
    expect(paused.status).toBe("PAUSED");
    const payload = nativeModule.updateRunNotification.mock.calls.at(-1)[0];
    expect(payload).toMatchObject({
      isPaused: true,
      actionLabel: "Retomar",
    });
    expect(flushActiveRunCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      reason: "notification_pause",
    }));
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

    expect(runtimeService.recordNotificationAction).toHaveBeenCalledWith("resume", expect.objectContaining({
      source: "notification_action_handler",
    }));
    expect(runtimeService.hydrateActiveRunFromRuntime).toHaveBeenCalledWith("notification_action:resume", expect.objectContaining({
      userId: "user-1",
      restartTracking: true,
      forceNotification: true,
    }));
    expect(trackingService.resumeActiveRun).toHaveBeenCalledWith(expect.objectContaining({
      source: "notification",
    }));
    expect(resumed.status).toBe("RUNNING");
    expect(resumed.segments.length).toBe(2);
    const payload = nativeModule.updateRunNotification.mock.calls.at(-1)[0];
    expect(payload).toMatchObject({
      isPaused: false,
      actionLabel: "Pausar",
    });
    expect(flushActiveRunCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      reason: "notification_resume",
    }));
    expect(payload.distanceKm).toBeCloseTo(1.42);
  });

  test("nao confirma pausa quando o tracking devolve estado ainda RUNNING", async () => {
    currentSnapshot = runningSnapshot();
    await service.startRunNotification({
      elapsedTimeSeconds: 503,
      distanceKm: 1.42,
      isPaused: false,
    }, { scheduleTimer: false });
    nativeModule.updateRunNotification.mockClear();
    trackingService.pauseActiveRun.mockImplementationOnce(async () => currentSnapshot);

    const result = await service.pauseRunFromNotification();

    expect(result.status).toBe("RUNNING");
    expect(flushActiveRunCheckpoint).not.toHaveBeenCalled();
    expect(nativeModule.updateRunNotification.mock.calls.at(-1)[0]).toMatchObject({
      isPaused: false,
      actionLabel: "Pausar",
    });
  });

  test("nao confirma retomada quando o tracking devolve estado ainda PAUSED", async () => {
    currentSnapshot = pausedSnapshot();
    await service.startRunNotification({
      elapsedTimeSeconds: 503,
      distanceKm: 1.42,
      isPaused: true,
    }, { scheduleTimer: false });
    nativeModule.updateRunNotification.mockClear();
    trackingService.resumeActiveRun.mockImplementationOnce(async () => currentSnapshot);

    const result = await service.resumeRunFromNotification();

    expect(result.status).toBe("PAUSED");
    expect(flushActiveRunCheckpoint).not.toHaveBeenCalled();
    expect(nativeModule.updateRunNotification.mock.calls.at(-1)[0]).toMatchObject({
      isPaused: true,
      actionLabel: "Retomar",
    });
  });

  test("acao duplicada de pausar pela notificacao e idempotente", async () => {
    currentSnapshot = runningSnapshot();

    await service.pauseRunFromNotification();
    await service.pauseRunFromNotification();

    expect(runtimeService.hydrateActiveRunFromRuntime).toHaveBeenCalledTimes(2);
    expect(trackingService.pauseActiveRun).toHaveBeenCalledTimes(1);
    expect(flushActiveRunCheckpoint).toHaveBeenCalledTimes(1);
    expect(currentSnapshot.status).toBe("PAUSED");
  });

  test("le estado nativo da notificacao para evidencias de runtime", async () => {
    nativeModule.getState.mockResolvedValueOnce({
      isActive: true,
      channelId: "wayper_run_tracking",
      notificationId: 4217,
      status: "RUNNING",
      lastUpdatedAt: 1700000001234,
      title: "Wayper",
      text: "Correndo - 08:23 - 1,42 km",
      hasForegroundService: true,
    });

    const state = await service.getNativeNotificationState();

    expect(nativeModule.getState).toHaveBeenCalled();
    expect(state).toMatchObject({
      isActive: true,
      status: "RUNNING",
      hasForegroundService: true,
      channelId: "wayper_run_tracking",
    });
  });

  test("acao com reconcile falho e evidencia ativa nao pausa nem zera estado", async () => {
    currentSnapshot = null;
    runtimeService.hydrateActiveRunFromRuntime.mockResolvedValueOnce({
      snapshot: {
        activeRunId: "recoverable-from-native",
        status: "ERROR_RECOVERABLE",
        startedAtMs: BASE_TIME,
        distanceMeters: 0,
      },
      source: "preserved_active_evidence",
      canShowStartButton: false,
    });

    const result = await service.pauseRunFromNotification();

    expect(result.status).toBe("ERROR_RECOVERABLE");
    expect(trackingService.pauseActiveRun).not.toHaveBeenCalled();
    expect(
      nativeModule.updateRunNotification.mock.calls.length +
        nativeModule.startRunNotification.mock.calls.length
    ).toBeGreaterThan(0);
  });

  test("permissao de notificacao negada ainda inicia foreground service sem painel visivel", async () => {
    notificationPermissionCheck.mockResolvedValue(false);
    notificationPermissionRequest.mockResolvedValue("denied");

    const started = await service.startRunNotification({
      elapsedTimeSeconds: 10,
      distanceKm: 0.1,
      isPaused: false,
    }, { scheduleTimer: false });

    expect(started).toBe(true);
    expect(notificationPermissionRequest).toHaveBeenCalledTimes(1);
    expect(nativeModule.startRunNotification).toHaveBeenCalledTimes(1);
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

  test("coordenador nao duplica listeners ao reentrar no app", async () => {
    currentSnapshot = runningSnapshot("free");

    const stopA = service.startRunNotificationCoordinator();
    const stopB = service.startRunNotificationCoordinator();
    await flushPromises();

    expect(stopA).toBe(stopB);
    expect(trackingService.onActiveRunSnapshot).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
  });

  test("coalesce inicializacoes concorrentes e deixa segundos para o ticker nativo", async () => {
    let releaseStart;
    nativeModule.startRunNotification.mockImplementationOnce(() => new Promise((resolve) => {
      releaseStart = resolve;
    }));

    const first = service.startRunNotification({
      elapsedTimeSeconds: 10,
      distanceKm: 1.421,
    }, { scheduleTimer: false });
    const second = service.startRunNotification({
      elapsedTimeSeconds: 11,
      distanceKm: 1.424,
    }, { scheduleTimer: false });

    await flushPromises();
    expect(nativeModule.startRunNotification).toHaveBeenCalledTimes(1);
    releaseStart(true);
    await Promise.all([first, second]);

    await service.updateRunNotification({
      elapsedTimeSeconds: 12,
      distanceKm: 1.424,
    });
    expect(nativeModule.updateRunNotification).not.toHaveBeenCalled();
  });

  test("recovery de corrida pausada restaura notificacao pausada", async () => {
    currentSnapshot = pausedSnapshot();

    service.startRunNotificationCoordinator();
    await flushPromises();

    expect(nativeModule.startRunNotification).toHaveBeenCalledTimes(1);
    expect(nativeModule.startRunNotification.mock.calls[0][0]).toMatchObject({
      isPaused: true,
      statusLabel: "Pausada",
      action: "resume",
      actionLabel: "Retomar",
    });
  });

  test("toque na notificacao abre deep link da corrida ativa sem criar rota nova", () => {
    const foregroundService = fs.readFileSync(
      path.join(process.cwd(), "android/app/src/main/java/com/wayper/app/run/RunNotificationForegroundService.kt"),
      "utf8"
    );
    const mainActivity = fs.readFileSync(
      path.join(process.cwd(), "android/app/src/main/java/com/wayper/app/MainActivity.kt"),
      "utf8"
    );

    expect(foregroundService).toContain('ACTIVE_RUN_DEEP_LINK = "wayper://run/active"');
    expect(foregroundService).toContain('EXTRA_STATUS_LABEL = "statusLabel"');
    expect(foregroundService).toContain('EXTRA_ACTION_LABEL = "actionLabel"');
    expect(foregroundService).toContain('"Pausar"');
    expect(foregroundService).toContain('"Retomar"');
    expect(foregroundService).toContain("Intent.FLAG_ACTIVITY_REORDER_TO_FRONT");
    expect(mainActivity).toContain("override fun onNewIntent");
    expect(mainActivity).toContain("setIntent(intent)");
  });

  test("foreground service restaura estado minimo quando Android recria o processo", () => {
    const foregroundService = fs.readFileSync(
      path.join(process.cwd(), "android/app/src/main/java/com/wayper/app/run/RunNotificationForegroundService.kt"),
      "utf8"
    );

    expect(foregroundService).toContain("if (intent == null)");
    expect(foregroundService).toContain("restorePersistedState()");
    expect(foregroundService).toContain("PREFERENCES_NAME");
    expect(foregroundService).toContain("START_STICKY");
    expect(foregroundService).toContain("persistState(active = false)");
  });

  test("permissoes android necessarias para notificacao e background estao declaradas", () => {
    const appConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "app.json"), "utf8"));
    const manifest = fs.readFileSync(
      path.join(process.cwd(), "android/app/src/main/AndroidManifest.xml"),
      "utf8"
    );
    const permissions = appConfig?.expo?.android?.permissions || [];

    expect(permissions).toEqual(expect.arrayContaining([
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "POST_NOTIFICATIONS",
    ]));
    expect(manifest).toContain("RunNotificationForegroundService");
    expect(manifest).toContain("android:foregroundServiceType=\"location\"");
  });
});
