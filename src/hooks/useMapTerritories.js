import { useCallback, useEffect, useRef, useState } from "react";
import { list as listTerritories } from "../repositories/territoryRepository";
import { fetchAllRanking } from "../services/ranking";
import {
  fetchActiveTerritoriesNear,
  fetchTerritoriesByOwnerId,
  buildTerritoryBbox,
  getCellCenter,
  getCellIdForLocation,
  getCellIdsForBbox,
  getLeaderCellsForViewport,
  getLeaderboardForCell,
  mergeTerritoriesForMap,
  normalizeTerritoryBbox,
} from "../services/territory";
import { logger, LOG_CATEGORIES } from "../utils/logger.js";

const VIEWPORT_DEBOUNCE_MS = 950;
const FETCH_LIMIT = 180;
const MAX_VIEWPORT_CELLS = 140;

const signature = (items = []) => items.map((item) => [
  item?.id || item?.cellId || "",
  item?.updatedAt || item?.capturedAt || "",
  item?.version || "",
  item?.status || "",
  Math.round(Number(item?.areaM2 ?? item?.leaderAreaM2 ?? 0)),
].join(":")).join("|");

const primaryCellId = (territory) =>
  territory?.cellIds?.[0] || getCellIdForLocation(territory?.center || territory);

function useTerritoryRouteFocus({ routeParams, territories, onFocus, onPress }) {
  const lastFocusRef = useRef(null);
  useEffect(() => {
    const territoryId = routeParams?.focusTerritoryId ? String(routeParams.focusTerritoryId) : null;
    const cellId = routeParams?.focusCellId ? String(routeParams.focusCellId) : null;
    const userId = routeParams?.focusUserId ? String(routeParams.focusUserId) : null;
    const focusKey = [territoryId, cellId, userId].filter(Boolean).join("|");
    if (!focusKey || lastFocusRef.current === focusKey) return;
    const focused = territories.find((territory) =>
      (territoryId && String(territory.id) === territoryId) ||
      (userId && String(territory.ownerId || territory.userId) === userId) ||
      (cellId && territory.cellIds?.map(String).includes(cellId))
    );
    const center = focused?.center || focused?.coordsPreview?.[0] || (cellId ? getCellCenter(cellId) : null);
    if (!center) return;
    lastFocusRef.current = focusKey;
    onFocus(center);
    if (focused) onPress(focused);
  }, [onFocus, onPress, routeParams, territories]);
}

export default function useMapTerritories({
  location,
  navigation,
  routeParams,
  interactionBlocked,
  onDisableFollow,
}) {
  const [territories, setTerritories] = useState([]);
  const [leaderCells, setLeaderCells] = useState([]);
  const [selectedTerritory, setSelectedTerritory] = useState(null);
  const [selectedTerritoryLeaderboard, setSelectedTerritoryLeaderboard] = useState(null);
  const [territoryLoading, setTerritoryLoading] = useState(false);
  const [mapFocusCenter, setMapFocusCenter] = useState(null);
  const [zonesPanelVisible, setZonesPanelVisible] = useState(false);
  const [zonesPanelTab, setZonesPanelTab] = useState("mine");
  const [zonesRanking, setZonesRanking] = useState([]);
  const [zonesPanelLoading, setZonesPanelLoading] = useState(false);
  const [selectedRankingUser, setSelectedRankingUser] = useState(null);
  const mountedRef = useRef(true);
  const debounceRef = useRef(null);
  const lastFetchRef = useRef(null);
  const initialLoadRef = useRef(false);
  const selectedRequestRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const loadViewport = useCallback(async ({ bbox, force = false } = {}) => {
    const viewportBbox = normalizeTerritoryBbox(bbox) || buildTerritoryBbox(location);
    if (!viewportBbox) return;
    const fetchKey = viewportBbox.map((value) => value.toFixed(5)).join(":");
    if (!force && lastFetchRef.current === fetchKey) return;
    lastFetchRef.current = fetchKey;
    setTerritoryLoading(true);
    try {
      const cachedResult = await listTerritories({ status: "active" });
      if (mountedRef.current) {
        setTerritories((current) => {
          const next = mergeTerritoriesForMap(current, cachedResult.data || [], viewportBbox);
          return signature(current) === signature(next) ? current : next;
        });
      }
      const cellIds = getCellIdsForBbox(viewportBbox).slice(0, MAX_VIEWPORT_CELLS);
      if (!cellIds.length) return;
      const [remote, leaders] = await Promise.all([
        fetchActiveTerritoriesNear({ bbox: viewportBbox, cellIds, limitTo: FETCH_LIMIT }),
        getLeaderCellsForViewport({ bbox: viewportBbox, cellIds }),
      ]);
      if (!mountedRef.current) return;
      setTerritories((current) => {
        const next = mergeTerritoriesForMap(current, remote, viewportBbox);
        return signature(current) === signature(next) ? current : next;
      });
      setLeaderCells((current) => {
        const next = Array.isArray(leaders) ? leaders : [];
        return signature(current) === signature(next) ? current : next;
      });
    } catch (error) {
      lastFetchRef.current = null;
      logger.warn(LOG_CATEGORIES.MAP, "TERRITORY_VIEWPORT_LOAD_FAILED", { error });
    } finally {
      if (mountedRef.current) setTerritoryLoading(false);
    }
  }, [location]);

  useEffect(() => {
    if (!location || initialLoadRef.current) return;
    initialLoadRef.current = true;
    loadViewport({ bbox: buildTerritoryBbox(location), force: true });
  }, [loadViewport, location]);

  const handleTerritoryViewportChange = useCallback(({ bbox } = {}) => {
    const viewportBbox = normalizeTerritoryBbox(bbox);
    if (!viewportBbox) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadViewport({ bbox: viewportBbox }), VIEWPORT_DEBOUNCE_MS);
  }, [loadViewport]);

  const handleTerritoryPress = useCallback(async (properties = {}) => {
    if (interactionBlocked) return;
    const id = properties?.id ? String(properties.id) : null;
    const full = id ? territories.find((item) => String(item.id) === id) : null;
    const next = full ? { ...full, ...properties } : properties;
    const requestKey = id || String(Date.now());
    selectedRequestRef.current = requestKey;
    setSelectedTerritory(next);
    setSelectedTerritoryLeaderboard(null);
    const cellId = primaryCellId(next);
    if (!cellId) return;
    try {
      const leaderboard = await getLeaderboardForCell(cellId);
      if (mountedRef.current && selectedRequestRef.current === requestKey) {
        setSelectedTerritoryLeaderboard(leaderboard);
      }
    } catch (error) {
      logger.warn(LOG_CATEGORIES.MAP, "TERRITORY_LEADERBOARD_LOAD_FAILED", { error });
    }
  }, [interactionBlocked, territories]);

  const handleLeaderCellPress = useCallback((properties = {}) => {
    if (interactionBlocked) return;
    const cellId = properties?.cellId || properties?.id || null;
    navigation?.navigate("Ranking", cellId ? { cellId } : undefined);
  }, [interactionBlocked, navigation]);

  const focusRouteTerritory = useCallback((center) => {
    setMapFocusCenter(center);
    onDisableFollow?.();
  }, [onDisableFollow]);
  useTerritoryRouteFocus({
    routeParams,
    territories,
    onFocus: focusRouteTerritory,
    onPress: handleTerritoryPress,
  });

  const closeSelectedTerritory = useCallback(() => {
    selectedRequestRef.current = null;
    setSelectedTerritory(null);
    setSelectedTerritoryLeaderboard(null);
  }, []);

  const openZonesPanel = useCallback(async (tab = "mine") => {
    setZonesPanelTab(tab);
    setZonesPanelVisible(true);
    setZonesPanelLoading(true);
    try {
      const [cached, ranking] = await Promise.all([
        listTerritories({ status: "active" }),
        fetchAllRanking({ criterion: "area", limitTo: 50 }),
      ]);
      if (!mountedRef.current) return;
      setTerritories((current) => mergeTerritoriesForMap(current, cached.data || []));
      setZonesRanking(Array.isArray(ranking) ? ranking : []);
    } catch (error) {
      logger.warn(LOG_CATEGORIES.MAP, "ZONES_PANEL_LOAD_FAILED", { error });
    } finally {
      if (mountedRef.current) setZonesPanelLoading(false);
    }
  }, []);

  const focusTerritoryOnMap = useCallback((territory) => {
    if (!territory) return;
    setSelectedTerritory(territory);
    setMapFocusCenter(territory.center || territory.coordsPreview?.[0] || null);
    onDisableFollow?.();
    setZonesPanelVisible(false);
  }, [onDisableFollow]);

  const loadRankingUserZones = useCallback(async (user) => {
    const userId = user?.id || user?.userId || user?.ownerId;
    if (!userId) return;
    setZonesPanelLoading(true);
    setSelectedRankingUser(user);
    try {
      const zones = await fetchTerritoriesByOwnerId(userId, {
        limitTo: 80,
        status: "active",
        includeLocal: true,
      });
      if (!mountedRef.current) return;
      setTerritories((current) => mergeTerritoriesForMap(current, zones.map((item) => ({
        ...item,
        isLeaderTerritory: true,
      }))));
      if (zones[0]) focusTerritoryOnMap(zones[0]);
    } catch (error) {
      logger.warn(LOG_CATEGORIES.MAP, "RANKING_USER_ZONES_LOAD_FAILED", { error });
    } finally {
      if (mountedRef.current) setZonesPanelLoading(false);
    }
  }, [focusTerritoryOnMap]);

  const patchTerritory = useCallback((id, patch) => {
    setTerritories((current) => current.map((territory) =>
      String(territory.id) === String(id) ? { ...territory, ...patch } : territory
    ));
  }, []);

  return {
    territories,
    leaderCells,
    selectedTerritory,
    selectedTerritoryLeaderboard,
    territoryLoading,
    mapFocusCenter,
    zonesPanelVisible,
    zonesPanelTab,
    zonesRanking,
    zonesPanelLoading,
    selectedRankingUser,
    handleTerritoryViewportChange,
    handleTerritoryPress,
    handleLeaderCellPress,
    closeSelectedTerritory,
    clearTerritoryFocus: () => setMapFocusCenter(null),
    closeZonesPanel: () => setZonesPanelVisible(false),
    selectZonesPanelTab: setZonesPanelTab,
    openZonesPanel,
    focusTerritoryOnMap,
    loadRankingUserZones,
    patchTerritory,
  };
}
