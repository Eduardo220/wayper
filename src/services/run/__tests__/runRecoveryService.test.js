import { describe, expect, jest, test } from "@jest/globals";

jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => {}),
    removeItem: jest.fn(async () => {}),
  },
}));

const {
  RUN_RECOVERY_SOURCE,
  RUN_RECOVERY_STATUS,
  buildRecoverySummary,
  createRecoveryCandidate,
  validateRecoverableRun,
} = await import("../runRecoveryService.js");

const BASE_RUN = {
  activeRunId: "run-recovery-1",
  userId: "user-1",
  mode: "free",
  status: "RUNNING",
  startedAt: "2026-06-03T10:00:00.000Z",
  lastUpdatedAt: "2026-06-03T10:03:00.000Z",
  durationSeconds: 180,
  distanceMeters: 420,
  trustedPath: [
    { latitude: -23.56, longitude: -46.64, timestamp: 1000 },
    { latitude: -23.5605, longitude: -46.6404, timestamp: 2000 },
  ],
};

describe("runRecoveryService", () => {
  test("detecta corrida running recuperavel", () => {
    const candidate = createRecoveryCandidate(RUN_RECOVERY_SOURCE.TRACKING, BASE_RUN, {
      userId: "user-1",
    });

    expect(candidate.recoverable).toBe(true);
    expect(candidate.status).toBe(RUN_RECOVERY_STATUS.RUNNING);
    expect(candidate.pointsCount).toBe(2);
    expect(buildRecoverySummary(candidate).distanceMeters).toBe(420);
  });

  test("detecta corrida paused recuperavel", () => {
    const candidate = createRecoveryCandidate(
      RUN_RECOVERY_SOURCE.OFFLINE,
      {
        ...BASE_RUN,
        activeRunId: undefined,
        localRunId: "offline-paused",
        status: "PAUSED",
        schemaVersion: 1,
      },
      { userId: "user-1" }
    );

    expect(candidate.recoverable).toBe(true);
    expect(candidate.status).toBe(RUN_RECOVERY_STATUS.PAUSED);
  });

  test("mantem corrida finished pendingSync como recuperavel para sincronizacao", () => {
    const candidate = createRecoveryCandidate(
      RUN_RECOVERY_SOURCE.OFFLINE,
      {
        ...BASE_RUN,
        activeRunId: undefined,
        localRunId: "offline-finished",
        status: "PENDING_SYNC",
        pendingSync: true,
        schemaVersion: 1,
      },
      { userId: "user-1" }
    );

    expect(candidate.recoverable).toBe(true);
    expect(candidate.status).toBe(RUN_RECOVERY_STATUS.PENDING_SYNC);
    expect(candidate.pendingSync).toBe(true);
  });

  test("recusa recovery de outro usuario", () => {
    const validation = validateRecoverableRun(BASE_RUN, {
      source: RUN_RECOVERY_SOURCE.TRACKING,
      userId: "user-2",
    });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain("user_mismatch");
  });

  test("dados corrompidos nao quebram e oferecem razoes claras", () => {
    const validation = validateRecoverableRun(
      {
        localRunId: "broken",
        userId: "user-1",
        status: "RUNNING",
        startedAt: "not-a-date",
        points: [{ latitude: "x", longitude: null }],
        schemaVersion: 1,
      },
      { source: RUN_RECOVERY_SOURCE.OFFLINE, userId: "user-1" }
    );

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toEqual(expect.arrayContaining(["invalid_started_at", "empty_payload"]));
  });
});
