export const MAP_MODE = {
  default: "default",
  zones: "zones",
};

export function isZonesMode(mapMode) {
  return mapMode === MAP_MODE.zones;
}

export function createTerritoryMapModeState(overrides = {}) {
  return {
    mapMode: MAP_MODE.default,
    selectedTerritory: null,
    selectedRankingUser: null,
    panelVisible: false,
    loading: false,
    ...overrides,
  };
}

export function reduceTerritoryMapMode(state = createTerritoryMapModeState(), action = {}) {
  if (action.type === "show_zones") {
    return {
      ...state,
      mapMode: MAP_MODE.zones,
      panelVisible: action.panelVisible !== false,
      loading: Boolean(action.loading),
    };
  }

  if (action.type === "hide_zones") {
    return {
      ...state,
      mapMode: MAP_MODE.default,
      panelVisible: false,
      loading: false,
      selectedTerritory: null,
      selectedRankingUser: null,
    };
  }

  if (action.type === "select_territory") {
    return {
      ...state,
      selectedTerritory: action.territory || null,
    };
  }

  if (action.type === "select_ranking_user") {
    return {
      ...state,
      selectedRankingUser: action.user || null,
    };
  }

  return state;
}

export default {
  MAP_MODE,
  isZonesMode,
  createTerritoryMapModeState,
  reduceTerritoryMapMode,
};
