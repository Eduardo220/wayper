// MapScreen.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  Alert,
  AppState,
  Animated,
  Platform,
} from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Svg, {
  Circle as SvgCircle,
  Defs,
  Line as SvgLine,
  LinearGradient as SvgLinearGradient,
  Path as SvgPath,
  Polygon as SvgPolygon,
  Polyline as SvgPolyline,
  Rect as SvgRect,
  Stop,
} from "react-native-svg";
import WayperMapLibre, { WAYPER_FALLBACK_COORD } from "../components/Map/WayperMapLibre";
import RunShareModal from "../components/Runs/RunShareModal";
import RunShareCard, { RUN_SHARE_CARD_SIZE } from "../components/Runs/RunShareCard";
import RunSummaryModal from "../components/Runs/RunSummaryModal";
import TerritoryBottomSheet from "../components/Territory/TerritoryBottomSheet";
import { WPButton } from "../components/ui";
import { WayperTheme } from "../theme/wayperTheme";
import { auth } from "../firebaseConfig";
import formatTime from "../utils/formatTime";
import {
  TRACKING_CONFIG,
  debugTracking,
  limitPathForRendering,
  normalizeLocation,
  sanitizeRunPath,
  smoothDisplayPath,
  splitPathIntoSegments,
} from "../utils/tracking";
import zones from "../utils/zones";
import sync from "../utils/sync";
import { calculateRouteDistance, finalizeRoutePath } from "../utils/routeDrawing";
import {
  assertTraceHasEnoughPoints,
  captureRunShareImage,
  generateTracePngFromPath,
  getShareUnavailableMessage,
  logShareDiagnostics,
  logShareError,
  saveImageToMediaLibrary,
  shareImageFile,
  showShareError,
} from "../utils/share/runShareExport";
import { getFormattedPace } from "../utils/pace";
import { getRunDisplayTitle } from "../utils/runDisplayTitle";
import { isRunOwnedByCurrentUser } from "../utils/runOwnership";
import {
  buildRunReplayTimeline,
  getReplayIndexForElapsed,
  getReplayRunStats,
} from "../utils/runReplay";
import xpService from "../services/xp/xpService";
import { updateProfileStats, updateTerritoryProfileStats } from "../services/profile/profileService";
import {
  buildSummaryRenderPath,
  createTrackingSession,
  getRenderablePathForRun,
} from "../services/tracking";
import {
  fetchActiveTerritoriesNear,
  getCellCenter,
  getCellIdForLocation,
  getCellIdsForBbox,
  getLeaderCellsForViewport,
  getLeaderboardForCell,
  loadLocalTerritories,
  processRunTerritoryCapture,
} from "../services/territory";

/* Tunáveis */
const MAX_GPS_ACCURACY_M = TRACKING_CONFIG.GPS_ACCURACY_HARD_REJECT_M;
const FLUSH_INTERVAL_MS = 300;
const WATCH_TIME_INTERVAL_MS = 1000;
const WATCH_DISTANCE_INTERVAL = 2.5;
const INITIAL_REGION_DELTA = 0.001;
const COUNTDOWN_DEFAULT = 3;
const WAYPER_GREEN = WayperTheme.colors.primary;
const ROUTE_CAP = 8000;
const MAX_RUNNING_SPEED_MPS = TRACKING_CONFIG.MAX_HUMAN_SPRINT_SPEED_KMH / 3.6;
const ZONE_PREVIEW_INTERVAL_MS = 1400;
const BACKGROUND_LOCATION_TASK = "WAYPER_ACTIVE_RUN_LOCATION";
const FOLLOW_MAP_ZOOM = 17.2;
const FOLLOW_ANIMATION_DURATION = 450;
const REPLAY_FOLLOW_ZOOM = 18.1;
const REPLAY_CAMERA_ANIMATION_DURATION = 240;
const REPLAY_CAMERA_MOVE_INTERVAL_MS = 180;
const REPLAY_SPEED_OPTIONS = [1, 2, 3, 4, 5];
const RECENTER_ANIMATION_DURATION = 700;
const MIN_CAMERA_MOVE_INTERVAL_MS = 900;
const TERRITORY_VIEWPORT_DEBOUNCE_MS = 950;
const TERRITORY_INITIAL_BBOX_DELTA = 0.018;
const TERRITORY_FETCH_LIMIT = 180;
const TERRITORY_MAX_VIEWPORT_CELLS = 140;

let backgroundLocationUpdateHandler = null;

const requestReplayAnimationFrame = (callback) => {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }

  return setTimeout(() => callback(Date.now()), 16);
};

const cancelReplayAnimationFrame = (handle) => {
  if (handle == null) return;
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
    return;
  }

  clearTimeout(handle);
};

try {
  if (TaskManager && !TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
    TaskManager.defineTask(BACKGROUND_LOCATION_TASK, ({ data, error }) => {
      if (error) {
        console.warn("[Wayper] background location task failed", error);
        return;
      }

      const locations = data?.locations || [];
      if (!Array.isArray(locations) || !backgroundLocationUpdateHandler) return;

      locations.forEach((loc) => {
        if (!loc?.coords) return;
        backgroundLocationUpdateHandler({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: loc.coords.accuracy,
          speed: loc.coords.speed,
          heading: loc.coords.heading,
          altitude: loc.coords.altitude,
          altitudeAccuracy: loc.coords.altitudeAccuracy,
          timestamp: loc.timestamp,
          source: "background",
        });
      });
    });
  }
} catch (taskError) {
  console.warn("[Wayper] could not define background location task", taskError);
}

const debug = (...args) => {
  // habilite se precisar
  // console.log("[MapScreen]", ...args);
};

const showRunShareFailure = (message, error) => {
  const userMessage = getShareUnavailableMessage(error, message);
  if (error?.code === "TRACE_POINTS_INSUFFICIENT") {
    Alert.alert("Tracado indisponivel", userMessage);
    return;
  }

  showShareError(userMessage, error);
};

const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const sanitizePath = (arr = []) => sanitizeRunPath(arr);
const MAX_MERCATOR_LATITUDE = 85.05112878;

const formatSavedDuration = (seconds = 0) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const formatSavedPace = (seconds = 0, meters = 0) =>
  getFormattedPace(seconds, Number(meters) / 1000, { suffix: "/km" });

const formatSavedDate = (date) => {
  try {
    if (!date) return "Agora";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return String(date);
    return parsed.toLocaleString();
  } catch {
    return "Agora";
  }
};

const buildRouteSvgPoints = (path = [], width = 320, height = 210, padding = 28) => {
  const points = sanitizePath(path);
  if (points.length < 2) return "";

  return buildShareSvgPointString(points, width, height, padding);
};

const projectSharePoint = (point) => {
  const latitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, point.latitude));
  const latRad = (latitude * Math.PI) / 180;
  return {
    x: point.longitude,
    y: Math.log(Math.tan(Math.PI / 4 + latRad / 2)),
  };
};

const buildShareSvgPointString = (points = [], width = 320, height = 210, padding = 28) => {
  const projected = points.map(projectSharePoint);
  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = Math.max(maxX - minX, 0.000001);
  const rangeY = Math.max(maxY - minY, 0.000001);
  const drawWidth = width - padding * 2;
  const drawHeight = height - padding * 2;
  const scale = Math.min(drawWidth / rangeX, drawHeight / rangeY);
  const shapeWidth = rangeX * scale;
  const shapeHeight = rangeY * scale;
  const offsetX = (width - shapeWidth) / 2;
  const offsetY = (height - shapeHeight) / 2;

  return projected
    .map((p) => {
      const x = offsetX + (p.x - minX) * scale;
      const y = offsetY + (1 - (p.y - minY) / rangeY) * shapeHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

const buildPolygonSvgPoints = (coords = [], width = 320, height = 210, padding = 28) => {
  const points = sanitizePath(coords);
  if (points.length < 3) return "";

  return buildShareSvgPointString(points, width, height, padding);
};

const DEFAULT_COORD = WAYPER_FALLBACK_COORD;

const toFiniteNumber = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeTerritoryBbox = (bbox) => {
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const values = bbox.slice(0, 4).map((value) => toFiniteNumber(value));
  if (values.some((value) => value == null)) return null;
  return [
    Math.min(values[0], values[2]),
    Math.min(values[1], values[3]),
    Math.max(values[0], values[2]),
    Math.max(values[1], values[3]),
  ];
};

const buildBboxAroundLocation = (point, delta = TERRITORY_INITIAL_BBOX_DELTA) => {
  const latitude = toFiniteNumber(point?.latitude ?? point?.lat);
  const longitude = toFiniteNumber(point?.longitude ?? point?.lng ?? point?.lon);
  if (latitude == null || longitude == null) return null;
  return [longitude - delta, latitude - delta, longitude + delta, latitude + delta];
};

const territoryIntersectsBbox = (territory, bbox) => {
  const target = normalizeTerritoryBbox(bbox);
  if (!target) return true;
  const source = normalizeTerritoryBbox(territory?.bbox);
  if (!source) return true;

  return !(
    source[2] < target[0] ||
    source[0] > target[2] ||
    source[3] < target[1] ||
    source[1] > target[3]
  );
};

const isActiveTerritory = (territory) => !territory?.status || territory.status === "active";

const sortByTerritoryUpdatedAt = (a, b) => {
  const aTime = new Date(a?.updatedAt || a?.capturedAt || a?.createdAt || 0).getTime();
  const bTime = new Date(b?.updatedAt || b?.capturedAt || b?.createdAt || 0).getTime();
  return bTime - aTime;
};

const mergeTerritoriesForMap = (existing = [], incoming = [], bbox = null) => {
  const map = new Map();
  const add = (territory) => {
    if (!territory?.id || !isActiveTerritory(territory) || !territoryIntersectsBbox(territory, bbox)) return;
    map.set(String(territory.id), territory);
  };

  (Array.isArray(existing) ? existing : []).forEach(add);
  (Array.isArray(incoming) ? incoming : []).forEach(add);
  return Array.from(map.values()).sort(sortByTerritoryUpdatedAt);
};

const applyCaptureResultToTerritoryState = (existing = [], result = {}) => {
  const removedIds = new Set([
    ...(result.deletedTerritories || []),
    ...(result.conqueredTerritories || []),
    ...(result.mergedTerritories || []),
  ].map((territory) => String(territory?.id || territory)).filter(Boolean));

  const map = new Map();
  for (const territory of Array.isArray(existing) ? existing : []) {
    if (!territory?.id || removedIds.has(String(territory.id)) || !isActiveTerritory(territory)) continue;
    map.set(String(territory.id), territory);
  }

  for (const territory of result.updatedTerritories || []) {
    if (!territory?.id) continue;
    if (isActiveTerritory(territory)) map.set(String(territory.id), territory);
    else map.delete(String(territory.id));
  }

  const captured = result.capturedTerritory;
  if (captured?.id && isActiveTerritory(captured)) {
    map.set(String(captured.id), captured);
  }

  return Array.from(map.values()).sort(sortByTerritoryUpdatedAt);
};

const mergeLeaderCellsForMap = (existing = [], updates = []) => {
  const map = new Map();
  for (const cell of Array.isArray(existing) ? existing : []) {
    if (cell?.cellId || cell?.id) map.set(String(cell.cellId || cell.id), cell);
  }

  for (const update of Array.isArray(updates) ? updates : []) {
    const leaderboard = update?.leaderboard || update;
    if (leaderboard?.cellId || leaderboard?.id) {
      map.set(String(leaderboard.cellId || leaderboard.id), leaderboard);
    }
  }

  return Array.from(map.values());
};

const listIdentitySignature = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => [
      item?.id || item?.cellId || "",
      item?.updatedAt || item?.capturedAt || "",
      item?.version || "",
      item?.status || "",
      Math.round(Number(item?.areaM2 ?? item?.leaderAreaM2 ?? 0)),
    ].join(":"))
    .join("|");

const getCurrentWayperUser = () => {
  const user = auth.currentUser;
  const emailName = user?.email ? user.email.split("@")[0] : null;
  return {
    id: user?.uid || "offline",
    name: user?.displayName || emailName || "Atleta Wayper",
    avatar: user?.photoURL || null,
  };
};

const serializeCaptureResult = (result) => {
  if (!result) return null;
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason || "capture_failed",
      details: result.details || null,
    };
  }

  return {
    ok: true,
    territoryId: result.capturedTerritory?.id || null,
    capturedAreaM2: Number(result.capturedAreaM2 || 0),
    newAreaM2: Number(result.newAreaM2 || 0),
    stolenAreaM2: Number(result.stolenAreaM2 || 0),
    ownMergedAreaM2: Number(result.ownMergedAreaM2 || 0),
    conqueredCount: result.conqueredTerritories?.length || 0,
    splitCount: result.splitTerritories?.length || 0,
    mergedCount: result.mergedTerritories?.length || 0,
    affectedUsersCount: result.affectedUsers?.length || 0,
    becameLeaderInCells: result.becameLeaderInCells || [],
    lostLeaderInCells: result.lostLeaderInCells || [],
    cellIds: result.cellIds || [],
    highlights: result.summary?.highlights || [],
  };
};

const buildCaptureResultMessage = (result) => {
  if (!result) return null;
  if (!result.ok) {
    const reason = result.reason || "erro";
    if (reason === "not_closed_loop") return "Corrida salva. O trajeto nao fechou um loop para capturar territorio.";
    if (reason === "not_enough_points") return "Corrida salva. Foram necessarios mais pontos para capturar territorio.";
    if (reason === "duration_too_short") return "Corrida salva. A captura foi bloqueada porque a atividade foi curta demais.";
    if (reason === "distance_too_short") return "Corrida salva. A captura foi bloqueada porque a distancia foi curta demais.";
    if (reason === "bad_accuracy" || reason === "bad_gps") return "Corrida salva. A captura foi bloqueada por baixa qualidade de GPS.";
    if (reason === "impossible_speed" || reason === "gps_jump" || reason === "suspicious_activity") return "Corrida salva. A captura foi bloqueada por sinais inconsistentes no trajeto.";
    if (reason === "area_too_small") return "Corrida salva. A area ficou pequena demais para virar territorio.";
    if (reason === "area_too_large") return "Corrida salva. A area ficou grande demais para captura segura.";
    return "Corrida salva. A captura territorial nao foi aplicada desta vez.";
  }

  const area = Math.round(Number(result.capturedAreaM2 || 0));
  const stolen = Math.round(Number(result.stolenAreaM2 || 0));
  const leaderCells = result.becameLeaderInCells?.length || 0;
  const extras = [
    stolen > 0 ? `${stolen} m2 retomados` : null,
    leaderCells > 0 ? `lideranca em ${leaderCells} celula${leaderCells > 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  return `Territorio capturado: ${area} m2${extras.length ? `, ${extras.join(", ")}` : ""}.`;
};

const getPrimaryTerritoryCellId = (territory) => {
  if (Array.isArray(territory?.cellIds) && territory.cellIds.length > 0) return territory.cellIds[0];
  return getCellIdForLocation(territory?.center || territory);
};

/* ================= Component ================= */
const MapScreen = ({ navigation, route }) => {
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [mapFollowEnabled, setMapFollowEnabled] = useState(true);
  const [mapRecenterSignal, setMapRecenterSignal] = useState(0);
  const [showZones] = useState(true);
  const [selectModeVisible, setSelectModeVisible] = useState(false);
  const [counting, setCounting] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const [showRunModal, setShowRunModal] = useState(false);
  const [currentRunData, setCurrentRunData] = useState(null);
  const [territories, setTerritories] = useState([]);
  const [leaderCells, setLeaderCells] = useState([]);
  const [selectedTerritory, setSelectedTerritory] = useState(null);
  const [selectedTerritoryLeaderboard, setSelectedTerritoryLeaderboard] = useState(null);
  const [captureResult, setCaptureResult] = useState(null);
  const [territoryLoading, setTerritoryLoading] = useState(false);
  const [mapFocusCenter, setMapFocusCenter] = useState(null);

  const [routeState, setRouteState] = useState([]);
  const [displayRouteState, setDisplayRouteState] = useState([]);
  const [displayRouteSegments, setDisplayRouteSegments] = useState([]);
  const [replayPathState, setReplayPathState] = useState([]);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [distanceState, setDistanceState] = useState(0);
  const [timeSec, setTimeSec] = useState(0);
  const [runsList, setRunsList] = useState([]);
  const [polygons, setPolygons] = useState([]);
  const [completedZonePreview, setCompletedZonePreview] = useState([]);
  const [mode, setMode] = useState(null);

  const [showRunsModal, setShowRunsModal] = useState(false);
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [savedShareVisible, setSavedShareVisible] = useState(false);
  const [lastSavedRun, setLastSavedRun] = useState(null);
  const [shareLoading, setShareLoading] = useState(null);

  const savedFullShareRef = useRef(null);
  const savedRouteShareRef = useRef(null);

  const watcherRef = useRef(null);
  const timerRef = useRef(null);
  const backgroundNotificationRef = useRef(null);
  const backgroundPermissionWarnedRef = useRef(false);
  const timeSecRef = useRef(0);
  const lastNotificationBodyRef = useRef("");
  const replayIntervalRef = useRef(null);
  const replayFrameRef = useRef(null);
  const replayPathRef = useRef([]);
  const replayTimelineRef = useRef([]);
  const replayLastFrameAtRef = useRef(null);
  const replayElapsedRef = useRef(0);
  const replaySpeedRef = useRef(1);
  const replayRunRef = useRef(null);
  const replayReturnRef = useRef(null);
  const lastReplayRequestRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const mountedRef = useRef(true);

  const lastPointRef = useRef(null);
  const rawPathRef = useRef([]);
  const savedPathRef = useRef([]);
  const displayPathRef = useRef([]);
  const displaySegmentsRef = useRef([]);
  const trackingSessionRef = useRef(createTrackingSession({ mode: "run" }));
  const lastTrackingFinishRef = useRef(null);
  const lastAcceptedLocationRef = useRef(null);
  const lastSmoothedLocationRef = useRef(null);
  const pendingSuspiciousPointRef = useRef(null);
  const currentRunIdRef = useRef(null);
  const currentSegmentIdRef = useRef(0);
  const forceNextSegmentBreakRef = useRef(false);
  const routeBufferRef = useRef([]);
  const routeStateRef = useRef([]);
  const distanceRef = useRef(0);
  const runningRef = useRef(false);
  const modeRef = useRef(null);
  const zonePreviewLastAtRef = useRef(0);
  const liveTrackingRef = useRef(false);
  const territoryViewportDebounceRef = useRef(null);
  const lastTerritoryFetchRef = useRef(null);
  const initialTerritoryLoadRef = useRef(false);
  const selectedTerritoryRequestRef = useRef(null);
  const lastRouteFocusRef = useRef(null);

  const routeFadeAnim = useRef(new Animated.Value(1)).current;
  const startPulseAnim = useRef(new Animated.Value(0)).current;
  const startPressAnim = useRef(new Animated.Value(1)).current;
  const currentUserId = auth.currentUser?.uid || "offline";

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const liveTracking = running && !paused && !replaying;

    if (liveTracking && !liveTrackingRef.current) {
      setMapFollowEnabled(true);
      setMapRecenterSignal((value) => value + 1);
    }

    if (!liveTracking && liveTrackingRef.current) {
      setMapFollowEnabled(true);
    }

    liveTrackingRef.current = liveTracking;
  }, [paused, replaying, running]);

  useEffect(() => {
    if (running || replaying) {
      startPulseAnim.stopAnimation();
      startPulseAnim.setValue(0);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(startPulseAnim, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(startPulseAnim, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [running, replaying, startPulseAnim]);

  const handleStartPressIn = useCallback(() => {
    Animated.spring(startPressAnim, {
      toValue: 0.975,
      speed: 22,
      bounciness: 5,
      useNativeDriver: true,
    }).start();
  }, [startPressAnim]);

  const handleStartPressOut = useCallback(() => {
    Animated.spring(startPressAnim, {
      toValue: 1,
      speed: 18,
      bounciness: 7,
      useNativeDriver: true,
    }).start();
  }, [startPressAnim]);

  const handleMapUserInteraction = useCallback(() => {
    if (!running || paused || replaying) return;
    setMapFollowEnabled(false);
  }, [paused, replaying, running]);

  const recenterMapOnUser = useCallback(() => {
    setMapFocusCenter(null);
    setMapFollowEnabled(true);
    setMapRecenterSignal((value) => value + 1);
  }, []);

  const loadTerritoriesForViewport = useCallback(
    async ({ bbox, includeCache = false } = {}) => {
      const viewportBbox = normalizeTerritoryBbox(bbox) || buildBboxAroundLocation(location);
      if (!viewportBbox) return;

      const fetchKey = viewportBbox.map((value) => value.toFixed(5)).join(":");
      if (!includeCache && lastTerritoryFetchRef.current === fetchKey) return;
      lastTerritoryFetchRef.current = fetchKey;

      setTerritoryLoading(true);
      try {
        if (includeCache) {
          const cached = await loadLocalTerritories();
          if (mountedRef.current && Array.isArray(cached)) {
            setTerritories((prev) => {
              const next = mergeTerritoriesForMap([], cached, viewportBbox);
              return listIdentitySignature(prev) === listIdentitySignature(next) ? prev : next;
            });
          }
        }

        const cellIds = getCellIdsForBbox(viewportBbox).slice(0, TERRITORY_MAX_VIEWPORT_CELLS);
        if (cellIds.length === 0) return;

        const [remoteTerritories, viewportLeaderCells] = await Promise.all([
          fetchActiveTerritoriesNear({
            bbox: viewportBbox,
            cellIds,
            limitTo: TERRITORY_FETCH_LIMIT,
          }),
          getLeaderCellsForViewport({ bbox: viewportBbox, cellIds }),
        ]);

        if (!mountedRef.current) return;

        setTerritories((prev) => {
          const next = mergeTerritoriesForMap(prev, remoteTerritories, viewportBbox);
          return listIdentitySignature(prev) === listIdentitySignature(next) ? prev : next;
        });
        setLeaderCells((prev) => {
          const next = Array.isArray(viewportLeaderCells) ? viewportLeaderCells : [];
          return listIdentitySignature(prev) === listIdentitySignature(next) ? prev : next;
        });
      } catch (error) {
        lastTerritoryFetchRef.current = null;
        console.warn("[Wayper] territory viewport load failed", error);
      } finally {
        if (mountedRef.current) setTerritoryLoading(false);
      }
    },
    [location]
  );

  useEffect(() => {
    if (!location || initialTerritoryLoadRef.current) return;
    initialTerritoryLoadRef.current = true;
    loadTerritoriesForViewport({
      bbox: buildBboxAroundLocation(location),
      includeCache: true,
    });
  }, [loadTerritoriesForViewport, location]);

  useEffect(() => {
    return () => {
      if (territoryViewportDebounceRef.current) {
        clearTimeout(territoryViewportDebounceRef.current);
        territoryViewportDebounceRef.current = null;
      }
    };
  }, []);

  const handleTerritoryViewportChange = useCallback(
    ({ bbox } = {}) => {
      const viewportBbox = normalizeTerritoryBbox(bbox);
      if (!viewportBbox) return;

      if (territoryViewportDebounceRef.current) {
        clearTimeout(territoryViewportDebounceRef.current);
      }

      territoryViewportDebounceRef.current = setTimeout(() => {
        loadTerritoriesForViewport({ bbox: viewportBbox, includeCache: false });
      }, TERRITORY_VIEWPORT_DEBOUNCE_MS);
    },
    [loadTerritoriesForViewport]
  );

  const handleTerritoryPress = useCallback(
    async (properties = {}) => {
      if (running || replaying) return;
      const territoryId = properties?.id ? String(properties.id) : null;
      const fullTerritory = territoryId
        ? territories.find((territory) => String(territory.id) === territoryId)
        : null;
      const nextTerritory = fullTerritory ? { ...fullTerritory, ...properties } : properties;
      const requestKey = territoryId || `${Date.now()}`;

      selectedTerritoryRequestRef.current = requestKey;
      setSelectedTerritory(nextTerritory);
      setSelectedTerritoryLeaderboard(null);

      const cellId = getPrimaryTerritoryCellId(nextTerritory);
      if (!cellId) return;

      try {
        const leaderboard = await getLeaderboardForCell(cellId);
        if (mountedRef.current && selectedTerritoryRequestRef.current === requestKey) {
          setSelectedTerritoryLeaderboard(leaderboard);
        }
      } catch (error) {
        console.warn("[Wayper] territory leaderboard load failed", error);
      }
    },
    [replaying, running, territories]
  );

  const handleLeaderCellPress = useCallback(
    (properties = {}) => {
      if (running || replaying) return;
      const cellId = properties?.cellId || properties?.id || null;
      navigation?.navigate("Ranking", cellId ? { cellId } : undefined);
    },
    [navigation, replaying, running]
  );

  useEffect(() => {
    const params = route?.params || {};
    const focusTerritoryId = params.focusTerritoryId ? String(params.focusTerritoryId) : null;
    const focusCellId = params.focusCellId ? String(params.focusCellId) : null;
    const focusUserId = params.focusUserId ? String(params.focusUserId) : null;
    const focusKey = [focusTerritoryId, focusCellId, focusUserId].filter(Boolean).join("|");

    if (!focusKey || lastRouteFocusRef.current === focusKey) return;

    const focusedTerritory = territories.find((territory) => {
      if (focusTerritoryId && String(territory.id) === focusTerritoryId) return true;
      if (focusUserId && String(territory.ownerId || territory.userId) === focusUserId) return true;
      if (focusCellId && Array.isArray(territory.cellIds) && territory.cellIds.map(String).includes(focusCellId)) return true;
      return false;
    });

    if (focusedTerritory) {
      lastRouteFocusRef.current = focusKey;
      setMapFocusCenter(focusedTerritory.center || focusedTerritory.coordsPreview?.[0] || null);
      setMapFollowEnabled(false);
      handleTerritoryPress(focusedTerritory);
      return;
    }

    if (focusCellId) {
      const center = getCellCenter(focusCellId);
      if (center) {
        lastRouteFocusRef.current = focusKey;
        setMapFocusCenter(center);
        setMapFollowEnabled(false);
      }
    }
  }, [handleTerritoryPress, route?.params, territories]);

  const closeSelectedTerritory = useCallback(() => {
    selectedTerritoryRequestRef.current = null;
    setSelectedTerritory(null);
    setSelectedTerritoryLeaderboard(null);
  }, []);

  /* ===== INIT ===== */
  useEffect(() => {
    mountedRef.current = true;
    let flushTimer = null;
    let appStateSub = null;
    let initTimedOut = false;

    (async () => {
      try {
        // timeout safeguard: se a permissão travar por X ms, liberar UI com fallback
        const initTimeout = setTimeout(() => {
          initTimedOut = true;
          debug("init timed out, allowing UI fallback");
        }, 7000);

        const { status } = await Location.requestForegroundPermissionsAsync();

        clearTimeout(initTimeout);

        if (initTimedOut && status !== "granted") {
          // se timeout ocorreu e permissão não foi concedida, tratamos como negada
          setPermissionDenied(true);
          setLoading(false);
          return;
        }

        if (status !== "granted") {
          setPermissionDenied(true);
          setLoading(false);
          return;
        }

        setPermissionDenied(false);

        // tentar obter posição inicial com timeout/catch
        let pos = null;
        try {
          pos = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000)),
          ]);
        } catch (e) {
          debug("initial position failed (non-blocking)", e);
        }

        const initial = pos?.coords
          ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
          : DEFAULT_COORD;

        if (mountedRef.current) {
          setLocation(initial);
        }

        appStateSub = AppState.addEventListener("change", (next) => {
          appStateRef.current = next;
        });

        flushTimer = setInterval(() => flushRouteBufferToState(), FLUSH_INTERVAL_MS);

        // carregar dados locais sem bloquear UI
        try {
          const [persistedRuns] = await Promise.all([sync.loadLocalRuns?.()]);
          if (Array.isArray(persistedRuns) && persistedRuns.length > 0) setRunsList(persistedRuns.slice().reverse());
          // Zonas salvas continuam no histórico, mas o mapa inicial deve abrir limpo para a próxima corrida.
          setPolygons([]);
        } catch (e) {
          debug("load persisted failed", e);
        }
      } catch (err) {
        debug("init catch", err);
        // fallback defensivo: permitir UI
        setPermissionDenied(true);
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      mountedRef.current = false;
      if (flushTimer) clearInterval(flushTimer);
      stopWatcherAndPolling();
      stopBackgroundLocationService();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
        replayIntervalRef.current = null;
      }
      if (replayFrameRef.current != null) {
        cancelReplayAnimationFrame(replayFrameRef.current);
        replayFrameRef.current = null;
      }
      try {
        if (appStateSub?.remove) appStateSub.remove();
      } catch (e) {
        debug("appState remove fail", e);
      }
      runningRef.current = false;
    };
  }, []); // só uma vez

  /* ===== Helpers ===== */
  const stopWatcherAndPolling = useCallback(() => {
    try {
      const w = watcherRef.current;
      if (!w) return;
      if (typeof w.remove === "function") {
        try {
          w.remove();
        } catch (e) {
          debug("watcher remove error", e);
        }
      } else if (w.pollingInterval) {
        try {
          clearInterval(w.pollingInterval);
        } catch (e) {
          debug("clear polling error", e);
        }
      }
      watcherRef.current = null;
      debugTracking("watcher_stopped", { runSessionId: currentRunIdRef.current });
    } catch (e) {
      debug("stopWatcher caught", e);
    }
  }, []);

  const resetTrackingPipeline = useCallback((options = {}) => {
    trackingSessionRef.current = createTrackingSession({
      mode: "run",
      startedAt: Date.now(),
    });
    lastTrackingFinishRef.current = null;
    rawPathRef.current = [];
    savedPathRef.current = [];
    displayPathRef.current = [];
    displaySegmentsRef.current = [];
    routeBufferRef.current = [];
    routeStateRef.current = [];
    lastPointRef.current = null;
    lastAcceptedLocationRef.current = null;
    lastSmoothedLocationRef.current = null;
    pendingSuspiciousPointRef.current = null;
    forceNextSegmentBreakRef.current = false;
    currentSegmentIdRef.current = Number.isFinite(Number(options.segmentId)) ? Number(options.segmentId) : 0;

    setRouteState([]);
    setDisplayRouteState([]);
    setDisplayRouteSegments([]);
    debugTracking("path_reset", { segmentId: currentSegmentIdRef.current });
  }, []);

  const updateActiveZonePreview = useCallback((path = []) => {
    try {
      if (!runningRef.current || modeRef.current !== "zones") return;

      const now = Date.now();
      if (now - zonePreviewLastAtRef.current < ZONE_PREVIEW_INTERVAL_MS) return;
      zonePreviewLastAtRef.current = now;

      const previewPath = finalizeRoutePath(path, {
        minPointDistanceM: 1,
        toleranceM: 1.4,
        spikeToleranceM: 6,
        maxPoints: 900,
        maxAccuracyM: MAX_GPS_ACCURACY_M,
        maxSpeedMps: MAX_RUNNING_SPEED_MPS,
        preserveTurns: true,
      });

      const built = zones.buildCapturedZone(previewPath, {
        closeDistanceM: 32,
        maxCloseDistanceM: 48,
        requireClosedLoop: true,
        minLoopPoints: 8,
        simplifyTolerance: 0.000015,
        smoothIterations: 1,
        maxPoints: 360,
      });

      if (Array.isArray(built) && built.length >= 3 && zones.isValidPolygon(built)) {
        const area = zones.calcArea(built);
        setPolygons([{ coords: built, area, id: "active-zone-preview" }]);
        return;
      }

      setPolygons([]);
    } catch (e) {
      debug("zone preview failed", e);
    }
  }, []);

  const flushRouteBufferToState = useCallback(() => {
    try {
      const trackingState = trackingSessionRef.current?.getState?.();
      const sessionTrusted = sanitizePath(trackingState?.trustedPath || []);
      if (sessionTrusted.length === 0 && (!routeBufferRef.current || routeBufferRef.current.length === 0)) return;

      const savedSnapshot = sessionTrusted.length > 0 ? sessionTrusted : sanitizePath(savedPathRef.current);
      const displaySnapshot = limitPathForRendering(
        sanitizePath(trackingState?.liveRenderPath || []).length > 1
          ? sanitizePath(trackingState.liveRenderPath)
          : smoothDisplayPath(savedSnapshot, { config: TRACKING_CONFIG }),
        TRACKING_CONFIG.DISPLAY_PATH_MAX_POINTS
      );
      const segmentSnapshot = splitPathIntoSegments(displaySnapshot);

      routeStateRef.current = savedSnapshot;
      savedPathRef.current = savedSnapshot;
      displayPathRef.current = displaySnapshot;
      displaySegmentsRef.current = segmentSnapshot;
      routeBufferRef.current = [];
      rawPathRef.current = sanitizePath(trackingState?.rawPath || rawPathRef.current);
      distanceRef.current = Number(trackingState?.stats?.distanceMeters ?? distanceRef.current) || 0;
      lastAcceptedLocationRef.current = savedSnapshot[savedSnapshot.length - 1] || null;
      lastSmoothedLocationRef.current = displaySnapshot[displaySnapshot.length - 1] || null;

      setRouteState(limitPathForRendering(savedSnapshot, ROUTE_CAP));
      setDisplayRouteState(displaySnapshot);
      setDisplayRouteSegments(segmentSnapshot);
      setDistanceState(distanceRef.current);
      updateActiveZonePreview(savedSnapshot);
    } catch (e) {
      debug("flush catch", e);
    }
  }, [updateActiveZonePreview]);

  /* ===== Core location update ===== */
  const handleLocationUpdate = useCallback(
    (locObj = {}) => {
      try {
        if (locObj.source === "background" && appStateRef.current === "active" && watcherRef.current) {
          return;
        }

        if (locObj.runSessionId && currentRunIdRef.current && locObj.runSessionId !== currentRunIdRef.current) {
          debugTracking("reject:stale_session", {
            pointSession: locObj.runSessionId,
            currentSession: currentRunIdRef.current,
          });
          return;
        }

        const point = normalizeLocation(locObj);
        if (!point) {
          debugTracking("reject:normalize_failed", locObj);
          return;
        }

        if (!runningRef.current) {
          setLocation((prev) => {
            if (prev && prev.latitude === point.latitude && prev.longitude === point.longitude) return prev;
            return point;
          });
          return;
        }

        const result = trackingSessionRef.current.processLocationPoint(
          {
            ...locObj,
            source: locObj.source === "background" || locObj.source === "foreground"
              ? "expo-location"
              : locObj.source,
          },
          { segmentBreak: forceNextSegmentBreakRef.current }
        );

        rawPathRef.current = result.rawPath || rawPathRef.current;

        if (!result.accepted) {
          debugTracking(`reject:${result.reason}`, {
            accuracy: point.accuracy,
            rawPoints: result.pathQuality?.rawPoints,
            acceptedPoints: result.pathQuality?.acceptedPoints,
          });
          return;
        }

        const trustedPath = sanitizePath(result.trustedPath || []);
        const livePath = limitPathForRendering(
          sanitizePath(result.liveRenderPath || trustedPath),
          TRACKING_CONFIG.DISPLAY_PATH_MAX_POINTS
        );

        savedPathRef.current = trustedPath;
        routeStateRef.current = trustedPath;
        displayPathRef.current = livePath;
        displaySegmentsRef.current = splitPathIntoSegments(livePath);
        routeBufferRef.current = result.point ? [result.point] : [];
        lastAcceptedLocationRef.current = trustedPath[trustedPath.length - 1] || null;
        lastPointRef.current = lastAcceptedLocationRef.current;
        lastSmoothedLocationRef.current = result.currentPosition || livePath[livePath.length - 1] || null;
        pendingSuspiciousPointRef.current = null;
        distanceRef.current = Number(result.stats?.distanceMeters || 0);
        currentSegmentIdRef.current = Number(lastAcceptedLocationRef.current?.segmentId || currentSegmentIdRef.current || 0);
        forceNextSegmentBreakRef.current = false;

        if (result.currentPositionChanged && result.currentPosition) {
          setLocation(result.currentPosition);
        }

        if (result.pathChanged) {
          setRouteState(limitPathForRendering(trustedPath, ROUTE_CAP));
          setDisplayRouteState(livePath);
          setDisplayRouteSegments(displaySegmentsRef.current);
          setDistanceState(distanceRef.current);
          updateActiveZonePreview(trustedPath);
        }
      } catch (e) {
        debug("handleLocationUpdate", e);
      }
    },
    [updateActiveZonePreview]
  );

  useEffect(() => {
    const handler = (locObj) => handleLocationUpdate({
      ...locObj,
      runSessionId: currentRunIdRef.current,
    });
    backgroundLocationUpdateHandler = handler;

    return () => {
      if (backgroundLocationUpdateHandler === handler) {
        backgroundLocationUpdateHandler = null;
      }
    };
  }, [handleLocationUpdate]);

  const buildRunNotificationBody = useCallback(() => {
    return `Tempo ${formatTime(timeSecRef.current)} - ${(distanceRef.current / 1000).toFixed(2)} km`;
  }, []);

  const getBackgroundLocationOptions = useCallback((notificationBody) => ({
    accuracy: Location.Accuracy.BestForNavigation || Location.Accuracy.Highest || Location.Accuracy.High,
    timeInterval: WATCH_TIME_INTERVAL_MS,
    distanceInterval: WATCH_DISTANCE_INTERVAL,
    deferredUpdatesInterval: WATCH_TIME_INTERVAL_MS,
    deferredUpdatesDistance: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: "Wayper - corrida em andamento",
      notificationBody,
      notificationColor: WayperTheme.colors.primary,
      killServiceOnDestroy: false,
    },
  }), []);

  const stopBackgroundLocationService = useCallback(async () => {
    try {
      if (backgroundNotificationRef.current) {
        clearInterval(backgroundNotificationRef.current);
        backgroundNotificationRef.current = null;
      }
      lastNotificationBodyRef.current = "";

      const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (started) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    } catch (e) {
      debug("stopBackgroundLocationService", e);
    }
  }, []);

  const updateBackgroundLocationNotification = useCallback(
    async (force = false) => {
      try {
        if (!runningRef.current) return;
        const body = buildRunNotificationBody();
        if (!force && body === lastNotificationBodyRef.current) return;

        await Location.startLocationUpdatesAsync(
          BACKGROUND_LOCATION_TASK,
          getBackgroundLocationOptions(body)
        );
        lastNotificationBodyRef.current = body;
      } catch (e) {
        debug("updateBackgroundLocationNotification", e);
      }
    },
    [buildRunNotificationBody, getBackgroundLocationOptions]
  );

  const startBackgroundLocationService = useCallback(async () => {
    try {
      let foreground = await Location.getForegroundPermissionsAsync();
      if (foreground.status !== "granted") {
        foreground = await Location.requestForegroundPermissionsAsync();
      }
      if (foreground.status !== "granted") return;

      if (Platform.OS === "android") {
        let background = await Location.getBackgroundPermissionsAsync();
        if (background.status !== "granted") {
          background = await Location.requestBackgroundPermissionsAsync();
        }

        if (background.status !== "granted" && !backgroundPermissionWarnedRef.current) {
          backgroundPermissionWarnedRef.current = true;
          Alert.alert(
            "Corrida em segundo plano",
            "Para continuar registrando com o app minimizado, permita localizacao o tempo todo nas configuracoes do Android."
          );
        }
      }

      await updateBackgroundLocationNotification(true);

      if (backgroundNotificationRef.current) {
        clearInterval(backgroundNotificationRef.current);
      }
      backgroundNotificationRef.current = setInterval(() => {
        updateBackgroundLocationNotification(false);
      }, 15000);
    } catch (e) {
      debug("startBackgroundLocationService", e);
    }
  }, [updateBackgroundLocationNotification]);

  const startLocationWatcher = useCallback(async () => {
    stopWatcherAndPolling();
    const runSessionId = currentRunIdRef.current;

    try {
      const accuracyCandidates = [
        Location.Accuracy.BestForNavigation,
        Location.Accuracy.Highest,
        Location.Accuracy.High,
      ].filter((value) => value != null);
      let sub = null;
      let lastWatchError = null;

      for (const accuracy of accuracyCandidates) {
        try {
          sub = await Location.watchPositionAsync(
            {
              accuracy,
              timeInterval: WATCH_TIME_INTERVAL_MS,
              distanceInterval: WATCH_DISTANCE_INTERVAL,
              mayShowUserSettingsDialog: true,
            },
            (loc) => {
              if (!loc?.coords) return;
              handleLocationUpdate({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                accuracy: loc.coords.accuracy,
                speed: loc.coords.speed,
                heading: loc.coords.heading,
                altitude: loc.coords.altitude,
                altitudeAccuracy: loc.coords.altitudeAccuracy,
                timestamp: loc.timestamp,
                source: "expo-location",
                runSessionId,
              });
            }
          );
          debugTracking("watcher_accuracy_selected", { accuracy });
          break;
        } catch (watchError) {
          lastWatchError = watchError;
          debug("watchPositionAsync accuracy fallback", watchError);
        }
      }

      if (!sub) throw lastWatchError || new Error("watchPositionAsync unavailable");
      watcherRef.current = sub;
      debugTracking("watcher_started", { runSessionId, distanceInterval: WATCH_DISTANCE_INTERVAL, timeInterval: WATCH_TIME_INTERVAL_MS });
    } catch (e) {
      debug("watchPositionAsync failed, fallback polling", e);
      const poll = setInterval(async () => {
        try {
          const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          if (p?.coords) {
            handleLocationUpdate({
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracy: p.coords.accuracy,
              speed: p.coords.speed,
              heading: p.coords.heading,
              altitude: p.coords.altitude,
              altitudeAccuracy: p.coords.altitudeAccuracy,
              timestamp: p.timestamp,
              source: "fallback",
              runSessionId,
            });
          }
        } catch (err) {
          debug("polling error", err);
        }
      }, WATCH_TIME_INTERVAL_MS);
      watcherRef.current = { pollingInterval: poll };
    }
  }, [handleLocationUpdate, stopWatcherAndPolling]);

  /* ===== Start / Pause / Stop run ===== */
  const startWithCountdown = useCallback(
    (selectedMode = "free") => {
      if (counting || running) return;
      setMode(selectedMode);
      setCounting(true);
      setCountdown(COUNTDOWN_DEFAULT);

      let cancelled = false;
      const interval = setInterval(() => {
        setCountdown((c) => {
          if (cancelled) {
            clearInterval(interval);
            setCounting(false);
            return 0;
          }
          if (c <= 1) {
            clearInterval(interval);
            setCounting(false);
            startRun(selectedMode);
            return 0;
          }
          return c - 1;
        });
      }, 1000);

      const cleanup = () => {
        cancelled = true;
        clearInterval(interval);
      };
      return cleanup;
    },
    [counting, running]
  );

  const startRun = useCallback(
    async (selectedMode = "free") => {
      try {
        if (runningRef.current || running) return;

        setRunning(true);
        setPaused(false);
        setMode(selectedMode);
        modeRef.current = selectedMode;
        runningRef.current = true;
        setReplaying(false);
        setCaptureResult(null);
        closeSelectedTerritory();
        currentRunIdRef.current = uid();
        resetTrackingPipeline({ segmentId: 0 });
        setPolygons([]);
        setCompletedZonePreview([]);
        distanceRef.current = 0;
        setDistanceState(0);
        zonePreviewLastAtRef.current = 0;
        timeSecRef.current = 0;
        setTimeSec(0);
        debugTracking("session_started", { runSessionId: currentRunIdRef.current, mode: selectedMode });

        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        timerRef.current = setInterval(() => {
          setTimeSec((t) => {
            const next = t + 1;
            timeSecRef.current = next;
            return next;
          });
        }, 1000);

        let pos = null;
        try {
          pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, timeout: 7000 });
        } catch (e) {
          debug("startRun getCurrentPosition failed", e);
        }

        if (pos?.coords) {
          handleLocationUpdate({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
            altitude: pos.coords.altitude,
            altitudeAccuracy: pos.coords.altitudeAccuracy,
            timestamp: pos.timestamp,
            source: "expo-location",
            runSessionId: currentRunIdRef.current,
          });
        }

        await startLocationWatcher();
        await startBackgroundLocationService();
      } catch (e) {
        debug("startRun catch", e);
      }
    },
    [closeSelectedTerritory, handleLocationUpdate, resetTrackingPipeline, running, startBackgroundLocationService, startLocationWatcher]
  );

  const pauseRun = useCallback(() => {
    if (!running || paused) return;

    runningRef.current = false;
    setPaused(true);
    flushRouteBufferToState();
    stopWatcherAndPolling();
    stopBackgroundLocationService();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [flushRouteBufferToState, paused, running, stopBackgroundLocationService, stopWatcherAndPolling]);

  const resumeRun = useCallback(async () => {
    if (!running || !paused) return;

    try {
      setPaused(false);
      runningRef.current = true;
      forceNextSegmentBreakRef.current = true;
      pendingSuspiciousPointRef.current = null;
      lastSmoothedLocationRef.current = null;
      debugTracking("resume_segment_break_armed", { runSessionId: currentRunIdRef.current });

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      timerRef.current = setInterval(() => {
        setTimeSec((t) => {
          const next = t + 1;
          timeSecRef.current = next;
          return next;
        });
      }, 1000);

      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, timeout: 7000 });
        if (pos?.coords) {
          const point = normalizeLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
            altitude: pos.coords.altitude,
            altitudeAccuracy: pos.coords.altitudeAccuracy,
            timestamp: pos.timestamp || Date.now(),
            source: "expo-location",
          });
          if (point) setLocation(point);
        }
      } catch (e) {
        debug("resumeRun getCurrentPosition failed", e);
      }

      await startLocationWatcher();
      await startBackgroundLocationService();
    } catch (e) {
      debug("resumeRun catch", e);
    }
  }, [paused, running, startBackgroundLocationService, startLocationWatcher]);

  const fadeOutRoute = useCallback(() => {
    return new Promise((resolve) => {
      try {
        routeFadeAnim.setValue(1);
        Animated.timing(routeFadeAnim, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => {
          setRouteState([]);
          setDisplayRouteState([]);
          setDisplayRouteSegments([]);
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }, [routeFadeAnim]);

  const resetRunVisuals = useCallback(() => {
    distanceRef.current = 0;
    setDistanceState(0);
    resetTrackingPipeline({ segmentId: 0 });
    setReplayPathState([]);
    setPolygons([]);
    setCompletedZonePreview([]);
    timeSecRef.current = 0;
    setTimeSec(0);
    modeRef.current = null;
    setMode(null);
    setPaused(false);
    currentRunIdRef.current = null;
  }, [resetTrackingPipeline]);

  const stopRun = useCallback(
    async (opts = {}) => {
      try {
        if (!running) return;

        runningRef.current = false;
        setRunning(false);
        setPaused(false);

        stopWatcherAndPolling();
        stopBackgroundLocationService();

        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        flushRouteBufferToState();

        const totalDuration = timeSecRef.current || timeSec;
        const trackingFinish = trackingSessionRef.current?.finishTrackingSession?.({
          durationMs: totalDuration * 1000,
        });
        lastTrackingFinishRef.current = trackingFinish || null;

        const sanitizedPath = sanitizePath(trackingFinish?.trustedPath || savedPathRef.current);
        const fallbackPoint = location || DEFAULT_COORD;
        const rawPath = sanitizedPath.length > 0 ? sanitizedPath : sanitizePath([fallbackPoint]);
        const path = rawPath;
        const summaryRenderPath = sanitizePath(
          trackingFinish?.summaryRenderPath ||
          trackingFinish?.renderPath ||
          (path.length > 1 ? buildSummaryRenderPath(path) : path)
        );
        const routeDistance = Number(trackingFinish?.distanceMeters || 0) || calculateRouteDistance(path);
        const totalDistance = routeDistance > 0 ? routeDistance : distanceRef.current;
        const stoppedRunSessionId = currentRunIdRef.current;
        const runId = stoppedRunSessionId || uid();
        const finishedAt = new Date().toISOString();
        const avgSpeedKmh = totalDistance && totalDuration
          ? Number(((totalDistance / 1000) / (totalDuration / 3600)).toFixed(2))
          : 0;
        const maxSpeedKmh = Number(((trackingFinish?.maxSpeedMps || 0) * 3.6).toFixed(2)) || 0;

        const runData = {
          id: runId,
          path,
          trustedPath: path,
          rawPath: sanitizePath(trackingFinish?.rawPath || rawPath),
          liveRenderPath: sanitizePath(trackingFinish?.liveRenderPath || displayPathRef.current || []),
          renderPath: summaryRenderPath,
          displayPath: summaryRenderPath,
          pathQuality: trackingFinish?.pathQuality || null,
          lowConfidenceSegments: trackingFinish?.lowConfidenceSegments || [],
          smoothingVersion: trackingFinish?.smoothingVersion || "wayper_tracking_v1",
          distance: totalDistance,
          duration: totalDuration,
          avgSpeed: avgSpeedKmh,
          maxSpeed: maxSpeedKmh,
          date: finishedAt,
          mode: mode || "free",
          area: 0,
          zoneId: null,
          zoneCoords: [],
          zoneCount: 0,
        };

        if (mode === "zones") {
          try {
            const actor = getCurrentWayperUser();
            const result = await processRunTerritoryCapture({
              userId: actor.id,
              userName: actor.name,
              userAvatar: actor.avatar,
              runId,
              path,
              mode,
              distanceMeters: totalDistance,
              durationSeconds: totalDuration,
              visibility: "followers",
              createdAt: finishedAt,
            });

            setCaptureResult(result);
            runData.captureResult = serializeCaptureResult(result);
            runData.territoryCaptureMessage = buildCaptureResultMessage(result);

            if (result?.ok) {
              const captured = result.capturedTerritory || {};
              runData.area = Number(result.capturedAreaM2 || captured.areaM2 || 0);
              runData.territoryId = captured.id || null;
              runData.zoneId = captured.id || null;
              runData.zoneCoords = sanitizePath(captured.coordsPreview || []);
              runData.zoneCount = runData.zoneCoords.length >= 3 ? 1 : 0;
              setTerritories((prev) => applyCaptureResultToTerritoryState(prev, result));
              if (Array.isArray(result.localLeaderboardUpdates) && result.localLeaderboardUpdates.length > 0) {
                setLeaderCells((prev) => mergeLeaderCellsForMap(prev, result.localLeaderboardUpdates));
              }
            } else {
              runData.area = 0;
              runData.territoryCaptureFailedReason = result?.reason || "capture_failed";
              if (result?.runContext?.suspicious || result?.details?.suspicious) {
                runData.suspicious = true;
                runData.territoryCaptureBlockedReason = result?.reason || "suspicious_activity";
                runData.suspiciousScore = result?.suspiciousScore || 0;
              }
            }
          } catch (e) {
            debug("territory capture failed unexpectedly; using legacy zone fallback", e);
            try {
              if (path.length >= 6 && totalDistance > 1) {
                const savedZone = await sync.createAndSaveZoneFromPath?.(path, {
                  closeDistanceM: 32,
                  maxCloseDistanceM: 48,
                  requireClosedLoop: true,
                  allowOpenFallback: false,
                  minLoopPoints: 8,
                  simplifyTolerance: 0.000015,
                  smoothIterations: 1,
                  maxPoints: 420,
                  compressMax: 420,
                });
                if (savedZone) {
                  runData.area = Number(savedZone.area || 0);
                  runData.zoneId = savedZone.id || null;
                  runData.zoneCoords = sanitizePath(savedZone.coords || []);
                  runData.zoneCount = runData.zoneCoords.length >= 3 ? 1 : 0;
                  runData.territoryCaptureFailedReason = "legacy_zone_fallback";
                  runData.territoryCaptureMessage = "Corrida salva usando o modo legado de zonas.";
                }
              }
            } catch (fallbackErr) {
              debug("fallback zone save failed", fallbackErr);
              runData.territoryCaptureFailedReason = "capture_unavailable";
              runData.territoryCaptureMessage = "Corrida salva. A captura territorial ficou indisponivel neste momento.";
            }
          }
        } else {
          setCaptureResult(null);
        }

        await fadeOutRoute();
        resetRunVisuals();
        setCompletedZonePreview(
          runData.mode === "zones" && runData.zoneCoords.length >= 3
            ? [{ coords: runData.zoneCoords, area: runData.area, id: runData.zoneId || "completed-zone" }]
            : []
        );

        setCurrentRunData(runData);
        setShowRunModal(true);
        debugTracking("session_stopped", {
          runSessionId: stoppedRunSessionId,
          savedPoints: path.length,
          distance: totalDistance,
        });
      } catch (e) {
        debug("stopRun catch", e);
      }
    },
    [running, location, timeSec, resetRunVisuals, fadeOutRoute, stopBackgroundLocationService, stopWatcherAndPolling, flushRouteBufferToState, mode]
  );

  /* ============ Replay ============ */
  const clearReplayPlayback = useCallback(() => {
    if (replayIntervalRef.current) {
      clearInterval(replayIntervalRef.current);
      replayIntervalRef.current = null;
    }
    if (replayFrameRef.current != null) {
      cancelReplayAnimationFrame(replayFrameRef.current);
      replayFrameRef.current = null;
    }
    replayLastFrameAtRef.current = null;
  }, []);

  const returnAfterReplay = useCallback((returnTarget) => {
    if (!returnTarget) return;

    if (returnTarget.type === "run-detail" && returnTarget.run) {
      navigation?.navigate("Corridas", {
        screen: "RunDetail",
        params: { run: returnTarget.run },
      });
      return;
    }

    if (returnTarget.type === "previous" && navigation?.canGoBack?.()) {
      navigation.goBack();
    }
  }, [navigation]);

  const finishReplay = useCallback(
    ({ shouldReturn = true } = {}) => {
      try {
        const returnTarget = replayReturnRef.current;

        clearReplayPlayback();
        replayPathRef.current = [];
        replayTimelineRef.current = [];
        replayElapsedRef.current = 0;
        replayRunRef.current = null;
        replayReturnRef.current = null;
        replaySpeedRef.current = 1;
        setReplaySpeed(1);
        setReplaying(false);
        setReplayPathState([]);
        resetTrackingPipeline({ segmentId: 0 });
        setMapFollowEnabled(true);

        if (shouldReturn) returnAfterReplay(returnTarget);
      } catch (e) {
        debug("finishReplay catch", e);
      }
    },
    [clearReplayPlayback, resetTrackingPipeline, returnAfterReplay]
  );

  const advanceReplayFrame = useCallback(
    (frameTime) => {
      const timeline = replayTimelineRef.current;
      const path = replayPathRef.current;

      if (!Array.isArray(timeline) || timeline.length < 2 || !Array.isArray(path) || path.length < 2) {
        finishReplay();
        return;
      }

      const now = Number(frameTime) || Date.now();
      const previousFrameAt = replayLastFrameAtRef.current ?? now;
      const deltaSeconds = Math.max(0, Math.min(0.35, (now - previousFrameAt) / 1000));
      replayLastFrameAtRef.current = now;
      replayElapsedRef.current += deltaSeconds * replaySpeedRef.current;

      const lastPoint = timeline[timeline.length - 1];
      const totalReplaySeconds = Math.max(0.001, Number(lastPoint?.cumulativeTime) || 0.001);
      const nextIndex = Math.max(0, getReplayIndexForElapsed(timeline, replayElapsedRef.current));
      const visibleIndex = Math.min(nextIndex, path.length - 1);
      const currentPoint = timeline[visibleIndex];

      setReplayPathState((previous) => {
        const nextLength = visibleIndex + 1;
        if (
          previous.length === nextLength &&
          previous[previous.length - 1]?.latitude === path[visibleIndex]?.latitude &&
          previous[previous.length - 1]?.longitude === path[visibleIndex]?.longitude
        ) {
          return previous;
        }
        return path.slice(0, nextLength);
      });

      const currentSeconds = Math.round(Number(currentPoint?.cumulativeTime) || replayElapsedRef.current);
      const currentMeters = Number(currentPoint?.cumulativeMeters) || 0;
      timeSecRef.current = currentSeconds;
      distanceRef.current = currentMeters;
      setTimeSec(currentSeconds);
      setDistanceState(currentMeters);

      if (replayElapsedRef.current >= totalReplaySeconds || visibleIndex >= path.length - 1) {
        setReplayPathState(path);
        const stats = getReplayRunStats(replayRunRef.current || {}, timeline);
        timeSecRef.current = Math.round(stats.durationSeconds);
        distanceRef.current = stats.distanceMeters;
        setTimeSec(Math.round(stats.durationSeconds));
        setDistanceState(stats.distanceMeters);
        finishReplay();
        return;
      }

      replayFrameRef.current = requestReplayAnimationFrame(advanceReplayFrame);
    },
    [finishReplay]
  );

  const setReplayPlaybackSpeed = useCallback((nextSpeed) => {
    const normalizedSpeed = Math.max(1, Math.min(5, Number(nextSpeed) || 1));
    replaySpeedRef.current = normalizedSpeed;
    setReplaySpeed(normalizedSpeed);
  }, []);

  const startReplay = useCallback(
    (runEntry, options = {}) => {
      try {
        if (!runEntry) return;

        if (runningRef.current || running) {
          Alert.alert("Replay indisponivel", "Finalize a corrida atual antes de reproduzir outra corrida.");
          if (options.returnTo) returnAfterReplay(options.returnTo);
          return;
        }

        const isZoneReplay =
          runEntry?.mode === "zones" ||
          Number(runEntry?.area || runEntry?.areaM2 || 0) > 0 ||
          (Array.isArray(runEntry?.zoneCoords) && runEntry.zoneCoords.length >= 3) ||
          (Array.isArray(runEntry?.zone?.coords) && runEntry.zone.coords.length >= 3);

        if (isZoneReplay) {
          Alert.alert("Replay indisponivel", "O replay esta disponivel apenas para corrida livre.");
          if (options.returnTo) returnAfterReplay(options.returnTo);
          return;
        }

        if (
          runEntry?.readOnly ||
          options.readOnly ||
          !isRunOwnedByCurrentUser(runEntry, currentUserId, { allowLegacyLocal: options.allowLegacyLocal === true })
        ) {
          Alert.alert("Replay bloqueado", "Voce so pode reproduzir corridas do seu proprio historico.");
          if (options.returnTo) returnAfterReplay(options.returnTo);
          return;
        }

        const replayData = buildRunReplayTimeline(runEntry);
        if (!replayData.path || replayData.path.length < 2 || !replayData.timeline || replayData.timeline.length < 2) {
          Alert.alert("Replay indisponivel", "Esta corrida nao possui pontos suficientes para reproducao.");
          if (options.returnTo) returnAfterReplay(options.returnTo);
          return;
        }

        stopWatcherAndPolling();
        stopBackgroundLocationService();
        clearReplayPlayback();

        const stats = getReplayRunStats(runEntry, replayData.timeline);
        const initialPoint = replayData.timeline[0];

        replayRunRef.current = runEntry;
        replayReturnRef.current = options.returnTo || null;
        replayPathRef.current = replayData.path;
        replayTimelineRef.current = replayData.timeline;
        replayElapsedRef.current = 0;
        replayLastFrameAtRef.current = null;
        replaySpeedRef.current = 1;

        setReplaySpeed(1);
        setReplaying(true);
        runningRef.current = false;
        setRunning(false);
        setPaused(false);
        setMode(null);
        modeRef.current = null;
        setCaptureResult(null);
        closeSelectedTerritory();
        setMapFocusCenter(null);
        setMapFollowEnabled(true);
        resetTrackingPipeline({ segmentId: 0 });
        setRouteState([]);
        setDisplayRouteState([]);
        setDisplayRouteSegments([]);
        setReplayPathState([replayData.path[0]]);
        timeSecRef.current = 0;
        distanceRef.current = 0;
        setTimeSec(stats.durationSeconds > 0 ? 0 : Math.round(initialPoint?.cumulativeTime || 0));
        setDistanceState(0);

        replayFrameRef.current = requestReplayAnimationFrame(advanceReplayFrame);
      } catch (e) {
        debug("startReplay catch", e);
      }
    },
    [
      advanceReplayFrame,
      clearReplayPlayback,
      closeSelectedTerritory,
      currentUserId,
      resetTrackingPipeline,
      returnAfterReplay,
      running,
      stopBackgroundLocationService,
      stopWatcherAndPolling,
    ]
  );

  const stopReplay = useCallback(() => {
    finishReplay();
  }, [finishReplay]);

  useEffect(() => {
    const replayRun = route?.params?.replayRun;
    if (!replayRun) return;
    if (!location) return;

    const replayRequestId =
      route?.params?.replayRequestId ||
      `${replayRun?.id || replayRun?.date || "run"}:${replayRun?.updatedAt || replayRun?.createdAt || ""}`;

    if (lastReplayRequestRef.current === replayRequestId) return;
    lastReplayRequestRef.current = replayRequestId;

    setShowSavedModal(false);
    setSavedShareVisible(false);
    setCompletedZonePreview([]);
    setShowRunModal(false);
    setShowRunsModal(false);
    startReplay(replayRun, {
      returnTo: route?.params?.replayReturnTo || { type: "previous" },
      readOnly: !!(route?.params?.readOnly || replayRun?.readOnly),
      allowLegacyLocal: route?.params?.replayAllowLegacyLocal === true,
    });

    navigation?.setParams?.({
      replayRun: undefined,
      replayReturnTo: undefined,
      replayRequestId: undefined,
      replayAllowLegacyLocal: undefined,
    });
  }, [location, navigation, route?.params, startReplay]);

  /* ============ UI helpers ============ */
  const closeRunsModal = useCallback(() => {
    setShowRunsModal(false);
  }, []);
  const openRunDetails = useCallback((run) => {
    if (!run) return;
    setShowRunsModal(false);
    navigation?.navigate("Corridas", { screen: "RunDetail", params: { run } });
  }, [navigation]);
  const openStartModal = useCallback(() => setSelectModeVisible(true), []);

  const runFromSelectedTerritory = useCallback(() => {
    closeSelectedTerritory();
    startWithCountdown("zones");
  }, [closeSelectedTerritory, startWithCountdown]);

  const openSelectedTerritoryRanking = useCallback(() => {
    const cellId = getPrimaryTerritoryCellId(selectedTerritory);
    closeSelectedTerritory();
    navigation?.navigate("Ranking", cellId ? { cellId } : undefined);
  }, [closeSelectedTerritory, navigation, selectedTerritory]);

  const goToSavedRunDetail = useCallback(() => {
    if (!lastSavedRun) return;
    setShowSavedModal(false);
    setSavedShareVisible(false);
    setCompletedZonePreview([]);
    setShowRunModal(false);
    setShowRunsModal(false);
    navigation?.closeDrawer?.();
    navigation?.navigate("Corridas", { screen: "RunDetail", params: { run: lastSavedRun } });
  }, [lastSavedRun, navigation]);

  const replaySavedRun = useCallback(() => {
    if (!lastSavedRun) return;
    setShowSavedModal(false);
    setSavedShareVisible(false);
    setCompletedZonePreview([]);
    setShowRunModal(false);
    setShowRunsModal(false);
    navigation?.closeDrawer?.();
    navigation?.navigate("Mapa");
    setTimeout(() => startReplay(lastSavedRun, { allowLegacyLocal: true }), 220);
  }, [lastSavedRun, navigation, startReplay]);

  const getSavedShareContext = useCallback(() => {
    const renderPath = sanitizePath(getRenderablePathForRun(lastSavedRun || {}));
    const originalPath = sanitizePath(lastSavedRun?.trustedPath || lastSavedRun?.path || renderPath);
    const path = originalPath.length > 1 ? originalPath : renderPath;
    const zoneCoords = sanitizePath(lastSavedRun?.zoneCoords || lastSavedRun?.zone?.coords || []);
    const isZone = lastSavedRun?.mode === "zones" || Number(lastSavedRun?.area || 0) > 0 || zoneCoords.length >= 3;

    return {
      runId: lastSavedRun?.id,
      path,
      zoneCoords,
      isZone,
      distanceKm: (Number(lastSavedRun?.distance) || 0) / 1000,
      durationSeconds: Number(lastSavedRun?.duration) || 0,
    };
  }, [lastSavedRun]);

  const captureSavedFullImageWithFallback = useCallback(async (context, filename) => {
    try {
      return await captureRunShareImage(savedFullShareRef, {
        filename,
        width: RUN_SHARE_CARD_SIZE.card.width,
        height: RUN_SHARE_CARD_SIZE.card.height,
        waitMs: 1400,
      });
    } catch (cardError) {
      logShareError("saved-card-capture-fallback", cardError, context);
      return generateTracePngFromPath(context.path, {
        ref: savedRouteShareRef,
        zoneCoords: context.zoneCoords,
        isZone: context.isZone,
        filename: `${filename}-fallback-trace`,
        width: RUN_SHARE_CARD_SIZE.trace.width,
        height: RUN_SHARE_CARD_SIZE.trace.height,
      });
    }
  }, [resetTrackingPipeline]);

  const shareSavedRunFullImage = useCallback(async () => {
    if (!lastSavedRun || shareLoading) return;
    const context = getSavedShareContext();

    try {
      setShareLoading("share-image");
      const uri = await captureSavedFullImageWithFallback(context, `wayper-run-full-${context.runId || Date.now()}`);
      await logShareDiagnostics("saved-share-image", { ...context, generatedUri: uri });
      await shareImageFile(uri, { dialogTitle: "Compartilhar corrida Wayper" });
    } catch (error) {
      logShareError("saved-share-image", error, context);
      showRunShareFailure("Nao foi possivel gerar a imagem para compartilhar. Tente novamente.", error);
    } finally {
      setShareLoading(null);
    }
  }, [captureSavedFullImageWithFallback, getSavedShareContext, lastSavedRun, shareLoading]);

  const shareSavedRunRouteImage = useCallback(async () => {
    if (!lastSavedRun || shareLoading) return;
    const context = getSavedShareContext();

    try {
      setShareLoading("share-trace");
      assertTraceHasEnoughPoints(context);
      const uri = await generateTracePngFromPath(context.path, {
        ref: savedRouteShareRef,
        zoneCoords: context.zoneCoords,
        isZone: context.isZone,
        filename: `wayper-run-trace-${context.runId || Date.now()}`,
        width: RUN_SHARE_CARD_SIZE.trace.width,
        height: RUN_SHARE_CARD_SIZE.trace.height,
      });
      await logShareDiagnostics("saved-share-trace", { ...context, generatedUri: uri });
      await shareImageFile(uri, { dialogTitle: "Compartilhar tracado Wayper" });
    } catch (error) {
      logShareError("saved-share-trace", error, context);
      showRunShareFailure("Nao foi possivel gerar o PNG do tracado. Tente novamente.", error);
    } finally {
      setShareLoading(null);
    }
  }, [getSavedShareContext, lastSavedRun, shareLoading]);

  const saveSavedRunFullImage = useCallback(async () => {
    if (!lastSavedRun || shareLoading) return;
    const context = getSavedShareContext();

    try {
      setShareLoading("download-image");
      const uri = await captureSavedFullImageWithFallback(context, `wayper-mapa-${context.runId || Date.now()}`);
      await logShareDiagnostics("saved-download-image", { ...context, generatedUri: uri });
      await saveImageToMediaLibrary(uri, "Wayper");
      Alert.alert("Imagem salva", "A imagem foi salva na galeria do celular.");
    } catch (error) {
      logShareError("saved-download-image", error, context);
      showRunShareFailure("Nao foi possivel salvar a imagem. Tente novamente.", error);
    } finally {
      setShareLoading(null);
    }
  }, [captureSavedFullImageWithFallback, getSavedShareContext, lastSavedRun, shareLoading]);

  const saveSavedRunRouteImage = useCallback(async () => {
    if (!lastSavedRun || shareLoading) return;
    const context = getSavedShareContext();

    try {
      setShareLoading("download-trace");
      assertTraceHasEnoughPoints(context);
      const uri = await generateTracePngFromPath(context.path, {
        ref: savedRouteShareRef,
        zoneCoords: context.zoneCoords,
        isZone: context.isZone,
        filename: `wayper-png-${context.runId || Date.now()}`,
        width: RUN_SHARE_CARD_SIZE.trace.width,
        height: RUN_SHARE_CARD_SIZE.trace.height,
      });
      await logShareDiagnostics("saved-download-trace", { ...context, generatedUri: uri });
      await saveImageToMediaLibrary(uri, "Wayper");
      Alert.alert("PNG salvo", "O tracado foi salvo na galeria do celular.");
    } catch (error) {
      logShareError("saved-download-trace", error, context);
      showRunShareFailure("Nao foi possivel salvar o PNG do tracado. Tente novamente.", error);
    } finally {
      setShareLoading(null);
    }
  }, [getSavedShareContext, lastSavedRun, shareLoading]);

  /* ============= RENDER GUARD (corrigido) ============= */
  // Não travar a UI apenas por falta de location. Se permissões negadas, mostrar mensagem/fallback.
  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={WAYPER_GREEN} />
      </View>
    );
  }

  if (permissionDenied) {
    return (
      <View style={styles.loading}>
        <Text style={{ color: "#fff", fontWeight: "700", marginBottom: 12, textAlign: "center" }}>
          Permissão de localização não concedida.
        </Text>
        <Text style={{ color: "#ccc", marginBottom: 18, textAlign: "center" }}>
          Ative o GPS e permita localização em primeiro plano nas configurações do dispositivo.
        </Text>
        <TouchableOpacity
          style={[styles.startMainBtn, { width: 220 }]}
          onPress={async () => {
            try {
              // Abre as configurações de app para permitir permissão (expo)
              const { status } = await Location.requestForegroundPermissionsAsync();
              if (status === "granted") {
                setPermissionDenied(false);
                const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                setLocation(p?.coords ? { latitude: p.coords.latitude, longitude: p.coords.longitude } : DEFAULT_COORD);
              } else {
                Alert.alert("Permissão", "Ainda sem permissão. Verifique as configurações do app.");
              }
            } catch (e) {
              Alert.alert("Erro", "Não foi possível solicitar permissão.");
            }
          }}
        >
          <Text style={{ color: "#000", fontWeight: "900" }}>Tentar novamente</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.startMainBtn, { marginTop: 12, backgroundColor: "#444", width: 220 }]}
          onPress={() => {
            // fallback: mostrar mapa centralizado em coords default
            setPermissionDenied(false);
            setLocation(DEFAULT_COORD);
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>Abrir mapa sem localização</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Se chegou aqui, garantimos que o app não ficará preso. Use location fallback se necessário.
  const safeLocation = location || DEFAULT_COORD;
  const replayCenter = Array.isArray(replayPathState) && replayPathState.length > 0 ? replayPathState[replayPathState.length - 1] : null;
  const mapLocation = replaying && replayCenter ? replayCenter : safeLocation;
  const activeZonePreview = showZones && running && mode === "zones" && Array.isArray(polygons) ? polygons : [];
  const finishedZonePreview = showZones && (showRunModal || showSavedModal) && Array.isArray(completedZonePreview) ? completedZonePreview : [];
  const visibleMapZones = finishedZonePreview.length > 0 ? finishedZonePreview : activeZonePreview;
  const liveRoutePath = running || paused ? displayRouteState : routeState;
  const liveRouteSegments = running || paused ? displayRouteSegments : splitPathIntoSegments(liveRoutePath);
  const shouldFollowMap = running && !paused && !replaying && mapFollowEnabled;
  const shouldFollowReplay = replaying;
  const shouldShowRecenterMap = running && !paused && !replaying && !mapFollowEnabled;
  if (!location) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#00e676" />
        <Text style={{ color: "#fff", marginTop: 10 }}>Obtendo localização inicial…</Text>
      </View>
    );
  }

  const startPulseScale = startPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.018],
  });
  const startAuraOpacity = startPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.16, 0.34],
  });
  const savedRunPath = sanitizePath(getRenderablePathForRun(lastSavedRun || {}));
  const savedOriginalPath = sanitizePath(lastSavedRun?.trustedPath || lastSavedRun?.path || savedRunPath);
  const savedSharePath = savedOriginalPath.length > 1 ? savedOriginalPath : savedRunPath;
  const savedRoutePoints = buildRouteSvgPoints(savedSharePath);
  const savedZoneCoords = sanitizePath(lastSavedRun?.zoneCoords || lastSavedRun?.zone?.coords || []);
  const savedRunIsZone = lastSavedRun?.mode === "zones" || Number(lastSavedRun?.area || 0) > 0 || savedZoneCoords.length >= 3;
  const savedZonePoints = buildPolygonSvgPoints(savedZoneCoords);
  const savedTracePoints = savedRunIsZone && savedZonePoints ? savedZonePoints : savedRoutePoints;
  const savedShareZones = savedRunIsZone && savedZoneCoords.length >= 3 ? [{ coords: savedZoneCoords, area: lastSavedRun?.area }] : [];
  const savedRunDisplayTitle = getRunDisplayTitle(lastSavedRun);
  const savedRunName = lastSavedRun?.name || (savedRunIsZone ? "Captura por zonas salva" : "Corrida salva");
  const savedShareSubtitle = savedRunName && savedRunName !== savedRunDisplayTitle
    ? savedRunName
    : (savedRunIsZone ? "Corrida por zonas" : "Corrida livre");
  const savedRunTitle = savedRunIsZone ? "Corrida por zonas salva" : "Corrida salva";
  const savedShareTitle = savedRunIsZone ? "Compartilhar zonas" : "Compartilhar corrida";
  const savedFullCardTitle = savedRunDisplayTitle;
  const savedTraceCardTitle = savedRunDisplayTitle;
  const savedRunDistance = `${((Number(lastSavedRun?.distance) || 0) / 1000).toFixed(2)} km`;
  const savedRunDuration = formatSavedDuration(lastSavedRun?.duration);
  const savedRunPace = formatSavedPace(lastSavedRun?.duration, lastSavedRun?.distance);
  const savedRunDate = formatSavedDate(lastSavedRun?.date);
  const savedZoneArea = `${Math.round(Number(lastSavedRun?.area) || 0)} m2`;
  const savedRunCenter = savedZoneCoords[0] || savedRunPath[0] || safeLocation || DEFAULT_COORD;
  const isShareBusy = shareLoading !== null;

  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
        <WayperMapLibre
          style={styles.map}
          location={mapLocation}
          centerCoordinate={replaying ? replayCenter : (mapFocusCenter || safeLocation)}
          autoCenterOnCoordinate={!running && !replaying}
          routePath={liveRoutePath}
          routeSegments={liveRouteSegments}
          replayPath={replayPathState}
          zones={visibleMapZones}
          territories={territories}
          leaderCells={leaderCells}
          selectedTerritory={selectedTerritory}
          currentUserId={currentUserId}
          showZones={visibleMapZones.length > 0}
          showTerritories
          showLeaderAreas
          showUserLocation={!replaying}
          followUserLocation={shouldFollowMap || shouldFollowReplay}
          initialZoom={replaying ? REPLAY_FOLLOW_ZOOM : 15}
          followZoomLevel={replaying ? REPLAY_FOLLOW_ZOOM : FOLLOW_MAP_ZOOM}
          followAnimationDuration={replaying ? REPLAY_CAMERA_ANIMATION_DURATION : FOLLOW_ANIMATION_DURATION}
          recenterAnimationDuration={RECENTER_ANIMATION_DURATION}
          minCameraMoveIntervalMs={replaying ? REPLAY_CAMERA_MOVE_INTERVAL_MS : MIN_CAMERA_MOVE_INTERVAL_MS}
          recenterSignal={mapRecenterSignal}
          onUserInteraction={handleMapUserInteraction}
          onTerritoryPress={handleTerritoryPress}
          onLeaderCellPress={handleLeaderCellPress}
          onViewportChange={handleTerritoryViewportChange}
          fitToContent={false}
        />
      </View>

      <LinearGradient
        pointerEvents="none"
        colors={["rgba(3,7,11,0)", "rgba(3,7,11,0.38)", "rgba(3,7,11,0.82)"]}
        locations={[0, 0.48, 1]}
        style={styles.mapBottomFade}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(3,7,11,0.42)", "rgba(3,7,11,0)"]}
        style={styles.mapTopVignette}
      />

      {territoryLoading && !running && !replaying ? (
        <View pointerEvents="none" style={styles.territoryLoadingBadge}>
          <ActivityIndicator size="small" color={WayperTheme.colors.primary} />
        </View>
      ) : null}

      {shouldShowRecenterMap && (
        <TouchableOpacity activeOpacity={0.9} style={styles.recenterMapButton} onPress={recenterMapOnUser}>
          <View pointerEvents="none" style={styles.recenterMapGlow} />
          <Ionicons name="locate" size={24} color={WayperTheme.colors.primary} />
        </TouchableOpacity>
      )}

      {(running || replaying) && (
        <View style={[styles.runPanel, paused && styles.runPanelPaused]}>
          <View pointerEvents="none" style={styles.runPanelGlow} />
          <View style={styles.runHeaderRow}>
            <View>
              <Text style={styles.runEyebrow}>{paused ? "Pausada" : running ? "Wayper live" : "Replay"}</Text>
              <Text style={styles.runTitle}>{running ? (mode === "zones" ? "Capturando Zonas" : "Corrida Livre") : "Reproduzindo"}</Text>
            </View>
            <View style={[styles.runStatusPill, paused && styles.runStatusPillPaused]}>
              <View style={[styles.runStatusDot, paused && styles.runStatusDotPaused]} />
              <Text style={styles.runStatusText}>{paused ? "Pausa" : running ? "Ativa" : "Replay"}</Text>
            </View>
          </View>
          <View style={styles.runMetricsRow}>
            <View style={styles.runMetricCard}>
              <View style={styles.runMetricIconWrap}>
                <Ionicons name="time-outline" size={17} color={WayperTheme.colors.primary} />
              </View>
              <Text style={styles.runLabel}>Tempo</Text>
              <Text style={styles.runValue}>{formatTime(timeSec)}</Text>
            </View>
            <View style={styles.runMetricCard}>
              <View style={styles.runMetricIconWrap}>
                <Ionicons name="navigate-outline" size={17} color={WayperTheme.colors.primary} />
              </View>
              <Text style={styles.runLabel}>Distância</Text>
              <Text style={styles.runValue}>{(distanceState / 1000).toFixed(2)} km</Text>
            </View>
          </View>
          {paused && (
            <View style={styles.pausedNotice}>
              <Ionicons name="pause-circle" size={16} color={WayperTheme.colors.warning} />
              <Text style={styles.pausedNoticeText}>GPS pausado. Toque em Retomar para continuar.</Text>
            </View>
          )}
        </View>
      )}

      {!running && !replaying && (
        <View style={styles.menuPanel}>
          <View pointerEvents="none" style={styles.menuTopGlow} />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.startButtonAura,
              {
                opacity: startAuraOpacity,
                transform: [{ scale: startPulseScale }],
              },
            ]}
          />
          <Animated.View style={{ transform: [{ scale: startPulseScale }] }}>
            <Animated.View style={{ transform: [{ scale: startPressAnim }] }}>
              <TouchableOpacity
                activeOpacity={0.94}
                style={styles.startMainBtn}
                onPress={openStartModal}
                onPressIn={handleStartPressIn}
                onPressOut={handleStartPressOut}
              >
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.startMainBtnHighlight,
                    {
                      opacity: startAuraOpacity,
                      transform: [
                        { translateX: startPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [-150, 260] }) },
                        { rotate: "18deg" },
                      ],
                    },
                  ]}
                />
                <View pointerEvents="none" style={styles.startMainBtnGloss} />
                <View style={styles.startMainBtnContent}>
                  <Text style={styles.startMainBtnTxt}>Iniciar Corrida</Text>
                  <View style={styles.startChevronCircle}>
                    <Ionicons name="chevron-forward" size={27} color={WayperTheme.colors.text} />
                  </View>
                </View>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>


        </View>
      )}

      {running && (
        <View style={styles.runActionDock}>
          <View pointerEvents="none" style={styles.runActionDockGlow} />
          <TouchableOpacity
            activeOpacity={0.9}
            style={[styles.runControlButton, paused ? styles.resumeControlButton : styles.pauseControlButton]}
            onPress={paused ? resumeRun : pauseRun}
          >
            <Ionicons
              name={paused ? "play" : "pause"}
              size={21}
              color={paused ? WayperTheme.colors.textInverse : WayperTheme.colors.primary}
            />
            <Text style={[styles.runControlText, paused && styles.resumeControlText]}>{paused ? "Retomar" : "Pausar"}</Text>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.9} style={[styles.runControlButton, styles.finishControlButton]} onPress={stopRun}>
            <Ionicons name="stop" size={20} color={WayperTheme.colors.text} />
            <Text style={[styles.runControlText, styles.finishControlText]}>Finalizar</Text>
          </TouchableOpacity>
        </View>
      )}
      {replaying && (
        <View style={styles.replayDock}>
          <View pointerEvents="none" style={styles.runActionDockGlow} />
          <View style={styles.replaySpeedRow}>
            {REPLAY_SPEED_OPTIONS.map((speed) => {
              const selected = replaySpeed === speed;
              return (
                <TouchableOpacity
                  key={`replay-speed-${speed}`}
                  activeOpacity={0.88}
                  style={[styles.replaySpeedButton, selected && styles.replaySpeedButtonActive]}
                  onPress={() => setReplayPlaybackSpeed(speed)}
                >
                  <Text style={[styles.replaySpeedText, selected && styles.replaySpeedTextActive]}>{speed}x</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <WPButton
            title="Parar reproducao"
            variant="danger"
            icon={<Ionicons name="stop-circle-outline" size={20} color={WayperTheme.colors.text} />}
            onPress={stopReplay}
            style={styles.bottomAction}
          />
        </View>
      )}

      {/* ... resto das modais e UI idênticas ao original (mantive as mesmas modais do seu código) */}
      {/* Run list modal */}
      <Modal visible={showRunsModal} animationType="slide" transparent={true} onRequestClose={closeRunsModal}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Suas Corridas</Text>
            <FlatList
              data={runsList}
              keyExtractor={(item) => String(item.id || (item._tempId || (item._tempId = uid())))}
              style={{ flex: 1 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.runItem} onPress={() => openRunDetails(item)}>
                  <Text style={styles.runDate}>{item.date}</Text>
                  <Text style={styles.runStats}>{(item.distance / 1000).toFixed(2)} km • {Math.round(item.duration)} s</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.closeBtn} onPress={closeRunsModal}>
              <Text style={styles.closeBtnText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Run saved modal */}
      <Modal
        visible={showSavedModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowSavedModal(false);
          setSavedShareVisible(false);
          setCompletedZonePreview([]);
        }}
      >
        <View style={styles.savedOverlay}>
          <View style={styles.savedModalContent}>
            <View style={styles.savedHandle} />
            <ScrollView
              style={styles.savedModalScroller}
              contentContainerStyle={styles.savedModalScrollContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
            <View style={styles.savedHeroRow}>
              <View style={styles.savedBadgeOuter}>
                <View style={styles.savedBadgeInner}>
                  <Ionicons name="checkmark" size={32} color={WayperTheme.colors.textInverse} />
                </View>
              </View>
              <View style={styles.savedHeroText}>
                <Text style={styles.savedEyebrow}>Wayper finalizado</Text>
                <Text style={styles.savedTitle}>{savedRunTitle}</Text>
                <Text style={styles.savedSubtitle} numberOfLines={1}>{savedRunName}</Text>
              </View>
            </View>

            <View style={styles.savedMetricRow}>
              <View style={styles.savedMetric}>
                <Ionicons name="navigate-outline" size={19} color={WayperTheme.colors.primary} />
                <Text style={styles.savedMetricValue}>{savedRunDistance}</Text>
                <Text style={styles.savedMetricLabel}>Distância</Text>
              </View>
              <View style={styles.savedMetric}>
                <Ionicons name="timer-outline" size={19} color={WayperTheme.colors.primary} />
                <Text style={styles.savedMetricValue}>{savedRunDuration}</Text>
                <Text style={styles.savedMetricLabel}>Tempo</Text>
              </View>
                <View style={styles.savedMetric}>
                  <Ionicons name={savedRunIsZone ? "map-outline" : "calendar-outline"} size={19} color={WayperTheme.colors.primary} />
                  <Text style={styles.savedMetricValue} numberOfLines={1}>{savedRunIsZone ? savedZoneArea : savedRunDate}</Text>
                  <Text style={styles.savedMetricLabel}>{savedRunIsZone ? "Area" : "Data"}</Text>
                </View>
            </View>

            <TouchableOpacity activeOpacity={0.9} style={styles.savedPrimaryAction} onPress={goToSavedRunDetail}>
              <Ionicons name="reader-outline" size={21} color={WayperTheme.colors.textInverse} />
              <Text style={styles.savedPrimaryText}>Ver corrida</Text>
              <Ionicons name="chevron-forward" size={22} color={WayperTheme.colors.textInverse} />
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.88} style={styles.savedSecondaryAction} onPress={replaySavedRun}>
              <Ionicons name="play-circle-outline" size={22} color={WayperTheme.colors.primary} />
              <Text style={styles.savedSecondaryText}>Reproduzir corrida</Text>
            </TouchableOpacity>

            {false ? (
            <View style={styles.savedShareBlock}>
              <View style={styles.savedShareHeader}>
                <View>
                  <Text style={styles.savedShareTitle}>{savedShareTitle}</Text>
                  <Text style={styles.savedShareHint}>Arraste para escolher o visual</Text>
                </View>
                <Ionicons name="swap-horizontal-outline" size={22} color={WayperTheme.colors.textMuted} />
              </View>

              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                removeClippedSubviews={false}
                contentContainerStyle={styles.shareCarousel}
              >
                <View collapsable={false} style={[styles.shareCard, styles.shareFullCard]}>
                  <View style={styles.shareExportHeader}>
                    <View>
                      <Text style={styles.shareExportEyebrow}>Wayper finalizado</Text>
                      <Text style={styles.shareExportTitle}>{savedFullCardTitle}</Text>
                    </View>
                    <View style={styles.shareMiniLogo}>
                      <Ionicons name="flash" size={16} color={WayperTheme.colors.textInverse} />
                    </View>
                  </View>
                  <View style={styles.shareMapArtwork}>
                    <Svg width="100%" height="100%" viewBox="0 0 320 210">
                      <Defs>
                        <SvgLinearGradient id="shareRouteGlow" x1="0" y1="0" x2="1" y2="1">
                          <Stop offset="0" stopColor={WayperTheme.colors.primaryLight} stopOpacity="1" />
                          <Stop offset="1" stopColor={WayperTheme.colors.primary} stopOpacity="1" />
                        </SvgLinearGradient>
                      </Defs>
                      <SvgRect x="0" y="0" width="320" height="210" fill="#03070B" />
                      <SvgPath d="M0 52 L78 12 L145 62 L222 24 L320 78 L320 0 L0 0 Z" fill="#0B141D" opacity="0.9" />
                      <SvgPath d="M0 178 L70 132 L132 168 L205 121 L320 162 L320 210 L0 210 Z" fill="#081018" opacity="0.95" />
                      <SvgLine x1="-18" y1="70" x2="338" y2="116" stroke="#263542" strokeWidth="13" opacity="0.75" />
                      <SvgLine x1="-18" y1="70" x2="338" y2="116" stroke="#6F7A86" strokeWidth="3" opacity="0.34" />
                      <SvgLine x1="42" y1="230" x2="282" y2="-20" stroke="#263542" strokeWidth="10" opacity="0.58" />
                      <SvgLine x1="42" y1="230" x2="282" y2="-20" stroke="#6F7A86" strokeWidth="2" opacity="0.28" />
                      <SvgLine x1="0" y1="140" x2="320" y2="42" stroke="#13232E" strokeWidth="4" opacity="0.55" />
                      {savedRunIsZone && savedTracePoints ? (
                        <>
                          <SvgPolygon points={savedTracePoints} fill={WayperTheme.colors.primarySoft} stroke={WayperTheme.colors.primaryGlow} strokeWidth="18" strokeLinejoin="round" opacity="0.46" />
                          <SvgPolygon points={savedTracePoints} fill="rgba(0, 230, 118, 0.30)" stroke="url(#shareRouteGlow)" strokeWidth="7" strokeLinejoin="round" />
                        </>
                      ) : savedTracePoints ? (
                        <>
                          <SvgPolyline points={savedTracePoints} fill="none" stroke={WayperTheme.colors.primaryGlow} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" opacity="0.36" />
                          <SvgPolyline points={savedTracePoints} fill="none" stroke="url(#shareRouteGlow)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
                        </>
                      ) : (
                        <SvgCircle cx="160" cy="105" r="22" fill={WayperTheme.colors.primary} opacity="0.9" />
                      )}
                    </Svg>
                  </View>
                  <View style={styles.shareCardFooter}>
                    <View>
                      <Text style={styles.shareCardTitle}>{savedFullCardTitle}</Text>
                      <Text style={styles.shareCardSubtitle}>{savedRunIsZone ? `${savedZoneArea} • ${savedRunDistance}` : `${savedRunDistance} • ${savedRunDuration}`}</Text>
                    </View>
                    <View style={styles.shareMiniLogo}>
                      <Ionicons name="flash" size={16} color={WayperTheme.colors.textInverse} />
                    </View>
                  </View>
                  <View style={styles.shareMetricGrid}>
                    <ShareMiniMetric label="Tempo" value={savedRunDuration} />
                    <ShareMiniMetric label="Pace" value={savedRunPace} />
                    <ShareMiniMetric label="Km" value={savedRunDistance} />
                  </View>
                </View>

                <View collapsable={false} style={[styles.shareCard, styles.shareTraceCard]}>
                  <Text style={styles.traceTitle}>{savedTraceCardTitle}</Text>
                  <View style={styles.traceSvgWrap}>
                    <Svg width="100%" height="100%" viewBox="0 0 320 210">
                      <Defs>
                        <SvgLinearGradient id="traceGlow" x1="0" y1="0" x2="1" y2="1">
                          <Stop offset="0" stopColor={WayperTheme.colors.primaryLight} stopOpacity="1" />
                          <Stop offset="1" stopColor={WayperTheme.colors.primary} stopOpacity="1" />
                        </SvgLinearGradient>
                      </Defs>
                      {savedRunIsZone && savedTracePoints ? (
                        <>
                          <SvgPolygon points={savedTracePoints} fill={WayperTheme.colors.primarySoft} stroke={WayperTheme.colors.primaryGlow} strokeWidth="18" strokeLinejoin="round" opacity="0.5" />
                          <SvgPolygon points={savedTracePoints} fill="rgba(0, 230, 118, 0.24)" stroke="url(#traceGlow)" strokeWidth="7" strokeLinejoin="round" />
                        </>
                      ) : savedTracePoints ? (
                        <>
                          <SvgPolyline points={savedTracePoints} fill="none" stroke={WayperTheme.colors.primaryGlow} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" opacity="0.32" />
                          <SvgPolyline points={savedTracePoints} fill="none" stroke="url(#traceGlow)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
                        </>
                      ) : (
                        <SvgCircle cx="160" cy="105" r="20" fill={WayperTheme.colors.primary} opacity="0.9" />
                      )}
                    </Svg>
                  </View>
                  <View style={styles.traceFooter}>
                    <Text style={styles.traceMetric}>{savedRunIsZone ? savedZoneArea : savedRunDistance}</Text>
                    <Text style={styles.traceMetricMuted}>{savedRunDuration}</Text>
                  </View>
                  <View style={styles.traceMetricGrid}>
                    <ShareMiniMetric label="Tempo" value={savedRunDuration} />
                    <ShareMiniMetric label="Pace" value={savedRunPace} />
                    <ShareMiniMetric label="Km" value={savedRunDistance} />
                  </View>
                </View>
              </ScrollView>

              <View style={styles.shareActionRow}>
                <TouchableOpacity
                  activeOpacity={0.88}
                  disabled={isShareBusy}
                  style={[styles.shareActionButton, isShareBusy && styles.shareButtonDisabled]}
                  onPress={shareSavedRunFullImage}
                >
                  <Ionicons name="image-outline" size={19} color={WayperTheme.colors.textInverse} />
                  <Text style={styles.shareActionText}>{shareLoading === "share-image" ? "Gerando..." : "Imagem"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.88}
                  disabled={isShareBusy}
                  style={[styles.shareActionButton, styles.shareActionButtonSecondary, isShareBusy && styles.shareButtonDisabled]}
                  onPress={shareSavedRunRouteImage}
                >
                  <Ionicons name="git-branch-outline" size={19} color={WayperTheme.colors.primary} />
                  <Text style={[styles.shareActionText, styles.shareActionTextSecondary]}>
                    {shareLoading === "share-trace" ? "Gerando..." : savedRunIsZone ? "Zona PNG" : "Traçado PNG"}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.shareDownloadRow}>
                <TouchableOpacity
                  activeOpacity={0.86}
                  disabled={isShareBusy}
                  style={[styles.shareDownloadButton, isShareBusy && styles.shareButtonDisabled]}
                  onPress={saveSavedRunFullImage}
                >
                  <Ionicons name="download-outline" size={18} color={WayperTheme.colors.primary} />
                  <Text style={styles.shareDownloadText}>{shareLoading === "download-image" ? "Salvando..." : "Download"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.86}
                  disabled={isShareBusy}
                  style={[styles.shareDownloadButton, isShareBusy && styles.shareButtonDisabled]}
                  onPress={saveSavedRunRouteImage}
                >
                  <Ionicons name="download-outline" size={18} color={WayperTheme.colors.primary} />
                  <Text style={styles.shareDownloadText}>{shareLoading === "download-trace" ? "Salvando..." : "Download"}</Text>
                </TouchableOpacity>
              </View>
            </View>
            ) : (
              <TouchableOpacity
                activeOpacity={0.88}
                style={styles.savedSecondaryAction}
                onPress={() => setSavedShareVisible(true)}
              >
                <Ionicons name="share-social-outline" size={22} color={WayperTheme.colors.primary} />
                <Text style={styles.savedSecondaryText}>{savedShareTitle}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              activeOpacity={0.82}
              style={styles.savedCloseAction}
              onPress={() => {
                setShowSavedModal(false);
                setSavedShareVisible(false);
                setCompletedZonePreview([]);
              }}
            >
              <Text style={styles.savedCloseText}>Fechar</Text>
            </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <RunShareModal
        visible={savedShareVisible}
        onClose={() => setSavedShareVisible(false)}
        run={lastSavedRun}
        path={savedSharePath}
        zoneCoords={savedZoneCoords}
        isZone={savedRunIsZone}
        title={savedFullCardTitle}
        subtitle={savedShareSubtitle}
        distance={savedRunDistance}
        duration={savedRunDuration}
        pace={savedRunPace}
        date={savedRunDate}
        area={savedZoneArea}
        publicLink={lastSavedRun?.publicLink || lastSavedRun?.publicUrl || lastSavedRun?.shareUrl || lastSavedRun?.url}
      />

      <TerritoryBottomSheet
        territory={showRunModal ? null : selectedTerritory}
        leaderboard={selectedTerritoryLeaderboard}
        currentUserId={currentUserId}
        onClose={closeSelectedTerritory}
        onRunHere={runFromSelectedTerritory}
        onOpenRanking={openSelectedTerritoryRanking}
      />

      {/* RunSummaryModal */}
      <RunSummaryModal
        visible={showRunModal}
        baseRunData={currentRunData}
        captureResult={captureResult}
        onClose={() => setShowRunModal(false)}
        onSave={async (payload) => {
          try {
            const trustedPath = sanitizePath(payload.trustedPath || payload.path || payload.coords || currentRunData?.trustedPath || currentRunData?.path || []);
            const renderPath = sanitizePath(
              payload.renderPath ||
              payload.displayPath ||
              currentRunData?.renderPath ||
              currentRunData?.displayPath ||
              (trustedPath.length > 1 ? buildSummaryRenderPath(trustedPath) : trustedPath)
            );
            const normalized = {
              ...payload,
              path: trustedPath,
              trustedPath,
              rawPath: sanitizePath(payload.rawPath || currentRunData?.rawPath || []),
              liveRenderPath: sanitizePath(payload.liveRenderPath || currentRunData?.liveRenderPath || []),
              renderPath,
              displayPath: renderPath,
              pathQuality: payload.pathQuality || currentRunData?.pathQuality || null,
              lowConfidenceSegments: payload.lowConfidenceSegments || currentRunData?.lowConfidenceSegments || [],
              smoothingVersion: payload.smoothingVersion || currentRunData?.smoothingVersion || "wayper_tracking_v1",
            };

            const saved = await sync.saveLocalRun?.(normalized);
            sync.scheduleRunsSync?.();

            setRunsList((prev) => {
              const seen = new Set();
              return [saved, ...(Array.isArray(prev) ? prev : [])].filter((item) => {
                if (!item) return false;
                const key = item.zoneId ? `zone:${item.zoneId}` : `run:${item.id || item.date}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
            });
            setLastSavedRun(saved);
            setShowSavedModal(true);

            try {
              const distanceMeters = Number(normalized.distance) || 0;
              const durationSec = Number(normalized.duration) || 0;
              const areaM2 = Number(normalized.area) || 0;
              const durationMs = durationSec * 1000;
              const territoryCapture = normalized.captureResult;
              const territoryCaptureOk = normalized.mode === "zones" && territoryCapture?.ok === true;
              const result = await xpService.awardRunXP?.({
                path: normalized.path,
                distanceMeters,
                durationMs,
                area: 0,
              });

              if (territoryCaptureOk) {
                await xpService.awardTerritoryXP?.({
                  capturedAreaM2: territoryCapture.capturedAreaM2 || areaM2,
                  newAreaM2: territoryCapture.newAreaM2 || 0,
                  stolenAreaM2: territoryCapture.stolenAreaM2 || 0,
                  becameLeaderCount: territoryCapture.becameLeaderInCells?.length || 0,
                  conqueredCount: territoryCapture.conqueredCount || 0,
                  affectedUsersCount: territoryCapture.affectedUsersCount || 0,
                  runId: normalized.id || saved?.id,
                  territoryId: normalized.territoryId || normalized.zoneId || saved?.territoryId || saved?.zoneId,
                });
              } else if (areaM2 > 0 && normalized.territoryCaptureFailedReason !== "capture_failed") {
                await xpService.awardZoneXP?.({
                  id: normalized.zoneId || saved?.zoneId || saved?.id,
                  area: areaM2,
                });
              }

              debug("XP applied for run:", result?.xp || result?.applied, result?.computed);
            } catch (err) {
              debug("Erro ao aplicar XP via xpService:", err);
              try {
                await updateProfileStats?.({
                  distance: payload.distance,
                  duration: payload.duration,
                  area: 0,
                  isZone: false,
                });
                if (Number(payload.area || 0) > 0) {
                  if (payload.captureResult?.ok) {
                    await updateTerritoryProfileStats?.({
                      capturedAreaM2: payload.captureResult.capturedAreaM2 || payload.area,
                      stolenAreaM2: payload.captureResult.stolenAreaM2 || 0,
                      becameLeaderCount: payload.captureResult.becameLeaderInCells?.length || 0,
                      conqueredCount: payload.captureResult.conqueredCount || 0,
                      isActor: true,
                    });
                  } else {
                    await updateProfileStats?.({
                      distance: 0,
                      duration: 0,
                      area: payload.area,
                      isZone: true,
                    });
                  }
                }
              } catch (e) {
                debug("Fallback updateProfileStats failed", e);
              }
            }
          } catch (e) {
            debug("RunSummaryModal onSave failed", e);
            Alert.alert("Erro", "Não foi possível salvar a corrida.");
          } finally {
            setShowRunModal(false);
          }
        }}
      />

      {/* mode picker */}
      <Modal visible={selectModeVisible} transparent animationType="fade">
        <View style={styles.modeOverlay}>
          <View style={styles.modeBox}>
            <View style={styles.modeHandle} />
            <View style={styles.modeHeaderRow}>
              <View style={styles.modeIconWrap}>
                <Ionicons name="flash-outline" size={25} color={WayperTheme.colors.primary} />
              </View>
              <View style={styles.modeTitleWrap}>
                <Text style={styles.modeEyebrow}>Wayper run</Text>
                <Text style={styles.modeTitle}>Tipo de corrida</Text>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.modeOption}
              onPress={() => {
                setSelectModeVisible(false);
                startWithCountdown("free");
              }}
            >
              <View style={styles.modeOptionIcon}>
                <Ionicons name="walk-outline" size={23} color={WayperTheme.colors.textInverse} />
              </View>
              <View style={styles.modeOptionTextWrap}>
                <Text style={styles.modeOptionTitle}>Corrida Livre</Text>
                <Text style={styles.modeOptionSubtitle}>Registre percurso, tempo e distância.</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={WayperTheme.colors.primary} />
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.9}
              style={[styles.modeOption, styles.modeOptionSecondary]}
              onPress={() => {
                setSelectModeVisible(false);
                startWithCountdown("zones");
              }}
            >
              <View style={[styles.modeOptionIcon, styles.modeOptionIconSecondary]}>
                <Ionicons name="map-outline" size={23} color={WayperTheme.colors.primary} />
              </View>
              <View style={styles.modeOptionTextWrap}>
                <Text style={[styles.modeOptionTitle, styles.modeOptionSecondaryTitle]}>Capturar Zonas</Text>
                <Text style={[styles.modeOptionSubtitle, styles.modeOptionSecondarySubtitle]}>Transforme seu trajeto em área conquistada.</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={WayperTheme.colors.primary} />
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.85} style={styles.cancelBtn} onPress={() => setSelectModeVisible(false)}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {lastSavedRun ? (
        <View pointerEvents="none" style={styles.offscreenShareCards}>
          <RunShareCard
            ref={savedFullShareRef}
            mode="card"
            path={savedSharePath}
            zoneCoords={savedZoneCoords}
            isZone={savedRunIsZone}
            title={savedFullCardTitle}
            subtitle={savedShareSubtitle}
            distance={savedRunDistance}
            duration={savedRunDuration}
            pace={savedRunPace}
            date={savedRunDate}
            area={savedZoneArea}
          />
          <RunShareCard
            ref={savedRouteShareRef}
            mode="trace"
            path={savedSharePath}
            zoneCoords={savedZoneCoords}
            isZone={savedRunIsZone}
            title={savedTraceCardTitle}
            subtitle={savedShareSubtitle}
            distance={savedRunDistance}
            duration={savedRunDuration}
            pace={savedRunPace}
            date={savedRunDate}
            area={savedZoneArea}
          />
        </View>
      ) : null}

      {counting && (
        <View style={styles.countdownOverlay}>
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(0,230,118,0.10)", "rgba(3,7,11,0.86)", "rgba(3,7,11,0.94)"]}
            style={styles.countdownBackdrop}
          />
          <Animated.View
            style={[
              styles.countdownAura,
              {
                opacity: startAuraOpacity,
                transform: [{ scale: startPulseScale }],
              },
            ]}
          />
          <Animated.View style={[styles.countdownBox, { transform: [{ scale: startPulseScale }] }]}>
            <View style={styles.countdownRingOuter}>
              <View style={styles.countdownRingMiddle}>
                <View style={styles.countdownRingInner}>
                  <Text style={styles.countdownLabel}>{countdown > 0 ? "Prepare-se" : "Agora"}</Text>
                  <Text style={styles.countdownNumber}>{countdown > 0 ? countdown : "VAI"}</Text>
                  <Text style={styles.countdownHint}>GPS ativo • Wayper Run</Text>
                </View>
              </View>
            </View>
          </Animated.View>
        </View>
      )}
    </View>
  );
};

function ShareMiniMetric({ label, value }) {
  return (
    <View style={styles.shareMiniMetric}>
      <Text style={styles.shareMiniMetricLabel}>{label}</Text>
      <Text style={styles.shareMiniMetricValue}>{value}</Text>
    </View>
  );
}

export default React.memo(MapScreen);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WayperTheme.colors.background },
  map: { flex: 1 },
  loading: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, backgroundColor: WayperTheme.colors.background },
  mapBottomFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 270,
  },
  mapTopVignette: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 120,
  },
  territoryLoadingBadge: {
    position: "absolute",
    top: 18,
    right: 18,
    width: 42,
    height: 42,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8, 16, 24, 0.86)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  recenterMapButton: {
    position: "absolute",
    right: 22,
    bottom: 132,
    width: 58,
    height: 58,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8, 16, 24, 0.9)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  recenterMapGlow: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: WayperTheme.colors.primarySoft,
    opacity: 0.82,
  },

  runPanel: {
    position: "absolute",
    top: 18,
    left: 18,
    right: 18,
    padding: 15,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: "rgba(8, 16, 24, 0.86)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    ...WayperTheme.shadows.card,
    overflow: "hidden",
  },
  runPanelPaused: {
    borderColor: "rgba(255, 204, 51, 0.36)",
    backgroundColor: "rgba(11, 20, 29, 0.9)",
  },
  runPanelGlow: {
    position: "absolute",
    top: -28,
    left: 42,
    right: 42,
    height: 70,
    borderRadius: 70,
    backgroundColor: WayperTheme.colors.primarySoft,
    opacity: 0.72,
  },
  runHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },
  runEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  runTitle: {
    ...WayperTheme.typography.subtitle,
    letterSpacing: 0.2,
  },
  runStatusPill: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  runStatusPillPaused: {
    backgroundColor: "rgba(255, 204, 51, 0.13)",
    borderColor: "rgba(255, 204, 51, 0.36)",
  },
  runStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: WayperTheme.colors.primary,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  runStatusDotPaused: {
    backgroundColor: WayperTheme.colors.warning,
    shadowColor: WayperTheme.colors.warning,
  },
  runStatusText: {
    color: WayperTheme.colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  runMetricsRow: { flexDirection: "row", gap: 10 },
  runMetricCard: {
    flex: 1,
    minHeight: 82,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: "rgba(16, 27, 37, 0.88)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  runMetricIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginBottom: 5,
  },
  runRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  runLabel: { color: WayperTheme.colors.textMuted, fontWeight: "800", fontSize: 12, textTransform: "uppercase" },
  runValue: { color: WayperTheme.colors.primary, fontWeight: "900", fontSize: 20, marginTop: 1 },
  pausedNotice: {
    marginTop: 12,
    minHeight: 38,
    borderRadius: WayperTheme.radius.pill,
    paddingHorizontal: 13,
    backgroundColor: "rgba(255, 204, 51, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 204, 51, 0.24)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  pausedNoticeText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    flexShrink: 1,
    textAlign: "center",
  },

  menuPanel: {
    position: "absolute",
    bottom: 34,
    left: 28,
    right: 28,
    padding: 16,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: "rgba(11, 20, 29, 0.74)",
    borderColor: WayperTheme.colors.borderStrong,
    borderWidth: 1,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    ...WayperTheme.shadows.card,
  },
  menuTopGlow: {
    position: "absolute",
    top: -1,
    left: "42%",
    right: "42%",
    height: 2,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primaryLight,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 8,
  },
  startButtonAura: {
    position: "absolute",
    left: 22,
    right: 22,
    top: 22,
    bottom: 22,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WAYPER_GREEN,
  },
  startMainBtn: {
    width: "100%",
    minHeight: 72,
    paddingVertical: 19,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: WAYPER_GREEN,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.52,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    ...WayperTheme.shadows.greenGlow,
  },
  startMainBtnHighlight: {
    position: "absolute",
    top: -26,
    bottom: -26,
    width: 86,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.20)",
  },
  startMainBtnGloss: {
    position: "absolute",
    left: 24,
    right: 24,
    top: 8,
    height: 20,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  startMainBtnContent: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  startMainBtnTxt: { color: WayperTheme.colors.textInverse, fontSize: 22, fontWeight: "900" },
  startChevronCircle: {
    position: "absolute",
    right: 28,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,16,9,0.18)",
  },

  bottomButtons: { position: "absolute", bottom: 28, left: 22, right: 22, alignItems: "stretch" },
  replayDock: {
    position: "absolute",
    bottom: 28,
    left: 22,
    right: 22,
    borderRadius: WayperTheme.radius.xxl,
    padding: 10,
    backgroundColor: "rgba(8, 16, 24, 0.9)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    gap: 10,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  replaySpeedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  replaySpeedButton: {
    flex: 1,
    height: 40,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  replaySpeedButtonActive: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primaryLight,
    ...WayperTheme.shadows.greenGlow,
  },
  replaySpeedText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "900",
  },
  replaySpeedTextActive: {
    color: WayperTheme.colors.textInverse,
  },
  bottomAction: { width: "100%" },
  runActionDock: {
    position: "absolute",
    bottom: 28,
    left: 22,
    right: 22,
    minHeight: 86,
    borderRadius: WayperTheme.radius.xxl,
    padding: 10,
    backgroundColor: "rgba(8, 16, 24, 0.84)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  runActionDockGlow: {
    position: "absolute",
    top: -1,
    left: "38%",
    right: "38%",
    height: 2,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primaryLight,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.9,
    shadowRadius: 12,
  },
  runControlButton: {
    flex: 1,
    minHeight: 62,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 9,
    borderWidth: 1,
  },
  pauseControlButton: {
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  resumeControlButton: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primaryLight,
    ...WayperTheme.shadows.greenGlow,
  },
  finishControlButton: {
    backgroundColor: WayperTheme.colors.danger,
    borderColor: WayperTheme.colors.dangerBorder,
    ...WayperTheme.shadows.dangerGlow,
  },
  runControlText: {
    color: WayperTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  resumeControlText: {
    color: WayperTheme.colors.textInverse,
  },
  finishControlText: {
    color: WayperTheme.colors.text,
  },
  modeOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.58)",
    justifyContent: "flex-end",
  },
  modeBox: {
    width: "100%",
    backgroundColor: "rgba(8, 16, 24, 0.97)",
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 22,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.18,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: -10 },
    elevation: 16,
  },
  modeHandle: {
    alignSelf: "center",
    width: 48,
    height: 5,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.borderStrong,
    marginBottom: 18,
  },
  modeHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  modeIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: 14,
  },
  modeTitleWrap: {
    flex: 1,
  },
  modeEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  modeTitle: {
    color: WayperTheme.colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  modeOption: {
    minHeight: 82,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    marginBottom: 12,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  modeOptionSecondary: {
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderColor: WayperTheme.colors.primaryBorder,
    shadowOpacity: 0.08,
  },
  modeOptionSecondaryTitle: {
    color: WayperTheme.colors.text,
  },
  modeOptionSecondarySubtitle: {
    color: WayperTheme.colors.textMuted,
  },
  modeOptionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,16,9,0.18)",
    marginRight: 14,
  },
  modeOptionIconSecondary: {
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  modeOptionTextWrap: {
    flex: 1,
  },
  modeOptionTitle: {
    color: WayperTheme.colors.textInverse,
    fontSize: 17,
    fontWeight: "900",
  },
  modeOptionSubtitle: {
    color: "rgba(3, 16, 9, 0.72)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  cancelBtn: {
    minHeight: 48,
    backgroundColor: WayperTheme.colors.dangerSoft,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    borderWidth: 1,
    borderColor: WayperTheme.colors.dangerBorder,
  },
  cancelBtnText: { color: WayperTheme.colors.text, fontWeight: "900", fontSize: 15 },

  modalContainer: { flex: 1, backgroundColor: "rgba(0,0,0,0.66)", justifyContent: "center", padding: 20 },
  modalContent: { backgroundColor: WayperTheme.colors.surfaceElevated, borderRadius: WayperTheme.radius.xl, padding: 20, height: "80%", borderWidth: 1, borderColor: WayperTheme.colors.borderStrong },
  modalTitle: { ...WayperTheme.typography.title, marginBottom: 12 },
  runItem: { paddingVertical: 14, borderBottomWidth: 1, borderColor: WayperTheme.colors.border },
  runDate: { color: WayperTheme.colors.text, fontSize: 16, fontWeight: "700" },
  runStats: { color: WayperTheme.colors.textMuted, fontSize: 13, marginTop: 2 },
  closeBtn: { backgroundColor: WayperTheme.colors.surfaceSoft, paddingVertical: 14, borderRadius: WayperTheme.radius.pill, marginTop: 18, borderWidth: 1, borderColor: WayperTheme.colors.border },
  closeBtnText: { color: WayperTheme.colors.text, fontWeight: "700", textAlign: "center" },
  savedOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  savedModalContent: {
    width: "100%",
    maxHeight: "92%",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    alignSelf: "center",
    backgroundColor: "rgba(8, 16, 24, 0.97)",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.18,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: -10 },
    elevation: 18,
    overflow: "hidden",
  },
  savedModalScroller: {
    flexGrow: 0,
  },
  savedModalScrollContent: {
    paddingBottom: 22,
  },
  savedHandle: {
    width: 48,
    height: 5,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.borderStrong,
    alignSelf: "center",
    marginBottom: 18,
  },
  savedHeroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
  },
  savedBadgeOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    ...WayperTheme.shadows.greenGlow,
  },
  savedBadgeInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
  },
  savedHeroText: {
    flex: 1,
  },
  savedEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  savedTitle: {
    color: WayperTheme.colors.text,
    fontSize: 27,
    fontWeight: "900",
    marginTop: 2,
  },
  savedSubtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 3,
  },
  savedMetricRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 18,
  },
  savedMetric: {
    flex: 1,
    minHeight: 78,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: 10,
    justifyContent: "center",
  },
  savedMetricValue: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 5,
  },
  savedMetricLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 1,
  },
  savedPrimaryAction: {
    minHeight: 58,
    marginTop: 18,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    ...WayperTheme.shadows.greenGlow,
  },
  savedPrimaryText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 16,
    fontWeight: "900",
  },
  savedSecondaryAction: {
    minHeight: 54,
    marginTop: 10,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  savedSecondaryText: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  savedShareBlock: {
    marginTop: 18,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: "rgba(16, 27, 37, 0.72)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: 12,
  },
  savedShareHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  savedShareTitle: {
    color: WayperTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  savedShareHint: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  shareCarousel: {
    gap: 12,
    paddingRight: 12,
  },
  shareCard: {
    width: 292,
    minHeight: 250,
    borderRadius: WayperTheme.radius.xl,
    overflow: "hidden",
    backgroundColor: WayperTheme.colors.background,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  shareFullCard: {
    padding: 12,
    backgroundColor: "#03070B",
  },
  shareExportHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  shareExportEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  shareExportTitle: {
    color: WayperTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 2,
  },
  shareMapArtwork: {
    height: 166,
    borderRadius: WayperTheme.radius.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    backgroundColor: WayperTheme.colors.background,
  },
  shareMetricGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  shareMiniMetric: {
    flex: 1,
    minHeight: 56,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: "rgba(16, 27, 37, 0.92)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    justifyContent: "center",
    paddingHorizontal: 9,
  },
  shareMiniMetricLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 10,
    fontWeight: "900",
  },
  shareMiniMetricValue: {
    color: WayperTheme.colors.primary,
    fontSize: 13,
    fontWeight: "900",
    marginTop: 3,
  },
  shareMapPreview: {
    height: 170,
    overflow: "hidden",
  },
  shareMap: {
    flex: 1,
  },
  shareCardFooter: {
    minHeight: 78,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(3, 7, 11, 0.94)",
  },
  shareCardTitle: {
    color: WayperTheme.colors.primary,
    fontSize: 18,
    fontWeight: "900",
  },
  shareCardSubtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 3,
  },
  shareMiniLogo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
  },
  shareTraceCard: {
    padding: 14,
    backgroundColor: "#020507",
  },
  traceTitle: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 8,
  },
  traceSvgWrap: {
    height: 174,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: "rgba(0, 230, 118, 0.06)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    overflow: "hidden",
  },
  traceFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 11,
  },
  traceMetricGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 11,
  },
  traceMetric: {
    color: WayperTheme.colors.primary,
    fontSize: 22,
    fontWeight: "900",
  },
  traceMetricMuted: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "800",
  },
  shareActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  shareActionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  shareActionButtonSecondary: {
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  shareActionText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 14,
    fontWeight: "900",
  },
  shareActionTextSecondary: {
    color: WayperTheme.colors.text,
  },
  shareDownloadRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  shareDownloadButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: "rgba(0, 230, 118, 0.08)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  shareDownloadText: {
    color: WayperTheme.colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  shareButtonDisabled: {
    opacity: 0.58,
  },
  savedCloseAction: {
    minHeight: 50,
    marginTop: 12,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  savedCloseText: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  offscreenShareCards: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 1200,
    height: 2600,
    opacity: 1,
    zIndex: -10,
    overflow: "visible",
  },

  countdownOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  countdownBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  countdownAura: {
    position: "absolute",
    width: 310,
    height: 310,
    borderRadius: 155,
    backgroundColor: WayperTheme.colors.primary,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.55,
    shadowRadius: 42,
    shadowOffset: { width: 0, height: 0 },
    elevation: 18,
  },
  countdownBox: {
    width: 282,
    height: 282,
    borderRadius: 141,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(8, 16, 24, 0.78)",
    borderColor: WayperTheme.colors.primaryBorder,
    borderWidth: 1,
    overflow: "hidden",
  },
  countdownRingOuter: {
    width: 242,
    height: 242,
    borderRadius: 121,
    borderWidth: 2,
    borderColor: WayperTheme.colors.primary,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 24,
  },
  countdownRingMiddle: {
    width: 202,
    height: 202,
    borderRadius: 101,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(3, 7, 11, 0.76)",
  },
  countdownRingInner: {
    width: 164,
    height: 164,
    borderRadius: 82,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
  },
  countdownLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: -4,
  },
  countdownNumber: {
    fontSize: 76,
    fontWeight: "900",
    color: WayperTheme.colors.primary,
    textShadowColor: WayperTheme.colors.primaryGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  countdownHint: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: -4,
  },
});
