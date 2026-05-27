import { describe, expect, test } from "@jest/globals";
import {
  MAP_MODE,
  createTerritoryMapModeState,
  isZonesMode,
  reduceTerritoryMapMode,
} from "../territoryMapMode.js";

describe("territoryMapMode", () => {
  test("estado inicial abre mapa limpo", () => {
    const state = createTerritoryMapModeState();

    expect(state.mapMode).toBe(MAP_MODE.default);
    expect(isZonesMode(state.mapMode)).toBe(false);
    expect(state.panelVisible).toBe(false);
    expect(state.selectedTerritory).toBeNull();
    expect(state.selectedRankingUser).toBeNull();
  });

  test("show_zones ativa modo territorial", () => {
    const state = reduceTerritoryMapMode(createTerritoryMapModeState(), {
      type: "show_zones",
      loading: true,
    });

    expect(state.mapMode).toBe(MAP_MODE.zones);
    expect(state.panelVisible).toBe(true);
    expect(state.loading).toBe(true);
  });

  test("hide_zones volta ao mapa limpo e limpa selecoes", () => {
    const state = reduceTerritoryMapMode(
      createTerritoryMapModeState({
        mapMode: MAP_MODE.zones,
        panelVisible: true,
        loading: true,
        selectedTerritory: { id: "t1" },
        selectedRankingUser: { id: "u1" },
      }),
      { type: "hide_zones" }
    );

    expect(state.mapMode).toBe(MAP_MODE.default);
    expect(state.panelVisible).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.selectedTerritory).toBeNull();
    expect(state.selectedRankingUser).toBeNull();
  });
});
