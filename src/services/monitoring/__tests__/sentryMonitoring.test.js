import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const scope = {
  setContext: jest.fn(),
  setLevel: jest.fn(),
  setTag: jest.fn(),
};
const span = {
  end: jest.fn(),
  setAttribute: jest.fn(),
};
const sentryMock = {
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(() => "exception-event-id"),
  captureMessage: jest.fn(() => "message-event-id"),
  flush: jest.fn(async () => true),
  init: jest.fn(),
  setContext: jest.fn(),
  setTag: jest.fn(),
  setUser: jest.fn(),
  startInactiveSpan: jest.fn(() => span),
  startSpan: jest.fn((_options, callback) => callback(span)),
  withScope: jest.fn((callback) => callback(scope)),
  wrap: jest.fn((component) => component),
};

jest.unstable_mockModule("@sentry/react-native", () => sentryMock);
jest.unstable_mockModule("expo-constants", () => ({
  default: {
    executionEnvironment: "bare",
    expoConfig: {
      version: "1.2.3",
      android: {
        package: "com.wayper.app",
        versionCode: 42,
      },
    },
  },
}));
jest.unstable_mockModule("react-native", () => ({
  Platform: { OS: "android" },
}));

const sanitizer = await import("../sentrySanitizer.js");
const bridge = await import("../monitoringBridge.js");
const monitoring = await import("../sentryService.js");

function enabledConfig(overrides = {}) {
  return {
    dsn: "https://public@example.ingest.sentry.io/1",
    environment: "production",
    ...overrides,
  };
}

describe("Sentry monitoring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    monitoring.__setSentryClientForTests(sentryMock);
    monitoring.__resetMonitoringForTests();
  });

  test("nao inicializa SDK sem DSN", () => {
    const status = monitoring.initializeMonitoring({
      dsn: "",
      environment: "production",
    });

    expect(status).toMatchObject({
      attempted: true,
      initialized: false,
      enabled: false,
      dsnConfigured: false,
    });
    expect(sentryMock.init).not.toHaveBeenCalled();
  });

  test("configura ambientes e sampling com defaults seguros", () => {
    expect(monitoring.resolveMonitoringConfig({
      dsn: "dsn",
    })).toMatchObject({
      environment: "production",
      enabled: true,
      tracesSampleRate: 0.08,
    });

    expect(monitoring.resolveMonitoringConfig({
      dsn: "dsn",
      environment: "development",
      enableDevelopment: false,
    })).toMatchObject({
      environment: "development",
      enabled: false,
      tracesSampleRate: 0.2,
    });

    expect(monitoring.resolveMonitoringConfig({
      dsn: "dsn",
      environment: "development",
      enableDevelopment: true,
    })).toMatchObject({
      environment: "development",
      enabled: true,
      tracesSampleRate: 0.2,
    });

    expect(monitoring.resolveMonitoringConfig({
      dsn: "dsn",
      environment: "preview",
    })).toMatchObject({
      environment: "preview",
      enabled: true,
      tracesSampleRate: 0.15,
      release: "com.wayper.app@1.2.3+42",
      dist: "42",
    });

    expect(monitoring.resolveMonitoringConfig({
      dsn: "dsn",
      environment: "production",
    })).toMatchObject({
      environment: "production",
      enabled: true,
      tracesSampleRate: 0.08,
    });
  });

  test("beforeSend remove coordenadas, rotas, tokens, auth, email e telefone", () => {
    monitoring.initializeMonitoring(enabledConfig());
    const options = sentryMock.init.mock.calls[0][0];
    const sanitized = options.beforeSend({
      user: {
        id: "firebase-user-123",
        email: "runner@example.com",
      },
      request: {
        url: "https://api.example.com/run?token=query-secret",
        headers: {
          authorization: "Bearer header-secret",
        },
      },
      contexts: {
        run: {
          runId: "run-real-id",
          latitude: -30.123456,
          longitude: -51.123456,
          routePoints: [{ latitude: -30, longitude: -51 }],
          refreshToken: "refresh-secret",
          note: "runner@example.com +55 11 99999-9999 latitude=-30.765432 longitude=-51.765432 refreshToken=inside-text-secret",
          authDebug: "Authorization: Bearer inline-header-secret",
          tokenDebug: "accessToken: inline-access-secret",
          endpoint: "https://api.example.com/sync?access_token=another-secret",
        },
      },
    });
    const json = JSON.stringify(sanitized);

    expect(json).not.toContain("-30.123456");
    expect(json).not.toContain("-51.123456");
    expect(json).not.toContain("run-real-id");
    expect(json).not.toContain("refresh-secret");
    expect(json).not.toContain("header-secret");
    expect(json).not.toContain("query-secret");
    expect(json).not.toContain("runner@example.com");
    expect(json).not.toContain("99999-9999");
    expect(json).not.toContain("-30.765432");
    expect(json).not.toContain("-51.765432");
    expect(json).not.toContain("another-secret");
    expect(json).not.toContain("inside-text-secret");
    expect(json).not.toContain("inline-header-secret");
    expect(json).not.toContain("inline-access-secret");
    expect(sanitized.user.id).toMatch(/^anon_/);
    expect(sanitized.request.url).toBe("https://api.example.com/run");
  });

  test("sanitizador limita payloads grandes e NDJSON bruto", () => {
    const sanitized = sanitizer.sanitizeSentryContext({
      ndjson: "{\"latitude\":-30}",
      zip: "diagnostics.zip",
      image: "data:image/png;base64,secret",
      snapshot: { rawPath: Array.from({ length: 500 }, () => ({ latitude: -30 })) },
      values: Array.from({ length: 50 }, (_, index) => index),
    });

    expect(sanitized.ndjson).toContain("redacted_payload");
    expect(sanitized.zip).toContain("redacted_payload");
    expect(sanitized.image).toContain("redacted_payload");
    expect(sanitized.snapshot).toContain("redacted_payload");
    expect(sanitized.values).toHaveLength(21);
    expect(sanitized.values[20]).toEqual({ truncatedItems: 30 });
  });

  test("sanitizador preserva a estrutura dos frames do stack trace", () => {
    const sanitized = sanitizer.sanitizeSentryEvent({
      exception: {
        values: [{
          type: "Error",
          value: "Wayper controlled Sentry test event",
          stacktrace: {
            frames: [{
              filename: "src/services/monitoring/sentryService.js",
              function: "sendMonitoringTestEvent",
              lineno: 123,
              context_line: "token=actual-token-value latitude=-30.123456 runner@example.com",
            }],
          },
        }],
      },
    });

    const frame = sanitized.exception.values[0].stacktrace.frames[0];
    expect(frame).toMatchObject({
      filename: "src/services/monitoring/sentryService.js",
      function: "sendMonitoringTestEvent",
      lineno: 123,
    });
    expect(typeof frame).toBe("object");
    expect(frame.context_line).not.toContain("actual-token-value");
    expect(frame.context_line).not.toContain("-30.123456");
    expect(frame.context_line).not.toContain("runner@example.com");
  });

  test("logger envia error e fatal, ignora info/debug e limita warning", () => {
    monitoring.initializeMonitoring(enabledConfig());

    bridge.forwardLogToMonitoring({
      level: "debug",
      category: "LOCATION",
      event: "LOCATION_POINT_RECEIVED",
      context: { latitude: -30 },
    });
    bridge.forwardLogToMonitoring({
      level: "info",
      category: "RUN_SESSION",
      event: "RUN_STARTED",
      context: { runId: "run-1" },
    });
    bridge.forwardLogToMonitoring({
      level: "warn",
      category: "PERMISSION",
      event: "LOCATION_PERMISSION_DENIED",
      context: { status: "denied" },
    });
    bridge.forwardLogToMonitoring({
      level: "warn",
      category: "PERMISSION",
      event: "LOCATION_PERMISSION_DENIED",
      context: { status: "denied" },
    });
    bridge.forwardLogToMonitoring({
      level: "error",
      category: "SYNC",
      event: "RUN_SYNC_FAILED",
      context: {},
    }, { error: new Error("sync failed") });
    bridge.forwardLogToMonitoring({
      level: "fatal",
      category: "UNKNOWN",
      event: "FATAL_TEST",
      context: {},
    }, { error: new Error("fatal failed") });

    expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException).toHaveBeenCalledTimes(2);
    expect(sentryMock.addBreadcrumb).toHaveBeenCalled();
  });

  test("GPS de alta frequencia e agregado antes de virar breadcrumb", () => {
    monitoring.initializeMonitoring(enabledConfig());
    const initialBreadcrumbs = sentryMock.addBreadcrumb.mock.calls.length;
    const initialSpans = sentryMock.startInactiveSpan.mock.calls.length;

    ["LOCATION_POINT_RECEIVED", "LOCATION_POINT_ACCEPTED", "LOCATION_POINT_REJECTED"].forEach(
      (event) => bridge.forwardLogToMonitoring({
        level: event.endsWith("REJECTED") ? "warn" : "debug",
        category: "LOCATION",
        event,
        context: {
          latitude: -30.123456,
          longitude: -51.123456,
        },
      })
    );

    expect(sentryMock.addBreadcrumb).toHaveBeenCalledTimes(initialBreadcrumbs);
    expect(sentryMock.startInactiveSpan).toHaveBeenCalledTimes(initialSpans);
    expect(sentryMock.captureMessage).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();

    monitoring.__flushLocationBreadcrumbsForTests();
    const breadcrumb = sentryMock.addBreadcrumb.mock.calls
      .map(([item]) => item)
      .find((item) => item.message === "LOCATION_UPDATES_THROTTLED");
    expect(breadcrumb).toMatchObject({
      category: "wayper.location",
      data: expect.objectContaining({
        counts: expect.objectContaining({
          LOCATION_POINT_RECEIVED: 1,
          LOCATION_POINT_ACCEPTED: 1,
          LOCATION_POINT_REJECTED: 1,
        }),
      }),
    });
  });

  test("breadcrumbs cobrem lifecycle, corrida, background, mapa e compartilhamento", () => {
    monitoring.initializeMonitoring(enabledConfig());
    const expectedEvents = [
      "RUN_STARTED",
      "PAUSE_SUCCESS",
      "RESUME_SUCCESS",
      "FINISH_SUCCESS",
      "RUN_SAVED_LOCAL",
      "RUN_SYNC_SUCCESS",
      "LOCATION_PERMISSION_DENIED",
      "APP_BACKGROUND",
      "RUN_BACKGROUND_TASK_STARTED",
      "RUN_NOTIFICATION_STARTED",
      "RUN_NOTIFICATION_OPEN_RESTORE_STARTED",
      "RUN_RECONCILE_STARTED",
      "RUN_UI_POSSIBLE_FREEZE_DETECTED",
      "MAP_ERROR",
      "SHARE_FAILED",
    ];

    expectedEvents.forEach((event) => {
      bridge.forwardLogToMonitoring({
        level: "info",
        category: "TEST",
        event,
        context: { pointCount: 12 },
      });
    });

    const messages = sentryMock.addBreadcrumb.mock.calls.map(([breadcrumb]) => breadcrumb.message);
    expect(messages).toEqual(expect.arrayContaining(["APP_STARTED", ...expectedEvents]));
  });

  test("breadcrumbs sempre passam pelo sanitizador remoto", () => {
    monitoring.initializeMonitoring(enabledConfig());

    bridge.forwardLogToMonitoring({
      level: "info",
      category: "RUN_SESSION",
      event: "RUN_STARTED",
      context: {
        runId: "run-secret",
        latitude: -30.5,
        token: "token-secret",
        email: "runner@example.com",
      },
    });

    const breadcrumb = sentryMock.addBreadcrumb.mock.calls
      .map(([item]) => item)
      .find((item) => item.message === "RUN_STARTED");
    const json = JSON.stringify(breadcrumb);
    expect(json).not.toContain("run-secret");
    expect(json).not.toContain("-30.5");
    expect(json).not.toContain("token-secret");
    expect(json).not.toContain("runner@example.com");
  });

  test("breadcrumbs automaticos de console sao descartados", () => {
    monitoring.initializeMonitoring(enabledConfig());
    const options = sentryMock.init.mock.calls[0][0];

    expect(options.beforeBreadcrumb({
      category: "console",
      level: "debug",
      data: {
        arguments: ["LOCATION_POINT_RECEIVED", { latitude: -30.5 }],
      },
    })).toBeNull();
    expect(options.beforeBreadcrumb({
      category: "wayper.run_session",
      message: "RUN_STARTED",
    })).toMatchObject({
      category: "wayper.run_session",
      message: "RUN_STARTED",
    });
  });

  test("sanitizador preserva apenas contexto operacional resumido", () => {
    const sanitized = sanitizer.sanitizeSentryContext({
      environment: "staging",
      appVersion: "1.2.3",
      buildNumber: "42",
      platform: "android",
      runState: "running",
      pointCount: 18,
      reason: "storage unavailable",
      category: "STORAGE",
      runId: "run-sensitive",
      userId: "user-sensitive",
      runIds: ["run-sensitive-1", "run-sensitive-2"],
    });

    expect(sanitized).toMatchObject({
      environment: "staging",
      appVersion: "1.2.3",
      buildNumber: "42",
      platform: "android",
      runState: "running",
      pointCount: 18,
      reason: "storage unavailable",
      category: "STORAGE",
    });
    expect(sanitized.runId).toMatch(/^run_/);
    expect(sanitized.userId).toMatch(/^user_/);
    expect(sanitized.runId).not.toContain("sensitive");
    expect(sanitized.userId).not.toContain("sensitive");
    expect(sanitized.runIds).toHaveLength(2);
    expect(sanitized.runIds.every((value) => /^run_/.test(value))).toBe(true);
    expect(JSON.stringify(sanitized.runIds)).not.toContain("sensitive");
  });

  test("captureException nao quebra o app se o SDK falhar", () => {
    monitoring.initializeMonitoring(enabledConfig());
    sentryMock.captureException.mockImplementationOnce(() => {
      throw new Error("Sentry unavailable");
    });

    expect(() => monitoring.captureException(new Error("app error"), {
      category: "TEST",
      event: "SDK_FAILURE",
    })).not.toThrow();
    expect(monitoring.captureException(new Error("next error"))).toBe("exception-event-id");
  });

  test("captureRunError envia contexto de corrida sanitizado", () => {
    monitoring.initializeMonitoring(enabledConfig());

    const eventId = monitoring.captureRunError(new Error("watcher failed"), {
      event: "FOREGROUND_WATCHER_FAILED",
      runId: "run-sensitive",
      runStatus: "RUNNING",
      latitude: -30.123456,
      longitude: -51.123456,
      tags: {
        appState: "background",
      },
    });

    expect(eventId).toBe("exception-event-id");
    expect(scope.setTag).toHaveBeenCalledWith("feature", "run_tracking");
    expect(scope.setTag).toHaveBeenCalledWith("runStatus", "RUNNING");
    const contextCall = scope.setContext.mock.calls.find(([name]) => name === "wayper");
    const json = JSON.stringify(contextCall?.[1]);
    expect(json).not.toContain("run-sensitive");
    expect(json).not.toContain("-30.123456");
    expect(json).not.toContain("-51.123456");
  });

  test("setMonitoringUser anonimiza usuario antes de enviar ao SDK", () => {
    monitoring.initializeMonitoring(enabledConfig());

    expect(monitoring.setMonitoringUser({ uid: "firebase-user-123", email: "runner@example.com" })).toBe(true);

    expect(sentryMock.setUser).toHaveBeenCalledWith({
      id: expect.stringMatching(/^user_/),
    });
    expect(JSON.stringify(sentryMock.setUser.mock.calls[0][0])).not.toContain("firebase-user-123");
    expect(JSON.stringify(sentryMock.setUser.mock.calls[0][0])).not.toContain("runner@example.com");
  });

  test("traceAsync executa operacao mesmo se o SDK falhar", async () => {
    monitoring.initializeMonitoring(enabledConfig());
    sentryMock.startInactiveSpan.mockImplementationOnce(() => {
      throw new Error("tracing unavailable");
    });
    const operation = jest.fn(async () => "saved");

    await expect(monitoring.traceAsync(
      "Save run",
      "wayper.run.save",
      { runId: "run-sensitive" },
      operation
    )).resolves.toBe("saved");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
