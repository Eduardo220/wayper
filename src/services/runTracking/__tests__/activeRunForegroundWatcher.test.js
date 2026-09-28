import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.unstable_mockModule("expo-location", () => ({
  Accuracy: { BestForNavigation: 6, Highest: 5, High: 4 },
}));
jest.unstable_mockModule("react-native", () => ({ Platform: { OS: "android" } }));
jest.unstable_mockModule("../../permissions", () => ({
  checkLocationPermission: jest.fn(async () => ({ granted: true })),
}));
jest.unstable_mockModule("../expoLocation.js", () => ({
  enableNetworkProviderForRun: jest.fn(async () => true),
  getRunWatchPositionOptions: jest.fn((_api, options) => options),
}));

const watcher = await import("../activeRunForegroundWatcher.js");

describe("activeRunForegroundWatcher", () => {
  beforeEach(() => watcher.__resetForegroundWatcherForTests());

  test("mantem um unico owner e cerca callback tardio apos stop", async () => {
    let callback = null;
    const remove = jest.fn();
    const onLocation = jest.fn();
    const locationApi = {
      Accuracy: { BestForNavigation: 6, Highest: 5, High: 4 },
      watchPositionAsync: jest.fn(async (_options, next) => {
        callback = next;
        return { remove };
      }),
    };

    await watcher.startForegroundWatcher({
      runId: "run-1",
      locationApi,
      checkPermission: async () => ({ granted: true }),
      isRunActive: (runId) => runId === "run-1",
      onLocation,
    });
    watcher.stopForegroundWatcher();
    callback({ coords: { latitude: -30, longitude: -51 }, timestamp: 1 });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(onLocation).not.toHaveBeenCalled();
    expect(watcher.isForegroundWatcherActive()).toBe(false);
  });
});
