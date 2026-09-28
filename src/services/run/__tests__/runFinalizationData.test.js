import { describe, expect, test } from "@jest/globals";
import { buildFinishedRunData } from "../runFinalizationData.js";

describe("runFinalizationData", () => {
  test("deriva registro final do snapshot canonico sem depender da tela", () => {
    const startedAtMs = 1_700_000_000_000;
    const result = buildFinishedRunData({
      runId: "run-1",
      mode: "free",
      finishedAtMs: startedAtMs + 60_000,
      snapshot: {
        activeRunId: "run-1",
        startedAtMs,
        distanceMeters: 100,
        trustedPath: [
          { latitude: -30, longitude: -51, timestamp: startedAtMs },
          { latitude: -30.001, longitude: -51.001, timestamp: startedAtMs + 60_000 },
        ],
      },
    });

    expect(result.runData).toMatchObject({
      id: "run-1",
      status: "completed",
      distanceMeters: 100,
      durationSeconds: 60,
      mode: "free",
    });
    expect(result.runData.trustedPath).toHaveLength(2);
  });
});
