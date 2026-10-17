import { beforeEach, expect, jest, test } from "@jest/globals";
let effects = [], focused = true;
const hasActiveRunSnapshot = jest.fn();
const warn = jest.fn();
jest.unstable_mockModule("react", () => ({
  useCallback: fn => fn,
  useEffect: fn => effects.push(fn),
}));
jest.unstable_mockModule("@react-navigation/native", () => ({ useIsFocused: () => focused }));
jest.unstable_mockModule("../../services/runTracking/activeRunTrackingService.js", () => ({
  hasActiveRunSnapshot,
}));
jest.unstable_mockModule("../../services/territory/index.js", () => ({ getCellIdForLocation: jest.fn() }));
jest.unstable_mockModule("../../utils/logger.js", () => ({
  logger: { warn }, LOG_CATEGORIES: { RUN_SESSION: "RUN_SESSION" },
}));
const { default: useMapScreenActions } = await import("../useMapScreenActions.js");
let context;
beforeEach(() => {
  effects = []; focused = true; jest.clearAllMocks();
  context = { navigation: { setParams: jest.fn(), isFocused: () => focused }, route: { params: { runEntryRequestId: 7 } },
    runEntryReady: true, isRunStartBusy: false, setSelectModeVisible: jest.fn() };
});
function TestHarness() { return useMapScreenActions(context); }
async function mount() {
  TestHarness();
  const cleanup = effects[0]();
  await Promise.resolve();
  return cleanup;
}
test("idle Correr entry opens the same mode selector and consumes the request", async () => {
  hasActiveRunSnapshot.mockResolvedValue(false);
  await mount();
  expect(context.setSelectModeVisible).toHaveBeenCalledWith(true);
  expect(context.navigation.setParams).toHaveBeenCalledWith({ runEntryRequestId: undefined });
});
test("a session appearing during navigation routes to existing reentry instead of start", async () => {
  hasActiveRunSnapshot.mockResolvedValue(true);
  await mount();
  expect(context.setSelectModeVisible).not.toHaveBeenCalled();
  expect(context.navigation.setParams).toHaveBeenCalledWith({ runEntryRequestId: undefined, activeRunOpenRequestId: 7,
    fromRunNotification: false, fromDeepLink: false });
});
test.each(["hydrating", "blurred", "busy"])("%s entry cannot open the start selector", async state => {
  hasActiveRunSnapshot.mockResolvedValue(false);
  if (state === "hydrating") context.runEntryReady = false;
  if (state === "blurred") focused = false;
  if (state === "busy") context.isRunStartBusy = true;
  await mount();
  expect(context.setSelectModeVisible).not.toHaveBeenCalled();
});
test("blur/unmount while reading cancels late selector and reentry actions", async () => {
  let resolve;
  hasActiveRunSnapshot.mockImplementation(() => new Promise(r => { resolve = r; }));
  const cleanup = await mount(); cleanup(); resolve(false); await Promise.resolve();
  expect(context.setSelectModeVisible).not.toHaveBeenCalled();
  expect(context.navigation.setParams).not.toHaveBeenCalled();
});
test("unknown storage state never opens selection", async () => {
  const error = new Error("read failed");
  hasActiveRunSnapshot.mockRejectedValue(error);
  await mount(); await Promise.resolve();
  expect(warn).toHaveBeenCalledWith("RUN_SESSION", "RUN_TAB_OPEN_FAILED", { error });
  expect(context.setSelectModeVisible).not.toHaveBeenCalled();
});

test("leaving Map during hydration consumes the pending entry without reading storage", async () => {
  context.runEntryReady = false;
  const cleanup = await mount(); focused = false; cleanup();
  expect(hasActiveRunSnapshot).not.toHaveBeenCalled();
  expect(context.navigation.setParams).toHaveBeenCalledWith({ runEntryRequestId: undefined });
});
test("leaving Map cancels a pending active-session response and clears the entry", async () => {
  let resolve;
  hasActiveRunSnapshot.mockImplementation(() => new Promise(r => { resolve = r; }));
  const cleanup = await mount(); focused = false; cleanup(); resolve(true); await Promise.resolve();
  expect(context.navigation.setParams.mock.calls).toEqual([[{ runEntryRequestId: undefined }]]);
  expect(context.setSelectModeVisible).not.toHaveBeenCalled();
});
test("hydration changes while Map remains focused retain the entry for the ready handler", async () => {
  context.runEntryReady = false;
  const cleanup = await mount(); cleanup();
  expect(context.navigation.setParams).not.toHaveBeenCalled();
});
