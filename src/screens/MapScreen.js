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
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { LinearGradient } from "expo-linear-gradient";
import ViewShot, { captureRef } from "react-native-view-shot";
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
import RunSummaryModal from "../components/Runs/RunSummaryModal";
import { WPButton } from "../components/ui";
import { WayperTheme } from "../theme/wayperTheme";
import formatTime from "../utils/formatTime";
import { getDistance } from "../utils/geo";
import zones from "../utils/zones";
import sync from "../utils/sync";
import { beautifyRoutePath, calculateRouteDistance, finalizeRoutePath } from "../utils/routeDrawing";
import xpService from "../services/xp/xpService";
import { updateProfileStats } from "../services/profile/profileService";
import KalmanFilter2D from "../utils/kalman";

/* Tunáveis */
const TARGET_GPS_ACCURACY_M = 42;
const MAX_GPS_ACCURACY_M = 65;
const FLUSH_INTERVAL_MS = 300;
const WATCH_TIME_INTERVAL_MS = 1000;
const WATCH_DISTANCE_INTERVAL = 0;
const INITIAL_REGION_DELTA = 0.001;
const COUNTDOWN_DEFAULT = 3;
const MAX_SPIKE_DISTANCE_M = 1000;
const ZONE_MIN_AREA_M2 = 5;
const WAYPER_GREEN = WayperTheme.colors.primary;
const ROUTE_CAP = 5000;
const ANTI_JITTER_M = 1.1;
const MAX_RUNNING_SPEED_MPS = 10.5;
const MAX_REASONABLE_STEP_M = 110;
const ZONE_PREVIEW_INTERVAL_MS = 1400;
const SHARE_CAPTURE_OPTIONS = {
  format: "png",
  quality: 1,
  result: "tmpfile",
  handleGLSurfaceViewOnAndroid: true,
};
const BACKGROUND_LOCATION_TASK = "WAYPER_ACTIVE_RUN_LOCATION";

let backgroundLocationUpdateHandler = null;

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
          timestamp: loc.timestamp,
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

const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const sanitizePath = (arr = []) =>
  (Array.isArray(arr) ? arr : [])
    .map((p) => {
      if (!p) return null;
      const lat = Number(p.latitude ?? p.lat);
      const lon = Number(p.longitude ?? p.lon ?? p.lng);
      const ts = p.timestamp ?? p.time ?? null;
      const accuracy = p.accuracy != null ? Number(p.accuracy) : null;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        latitude: lat,
        longitude: lon,
        timestamp: ts,
        ...(Number.isFinite(accuracy) ? { accuracy } : {}),
      };
    })
    .filter(Boolean);

const formatSavedDuration = (seconds = 0) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const formatSavedPace = (seconds = 0, meters = 0) => {
  const distanceKm = Number(meters) / 1000;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0.005) return "--";
  const paceSeconds = Math.round((Number(seconds) || 0) / distanceKm);
  if (!Number.isFinite(paceSeconds) || paceSeconds <= 0) return "--";
  const m = Math.floor(paceSeconds / 60);
  const s = paceSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}/km`;
};

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
  const points = beautifyRoutePath(sanitizePath(path), {
    toleranceM: 3.5,
    minPointDistanceM: 1.4,
    spikeToleranceM: 7,
    maxPoints: 700,
    preserveTurns: true,
  });
  if (points.length < 2) return "";

  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = Math.max(maxLat - minLat, 0.000001);
  const lngRange = Math.max(maxLng - minLng, 0.000001);
  const drawWidth = width - padding * 2;
  const drawHeight = height - padding * 2;

  return points
    .map((p) => {
      const x = padding + ((p.longitude - minLng) / lngRange) * drawWidth;
      const y = padding + (1 - (p.latitude - minLat) / latRange) * drawHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

const buildPolygonSvgPoints = (coords = [], width = 320, height = 210, padding = 28) => {
  const points = sanitizePath(coords);
  if (points.length < 3) return "";

  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = Math.max(maxLat - minLat, 0.000001);
  const lngRange = Math.max(maxLng - minLng, 0.000001);
  const drawWidth = width - padding * 2;
  const drawHeight = height - padding * 2;

  return points
    .map((p) => {
      const x = padding + ((p.longitude - minLng) / lngRange) * drawWidth;
      const y = padding + (1 - (p.latitude - minLat) / latRange) * drawHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

const DEFAULT_COORD = WAYPER_FALLBACK_COORD;

/* ================= Component ================= */
const MapScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [showZones] = useState(true);
  const [selectModeVisible, setSelectModeVisible] = useState(false);
  const [counting, setCounting] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const [showRunModal, setShowRunModal] = useState(false);
  const [currentRunData, setCurrentRunData] = useState(null);

  const [routeState, setRouteState] = useState([]);
  const [replayPathState, setReplayPathState] = useState([]);
  const [distanceState, setDistanceState] = useState(0);
  const [timeSec, setTimeSec] = useState(0);
  const [runsList, setRunsList] = useState([]);
  const [polygons, setPolygons] = useState([]);
  const [completedZonePreview, setCompletedZonePreview] = useState([]);
  const [mode, setMode] = useState(null);

  const [showRunsModal, setShowRunsModal] = useState(false);
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [lastSavedRun, setLastSavedRun] = useState(null);

  const kalman2dRef = useRef(new KalmanFilter2D()).current;
  const savedFullShareRef = useRef(null);
  const savedRouteShareRef = useRef(null);

  const watcherRef = useRef(null);
  const timerRef = useRef(null);
  const backgroundNotificationRef = useRef(null);
  const backgroundPermissionWarnedRef = useRef(false);
  const timeSecRef = useRef(0);
  const lastNotificationBodyRef = useRef("");
  const replayIntervalRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const mountedRef = useRef(true);

  const lastPointRef = useRef(null);
  const routeBufferRef = useRef([]);
  const routeStateRef = useRef([]);
  const distanceRef = useRef(0);
  const runningRef = useRef(false);
  const modeRef = useRef(null);
  const zonePreviewLastAtRef = useRef(0);

  const routeFadeAnim = useRef(new Animated.Value(1)).current;
  const startPulseAnim = useRef(new Animated.Value(0)).current;
  const startPressAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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
    } catch (e) {
      debug("stopWatcher caught", e);
    }
  }, []);

  const saveCapturedView = useCallback(async (targetRef, filenamePrefix) => {
    try {
      const target = targetRef?.current;
      if (!target) {
        Alert.alert("Baixar imagem", "Preview ainda nao esta pronto.");
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 120));

      let uri = null;
      try {
        uri = typeof target.capture === "function" ? await target.capture() : null;
      } catch (captureErr) {
        debug("ViewShot direct save capture failed, trying captureRef", captureErr);
      }

      if (!uri) {
        uri = await captureRef(target, SHARE_CAPTURE_OPTIONS);
      }

      if (!uri) throw new Error("capture returned empty uri");

      const filename = `${filenamePrefix}_${Date.now()}.png`;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });

      if (FileSystem.StorageAccessFramework?.requestDirectoryPermissionsAsync) {
        const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permission.granted) {
          const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, filename, "image/png");
          await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
          Alert.alert("Imagem salva", "O PNG foi salvo na pasta selecionada.");
          return;
        }
      }

      const dest = FileSystem.documentDirectory + filename;
      await FileSystem.copyAsync({ from: uri, to: dest });
      Alert.alert("Imagem salva", `Arquivo salvo em: ${dest}`);
    } catch (e) {
      debug("saveCapturedView catch", e);
      console.warn("saveCapturedView failed", e);
      Alert.alert("Erro", "Nao foi possivel salvar a imagem.");
    }
  }, []);

  const buildFinalRoutePath = useCallback((path = []) => {
    const clean = sanitizePath(path);
    if (clean.length <= 3) return clean;

    return finalizeRoutePath(clean, {
      minPointDistanceM: 1.1,
      toleranceM: 2.2,
      spikeToleranceM: 7,
      maxPoints: ROUTE_CAP,
      maxAccuracyM: MAX_GPS_ACCURACY_M,
      maxSpeedMps: MAX_RUNNING_SPEED_MPS,
      preserveTurns: true,
    });
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
      const buf = routeBufferRef.current;
      if (!buf || buf.length === 0) return;
      const mapped = sanitizePath(buf).map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        timestamp: p.timestamp,
        ...(Number.isFinite(Number(p.accuracy)) ? { accuracy: Number(p.accuracy) } : {}),
      }));
      if (mapped.length === 0) {
        routeBufferRef.current = [];
        return;
      }
      let nextRouteSnapshot = null;
      setRouteState((prev) => {
        const merged = prev.concat(mapped);
        const capped = merged.length > ROUTE_CAP ? merged.slice(merged.length - ROUTE_CAP) : merged;
        routeStateRef.current = capped;
        nextRouteSnapshot = capped;
        return capped;
      });
      routeBufferRef.current = [];
      setDistanceState(distanceRef.current);
      updateActiveZonePreview(nextRouteSnapshot || routeStateRef.current);
    } catch (e) {
      debug("flush catch", e);
    }
  }, [updateActiveZonePreview]);

  /* ===== Core location update ===== */
  const handleLocationUpdate = useCallback(
    (locObj = {}) => {
      try {
        const lat = Number(locObj.latitude);
        const lon = Number(locObj.longitude);
        const accuracy = locObj.accuracy != null ? Number(locObj.accuracy) : Number.POSITIVE_INFINITY;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const timestamp = Number(locObj.timestamp);
        const now = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();

        let sLat = lat;
        let sLon = lon;

        try {
          const smooth = kalman2dRef.filter(lat, lon, Number.isFinite(accuracy) ? Number(accuracy) : 999, now) || {};
          if (Number.isFinite(Number(smooth.latitude))) sLat = Number(smooth.latitude);
          if (Number.isFinite(Number(smooth.longitude))) sLon = Number(smooth.longitude);
        } catch (kalErr) {
          debug("kalman error", kalErr);
        }

        setLocation((prev) => {
          if (prev && prev.latitude === sLat && prev.longitude === sLon) return prev;
          return { latitude: sLat, longitude: sLon };
        });

        if (!runningRef.current) return;

        if (!Number.isFinite(accuracy) || accuracy > MAX_GPS_ACCURACY_M) return;

        const point = { latitude: sLat, longitude: sLon, accuracy, timestamp: now };

        if (!lastPointRef.current) {
          lastPointRef.current = point;
          routeBufferRef.current.push(point);
          return;
        }

        const last = lastPointRef.current;
        const d = getDistance(last.latitude, last.longitude, point.latitude, point.longitude);
        if (!Number.isFinite(d) || d <= 0 || d > MAX_SPIKE_DISTANCE_M) return;

        const lastTimestamp = Number(last.timestamp);
        const dtSec = Number.isFinite(lastTimestamp) && now > lastTimestamp ? Math.max(0.25, (now - lastTimestamp) / 1000) : null;
        const speedMps = dtSec ? d / dtSec : null;
        const speedLimit = MAX_RUNNING_SPEED_MPS + Math.min(2.5, accuracy / 25);
        if (speedMps != null && d > 8 && speedMps > speedLimit) return;
        if (d > MAX_REASONABLE_STEP_M && (speedMps == null || speedMps > speedLimit)) return;

        const jitterFloor = Math.max(ANTI_JITTER_M, Math.min(3.2, Math.max(accuracy, Number(last.accuracy) || accuracy) * 0.08));
        if (accuracy > TARGET_GPS_ACCURACY_M && d < accuracy * 0.55) return;
        if (d < jitterFloor) return;

        distanceRef.current += d;
        lastPointRef.current = point;
        routeBufferRef.current.push(point);
        setDistanceState(distanceRef.current);
      } catch (e) {
        debug("handleLocationUpdate", e);
      }
    },
    [kalman2dRef]
  );

  useEffect(() => {
    const handler = (locObj) => handleLocationUpdate(locObj);
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
    accuracy: Location.Accuracy.BestForNavigation,
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

    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
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
            timestamp: loc.timestamp,
          });
        }
      );
      watcherRef.current = sub;
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
              timestamp: p.timestamp,
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
        setRouteState([]);
        routeStateRef.current = [];
        routeBufferRef.current = [];
        setPolygons([]);
        setCompletedZonePreview([]);
        distanceRef.current = 0;
        setDistanceState(0);
        lastPointRef.current = null;
        zonePreviewLastAtRef.current = 0;
        kalman2dRef.reset?.();
        timeSecRef.current = 0;
        setTimeSec(0);

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
            timestamp: pos.timestamp,
          });
        }

        await startLocationWatcher();
        await startBackgroundLocationService();
      } catch (e) {
        debug("startRun catch", e);
      }
    },
    [handleLocationUpdate, kalman2dRef, running, startBackgroundLocationService, startLocationWatcher]
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
      kalman2dRef.reset?.();

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
        const point = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp || Date.now(),
        };
          setLocation({ latitude: point.latitude, longitude: point.longitude });
          lastPointRef.current = point;
        }
      } catch (e) {
        debug("resumeRun getCurrentPosition failed", e);
      }

      await startLocationWatcher();
      await startBackgroundLocationService();
    } catch (e) {
      debug("resumeRun catch", e);
    }
  }, [kalman2dRef, paused, running, startBackgroundLocationService, startLocationWatcher]);

  const fadeOutRoute = useCallback(() => {
    return new Promise((resolve) => {
      try {
        routeFadeAnim.setValue(1);
        Animated.timing(routeFadeAnim, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => {
          setRouteState([]);
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
    lastPointRef.current = null;
    setRouteState([]);
    routeStateRef.current = [];
    setReplayPathState([]);
    setPolygons([]);
    setCompletedZonePreview([]);
    timeSecRef.current = 0;
    setTimeSec(0);
    modeRef.current = null;
    setMode(null);
    setPaused(false);
  }, []);

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

        const bufferedPath = routeStateRef.current.concat(routeBufferRef.current || []);
        flushRouteBufferToState();

        const sanitizedPath = sanitizePath(bufferedPath);
        const fallbackPoint = location || DEFAULT_COORD;
        const rawPath = sanitizedPath.length > 0 ? sanitizedPath : sanitizePath([fallbackPoint]);
        const path = rawPath.length > 1 ? buildFinalRoutePath(rawPath) : rawPath;
        const routeDistance = calculateRouteDistance(path);
        const totalDistance = routeDistance > 0 ? routeDistance : distanceRef.current;
        const totalDuration = timeSecRef.current || timeSec;

        const runData = {
          path,
          distance: totalDistance,
          duration: totalDuration,
          avgSpeed: totalDistance && totalDuration ? Number(((totalDistance / 1000) / (totalDuration / 3600)).toFixed(2)) : 0,
          date: new Date().toISOString(),
          mode: mode || "free",
          area: 0,
          zoneId: null,
          zoneCoords: [],
          zoneCount: 0,
        };

        const canCreateZone = mode === "zones" && path.length >= 6 && totalDistance > 1;
        if (canCreateZone) {
          try {
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
            }
          } catch (e) {
            debug("zone creation via sync failed", e);
            try {
              const built = zones.buildCapturedZone(path, {
                closeDistanceM: 32,
                maxCloseDistanceM: 48,
                requireClosedLoop: true,
                minLoopPoints: 8,
                simplifyTolerance: 0.000015,
                smoothIterations: 1,
                maxPoints: 420,
              });
              const area = zones.calcArea(built);
              if (Array.isArray(built) && built.length >= 3 && area >= ZONE_MIN_AREA_M2) {
                const z = await sync.saveLocalZone?.({ coords: built, area, date: new Date().toISOString() });
                sync.scheduleZonesSync?.();
                runData.area = Number(z?.area || area || 0);
                runData.zoneId = z?.id || null;
                runData.zoneCoords = sanitizePath(z?.coords || built);
                runData.zoneCount = runData.zoneCoords.length >= 3 ? 1 : 0;
              }
            } catch (fallbackErr) {
              debug("fallback zone save failed", fallbackErr);
            }
          }
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
      } catch (e) {
        debug("stopRun catch", e);
      }
    },
    [running, location, timeSec, resetRunVisuals, fadeOutRoute, stopBackgroundLocationService, stopWatcherAndPolling, flushRouteBufferToState, buildFinalRoutePath, mode]
  );

  /* ============ Replay (mantive) ============ */
  const startReplay = useCallback(
    (runEntry) => {
      try {
        if (!runEntry || !Array.isArray(runEntry.path) || runEntry.path.length === 0) return;
        stopWatcherAndPolling();
        stopBackgroundLocationService();
        setReplaying(true);
        runningRef.current = false;
        setRunning(false);
        setPaused(false);
        setRouteState([]);
        routeStateRef.current = [];
        setReplayPathState([]);
        setMode(null);

        if (replayIntervalRef.current) {
          clearInterval(replayIntervalRef.current);
          replayIntervalRef.current = null;
        }

        const path = sanitizePath(runEntry.path);
        let idx = 0;
        replayIntervalRef.current = setInterval(() => {
          if (!path || idx >= path.length) {
            clearInterval(replayIntervalRef.current);
            replayIntervalRef.current = null;
            setReplaying(false);
            setReplayPathState([]);
            setRouteState([]);
            routeStateRef.current = [];
            return;
          }
          const p = path[idx++];
          setReplayPathState((prev) => {
            const merged = prev.concat(p);
            return merged.length > ROUTE_CAP ? merged.slice(merged.length - ROUTE_CAP) : merged;
          });

        }, 250);
      } catch (e) {
        debug("startReplay catch", e);
      }
    },
    [stopBackgroundLocationService, stopWatcherAndPolling]
  );

  const stopReplay = useCallback(() => {
    try {
      if (replayIntervalRef.current) clearInterval(replayIntervalRef.current);
      replayIntervalRef.current = null;
      setReplaying(false);
      setReplayPathState([]);
      setRouteState([]);
      routeStateRef.current = [];
    } catch (e) {
      debug("stopReplay catch", e);
    }
  }, []);

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

  /* Capture/share + exports */
  const shareCapturedView = useCallback(async (targetRef, filenamePrefix, dialogTitle) => {
    try {
      const target = targetRef?.current;
      if (!target) {
        Alert.alert("Compartilhar", "Preview ainda nao esta pronto.");
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 120));

      let uri = null;
      try {
        uri = typeof target.capture === "function" ? await target.capture() : null;
      } catch (captureErr) {
        debug("ViewShot direct capture failed, trying captureRef", captureErr);
      }

      if (!uri) {
        uri = await captureRef(target, SHARE_CAPTURE_OPTIONS);
      }

      if (!uri) throw new Error("capture returned empty uri");

      const dest = FileSystem.cacheDirectory + `${filenamePrefix}_${Date.now()}.png`;
      await FileSystem.copyAsync({ from: uri, to: dest });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, { dialogTitle, mimeType: "image/png" });
      } else {
        Alert.alert("Compartilhar", "Compartilhamento nao disponivel neste dispositivo.");
      }
    } catch (e) {
      debug("shareCapturedView catch", e);
      console.warn("shareCapturedView failed", e);
      Alert.alert("Erro", "Nao foi possivel gerar a imagem para compartilhar.");
    }
  }, []);

  const goToSavedRunDetail = useCallback(() => {
    if (!lastSavedRun) return;
    setShowSavedModal(false);
    setCompletedZonePreview([]);
    setShowRunModal(false);
    setShowRunsModal(false);
    navigation?.closeDrawer?.();
    navigation?.navigate("Corridas", { screen: "RunDetail", params: { run: lastSavedRun } });
  }, [lastSavedRun, navigation]);

  const replaySavedRun = useCallback(() => {
    if (!lastSavedRun) return;
    setShowSavedModal(false);
    setCompletedZonePreview([]);
    setShowRunModal(false);
    setShowRunsModal(false);
    navigation?.closeDrawer?.();
    navigation?.navigate("Mapa");
    setTimeout(() => startReplay(lastSavedRun), 220);
  }, [lastSavedRun, navigation, startReplay]);

  const shareSavedRunFullImage = useCallback(() => {
    if (!lastSavedRun) return;
    shareCapturedView(savedFullShareRef, `wayper_run_full_${lastSavedRun.id || Date.now()}`, "Compartilhar imagem da corrida");
  }, [lastSavedRun, shareCapturedView]);

  const shareSavedRunRouteImage = useCallback(() => {
    if (!lastSavedRun) return;
    shareCapturedView(savedRouteShareRef, `wayper_run_trace_${lastSavedRun.id || Date.now()}`, "Compartilhar tracado da corrida");
  }, [lastSavedRun, shareCapturedView]);

  const saveSavedRunFullImage = useCallback(() => {
    if (!lastSavedRun) return;
    saveCapturedView(savedFullShareRef, `wayper_mapa_${lastSavedRun.id || Date.now()}`);
  }, [lastSavedRun, saveCapturedView]);

  const saveSavedRunRouteImage = useCallback(() => {
    if (!lastSavedRun) return;
    saveCapturedView(savedRouteShareRef, `wayper_png_${lastSavedRun.id || Date.now()}`);
  }, [lastSavedRun, saveCapturedView]);

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
  const activeZonePreview = showZones && running && mode === "zones" && Array.isArray(polygons) ? polygons : [];
  const finishedZonePreview = showZones && (showRunModal || showSavedModal) && Array.isArray(completedZonePreview) ? completedZonePreview : [];
  const visibleMapZones = finishedZonePreview.length > 0 ? finishedZonePreview : activeZonePreview;
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
  const savedRunPath = sanitizePath(lastSavedRun?.path || []);
  const savedRoutePoints = buildRouteSvgPoints(savedRunPath);
  const savedZoneCoords = sanitizePath(lastSavedRun?.zoneCoords || lastSavedRun?.zone?.coords || []);
  const savedRunIsZone = lastSavedRun?.mode === "zones" || Number(lastSavedRun?.area || 0) > 0 || savedZoneCoords.length >= 3;
  const savedZonePoints = buildPolygonSvgPoints(savedZoneCoords);
  const savedTracePoints = savedRunIsZone && savedZonePoints ? savedZonePoints : savedRoutePoints;
  const savedShareZones = savedRunIsZone && savedZoneCoords.length >= 3 ? [{ coords: savedZoneCoords, area: lastSavedRun?.area }] : [];
  const savedRunName = lastSavedRun?.name || (savedRunIsZone ? "Captura por zonas salva" : "Corrida salva");
  const savedRunTitle = savedRunIsZone ? "Corrida por zonas salva" : "Corrida salva";
  const savedShareTitle = savedRunIsZone ? "Compartilhar zonas" : "Compartilhar corrida";
  const savedFullCardTitle = savedRunIsZone ? "Wayper Zone" : "Wayper Run";
  const savedTraceCardTitle = savedRunIsZone ? "Wayper Zone" : "Wayper Trace";
  const savedRunDistance = `${((Number(lastSavedRun?.distance) || 0) / 1000).toFixed(2)} km`;
  const savedRunDuration = formatSavedDuration(lastSavedRun?.duration);
  const savedRunPace = formatSavedPace(lastSavedRun?.duration, lastSavedRun?.distance);
  const savedRunDate = formatSavedDate(lastSavedRun?.date);
  const savedZoneArea = `${Math.round(Number(lastSavedRun?.area) || 0)} m2`;
  const savedRunCenter = savedZoneCoords[0] || savedRunPath[0] || safeLocation || DEFAULT_COORD;

  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
        <WayperMapLibre
          style={styles.map}
          location={safeLocation}
          centerCoordinate={replaying ? replayCenter : safeLocation}
          routePath={routeState}
          replayPath={replayPathState}
          zones={visibleMapZones}
          showZones={visibleMapZones.length > 0}
          showUserLocation={!replaying}
          followUserLocation={running && !paused}
          initialZoom={15}
          followZoomLevel={17}
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
        <View style={styles.bottomButtons}>
          <WPButton
            title="Parar Reprodução"
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
                <ViewShot ref={savedFullShareRef} options={SHARE_CAPTURE_OPTIONS} collapsable={false} style={[styles.shareCard, styles.shareFullCard]}>
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
                </ViewShot>

                <ViewShot ref={savedRouteShareRef} options={SHARE_CAPTURE_OPTIONS} collapsable={false} style={[styles.shareCard, styles.shareTraceCard]}>
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
                </ViewShot>
              </ScrollView>

              <View style={styles.shareActionRow}>
                <TouchableOpacity activeOpacity={0.88} style={styles.shareActionButton} onPress={shareSavedRunFullImage}>
                  <Ionicons name="image-outline" size={19} color={WayperTheme.colors.textInverse} />
                  <Text style={styles.shareActionText}>Imagem</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.88} style={[styles.shareActionButton, styles.shareActionButtonSecondary]} onPress={shareSavedRunRouteImage}>
                  <Ionicons name="git-branch-outline" size={19} color={WayperTheme.colors.primary} />
                  <Text style={[styles.shareActionText, styles.shareActionTextSecondary]}>{savedRunIsZone ? "Zona PNG" : "Tracado PNG"}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.shareDownloadRow}>
                <TouchableOpacity activeOpacity={0.86} style={styles.shareDownloadButton} onPress={saveSavedRunFullImage}>
                  <Ionicons name="download-outline" size={18} color={WayperTheme.colors.primary} />
                  <Text style={styles.shareDownloadText}>Baixar mapa</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.86} style={styles.shareDownloadButton} onPress={saveSavedRunRouteImage}>
                  <Ionicons name="download-outline" size={18} color={WayperTheme.colors.primary} />
                  <Text style={styles.shareDownloadText}>Baixar PNG</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.82}
              style={styles.savedCloseAction}
              onPress={() => {
                setShowSavedModal(false);
                setCompletedZonePreview([]);
              }}
            >
              <Text style={styles.savedCloseText}>Fechar</Text>
            </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* RunSummaryModal */}
      <RunSummaryModal
        visible={showRunModal}
        baseRunData={currentRunData}
        onClose={() => setShowRunModal(false)}
        onSave={async (payload) => {
          try {
            payload.path = payload.path || payload.coords || currentRunData?.path || [];
            const normalized = { ...payload, path: sanitizePath(payload.path) };

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
              const result = await xpService.awardRunXP?.({
                path: normalized.path,
                distanceMeters,
                durationMs,
                area: 0,
              });

              if (areaM2 > 0) {
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
                  await updateProfileStats?.({
                    distance: 0,
                    duration: 0,
                    area: payload.area,
                    isZone: true,
                  });
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
