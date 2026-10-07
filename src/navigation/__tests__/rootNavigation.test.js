import { beforeEach, expect, jest, test } from "@jest/globals";

const navigate = jest.fn();
let ready = true;
const navigationRef = {
  isReady: () => ready,
  getRootState: () => ({ routeNames: ["Main"] }),
  navigate,
};
const recordDeepLinkReceived = jest.fn();

jest.unstable_mockModule("@react-navigation/native", () => ({
  createNavigationContainerRef: () => navigationRef,
}));
jest.unstable_mockModule("../../services/runTracking/activeRunRuntimeService.js", () => ({
  recordDeepLinkReceived,
}));

const navigation = await import("../rootNavigation.js");

beforeEach(() => {
  ready = true;
  jest.clearAllMocks();
});

test("deep link abre a unica rota Mapa sem acionar start de corrida", () => {
  expect(navigation.handleNavigationUrl("wayper://run/active?source=notification")).toBe(true);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith("Main", expect.objectContaining({
    screen: "Mapa",
    params: expect.objectContaining({ fromDeepLink: true, fromRunNotification: true }),
  }));
  expect(recordDeepLinkReceived).toHaveBeenCalledTimes(1);
});

test("deep link aguarda Main quando mapa ainda nao montou", () => {
  ready = false;
  expect(navigation.handleNavigationUrl("wayper://run/active")).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
  ready = true;
  navigation.flushPendingNavigation();
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith("Main", expect.objectContaining({ screen: "Mapa" }));
});
