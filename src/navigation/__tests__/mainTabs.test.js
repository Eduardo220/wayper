import { beforeEach, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import { DrawerRouter, CommonActions } from "@react-navigation/routers";

const { MAIN_TABS, openRunEntry } = await import("../mainTabsRoutes.js");
const source = fs.readFileSync(new URL("../MainNavigator.js", import.meta.url), "utf8");
beforeEach(() => jest.clearAllMocks());

test("MainTabs has exactly the five approved entries, with Correr as Mapa action", () => {
  expect(MAIN_TABS.map(t => t.name)).toEqual(["Home", "Mapa", "Correr", "Ranking", "Perfil"]);
  expect(MAIN_TABS.filter(t => t.route === "Mapa").map(t => t.name)).toEqual(["Mapa", "Correr"]);
  expect(source.match(/component=\{MapScreen\}/g)).toHaveLength(1);
  expect(source).toContain('layout={(props) => <MainTabs {...props} />}');
  expect(source).not.toContain('name="Correr"');
});

test("Correr synchronously focuses the existing Map entry without querying or creating a session", () => {
  const navigation = { navigate: jest.fn() };
  openRunEntry(navigation);
  expect(navigation.navigate).toHaveBeenCalledWith("Mapa", { runEntryRequestId: expect.any(Number) });
});

test("fast repeated Correr requests have distinct navigation identities", () => {
  const navigation = { navigate: jest.fn() };
  openRunEntry(navigation); openRunEntry(navigation);
  const ids = navigation.navigate.mock.calls.map(c => c[1].runEntryRequestId);
  expect(new Set(ids).size).toBe(2);
});

test("selecting Perfil after Correr cannot be overridden by a late snapshot read", async () => {
  const navigation = { navigate: jest.fn() };
  openRunEntry(navigation); navigation.navigate("Perfil"); await Promise.resolve();
  expect(navigation.navigate.mock.calls.map(c => c[0])).toEqual(["Mapa", "Perfil"]);
});

test("Drawer route identities and Ranking's nested profile/filter state survive tab switches", () => {
  const router = DrawerRouter({ backBehavior: "none" });
  const options = { routeNames: ["Inicio", "Mapa", "Ranking", "Perfil", "Corridas"], routeParamList: {}, routeGetIdList: {} };
  let state = router.getInitialState(options);
  state = router.getStateForAction(state, CommonActions.navigate("Ranking"), options);
  const ranking = state.routes.find(r => r.name === "Ranking");
  ranking.state = { index: 1, routes: [
    { key: "ranking-home", name: "RankingHome", params: { scope: "regional", period: "monthly" } },
    { key: "public-profile", name: "PlayerProfile", params: { playerId: "test-player" } },
  ] };
  for (const name of ["Mapa", "Inicio", "Perfil", "Ranking"]) {
    state = router.getStateForAction(state, CommonActions.navigate(name), options);
  }
  expect(state.routes.find(r => r.name === "Ranking")).toBe(ranking);
  expect(ranking.state.routes[0].params).toEqual({ scope: "regional", period: "monthly" });
  expect(router.getStateForAction(state, CommonActions.goBack(), options)).toBeNull();
});

test("own profile and legacy Drawer destinations remain registered", () => {
  expect(source).toContain('name="Perfil" component={ProfileScreen}');
  for (const route of ["Inicio", "Mapa", "Corridas", "Dashboard", "Ranking", "Amigos", "Grupos", "Configuracoes"]) {
    expect(source).toContain('name="' + route + '"');
  }
  expect(fs.readFileSync(new URL("../../screens/ProfileScreen.js", import.meta.url), "utf8")).toContain("loadCurrentProfile");
});
