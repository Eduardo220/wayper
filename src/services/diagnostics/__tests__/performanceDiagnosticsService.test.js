import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const capturePossibleFreeze = jest.fn(() => "freeze-event-id");

jest.unstable_mockModule("../../monitoring/sentryService.js", () => ({
  capturePossibleFreeze,
}));

const performanceDiagnostics = await import("../performanceDiagnosticsService.js");

describe("performance diagnostics watchdog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    performanceDiagnostics.__resetPerformanceDiagnosticsForTests();
  });

  test("detecta atraso do event loop com contexto de corrida sanitizavel", async () => {
    performanceDiagnostics.setPerformanceDiagnosticsContextProvider(async () => ({
      runId: "run-sensitive",
      status: "RUNNING",
      appState: "background",
      foregroundWatcherStatus: "started",
      backgroundTaskStatus: "started",
      notificationStatus: "active",
      pendingFlushCount: 2,
      lastRawPointReceivedAt: "2026-06-21T12:00:00.000Z",
      lastUiTickAt: "2026-06-21T12:00:01.000Z",
      distanceMeters: 1234.56,
      acceptedPointsCount: 42,
      rejectedPointsCount: 3,
    }));

    const context = await performanceDiagnostics.__samplePerformanceDiagnosticsForTests(10000);

    expect(context).toMatchObject({
      runId: "run-sensitive",
      runStatus: "RUNNING",
      appState: "background",
      watcherStatus: "started",
      backgroundTaskStatus: "started",
      notificationStatus: "active",
      pendingStorageWrites: 2,
      acceptedPointsCount: 42,
    });
    expect(capturePossibleFreeze).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-sensitive",
      runStatus: "RUNNING",
      appState: "background",
    }));
  });
});
