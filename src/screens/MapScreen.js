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
  Alert,
  AppState,
  Animated,
  Platform,
} from "react-native";
import MapView, { Marker, Polyline, Polygon, AnimatedRegion, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { captureRef } from "react-native-view-shot";
import RunSummaryModal from "../components/Runs/RunSummaryModal";
import formatTime from "../utils/formatTime";
import { getDistance } from "../utils/geo";
import zones from "../utils/zones";
import sync from "../utils/sync";
import xpService from "../services/xp/xpService";
import myLocationIcon from "../../assets/icons/my_location_android.png";
import KalmanFilter2D from "../utils/kalman";

/* Tunáveis */
const MIN_ACCURACY = 75;
const FLUSH_INTERVAL_MS = 300;
const WATCH_TIME_INTERVAL_MS = 1000;
const WATCH_DISTANCE_INTERVAL = 0;
const INITIAL_REGION_DELTA = 0.001;
const COUNTDOWN_DEFAULT = 3;
const MAX_SPIKE_DISTANCE_M = 1000;
const ZONE_MIN_AREA_M2 = 5;
const WAYPER_GREEN = "#00e676";
const ROUTE_CAP = 5000;
const ANIMATE_THROTTLE_MS = 100;
const ANTI_JITTER_M = 0.4;

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
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { latitude: lat, longitude: lon, timestamp: ts };
    })
    .filter(Boolean);

const DEFAULT_COORD = { latitude: -23.55, longitude: -46.63 }; // SP fallback (ajusta se quiser)

/* ================= Component ================= */
const MapScreen = () => {
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const [running, setRunning] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [showZones, setShowZones] = useState(true);
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
  const [mode, setMode] = useState(null);

  const [showRunsModal, setShowRunsModal] = useState(false);
  const [selectedRun, setSelectedRun] = useState(null);
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [lastSavedRun, setLastSavedRun] = useState(null);

  const kalman2dRef = useRef(new KalmanFilter2D()).current;
  const mapRef = useRef(null);
  const mapCaptureRef = useRef(null);
  const markerRef = useRef(null);
  const coordinate = useRef(
    new AnimatedRegion({
      latitude: DEFAULT_COORD.latitude,
      longitude: DEFAULT_COORD.longitude,
      latitudeDelta: 0.001,
      longitudeDelta: 0.001,
    })
  ).current;

  const watcherRef = useRef(null);
  const timerRef = useRef(null);
  const replayIntervalRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const mountedRef = useRef(true);

  const lastPointRef = useRef(null);
  const routeBufferRef = useRef([]);
  const distanceRef = useRef(0);
  const runningRef = useRef(false);

  const routeFadeAnim = useRef(new Animated.Value(1)).current;

  const runsCount = useMemo(() => (Array.isArray(runsList) ? runsList.length : 0), [runsList]);
  const zonesCount = useMemo(() => (Array.isArray(polygons) ? polygons.length : 0), [polygons]);

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
          try {
            coordinate.setValue(initial);
          } catch {}
        }

        appStateSub = AppState.addEventListener("change", (next) => {
          appStateRef.current = next;
        });

        flushTimer = setInterval(() => flushRouteBufferToState(), FLUSH_INTERVAL_MS);

        // carregar dados locais sem bloquear UI
        try {
          const [persistedRuns, persistedZones] = await Promise.all([sync.loadLocalRuns?.(), sync.loadLocalZones?.()]);
          if (Array.isArray(persistedRuns) && persistedRuns.length > 0) setRunsList(persistedRuns.slice().reverse());
          if (Array.isArray(persistedZones) && persistedZones.length > 0) {
            setPolygons(
              persistedZones
                .filter((z) => Array.isArray(z.coords) && z.coords.length >= 3)
                .map((z) => ({ coords: z.coords, area: z.area, id: z.id, date: z.date }))
            );
          }
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

  const flushRouteBufferToState = useCallback(() => {
    try {
      const buf = routeBufferRef.current;
      if (!buf || buf.length === 0) return;
      const mapped = sanitizePath(buf).map((p) => ({ latitude: p.latitude, longitude: p.longitude, timestamp: p.timestamp }));
      if (mapped.length === 0) {
        routeBufferRef.current = [];
        return;
      }
      setRouteState((prev) => {
        const merged = prev.concat(mapped);
        return merged.length > ROUTE_CAP ? merged.slice(merged.length - ROUTE_CAP) : merged;
      });
      routeBufferRef.current = [];
      setDistanceState(distanceRef.current);
    } catch (e) {
      debug("flush catch", e);
    }
  }, []);

  /* ===== Core location update ===== */
  const handleLocationUpdate = useCallback(
    (locObj = {}) => {
      try {
        const lat = Number(locObj.latitude);
        const lon = Number(locObj.longitude);
        const accuracy = locObj.accuracy != null ? Number(locObj.accuracy) : Number.POSITIVE_INFINITY;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        let sLat = lat;
        let sLon = lon;

        try {
          const now = Date.now();
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

        const newPoint = { latitude: sLat, longitude: sLon };
        const now = Date.now();

        if (!handleLocationUpdate._lastAnimate) handleLocationUpdate._lastAnimate = 0;
        if (now - handleLocationUpdate._lastAnimate < ANIMATE_THROTTLE_MS) {
          try {
            coordinate.setValue(newPoint);
          } catch {}
        } else {
          handleLocationUpdate._lastAnimate = now;
          try {
            if (Platform.OS === "android" && markerRef.current?.animateMarkerToCoordinate) {
              markerRef.current.animateMarkerToCoordinate(newPoint, 280);
            } else {
              coordinate.timing({ ...newPoint, duration: 280, useNativeDriver: false }).start();
            }
          } catch (e) {
            try {
              coordinate.setValue(newPoint);
            } catch {}
          }
        }

        if (!runningRef.current) return;

        if (!Number.isFinite(accuracy) || accuracy > MIN_ACCURACY) return;

        const point = { latitude: sLat, longitude: sLon, accuracy, timestamp: now };

        if (!lastPointRef.current) {
          lastPointRef.current = point;
          routeBufferRef.current.push(point);
          return;
        }

        const last = lastPointRef.current;
        const d = getDistance(last.latitude, last.longitude, point.latitude, point.longitude);
        if (!Number.isFinite(d) || d <= 0 || d > MAX_SPIKE_DISTANCE_M) return;
        if (d < ANTI_JITTER_M) return;

        distanceRef.current += d;
        lastPointRef.current = point;
        routeBufferRef.current.push(point);
        setDistanceState(distanceRef.current);
      } catch (e) {
        debug("handleLocationUpdate", e);
      }
    },
    [coordinate, kalman2dRef]
  );

  /* ===== Start / Stop run (mantive lógica, sem alterações semânticas) ===== */
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
        runningRef.current = true;
        setReplaying(false);
        setRouteState([]);
        routeBufferRef.current = [];
        distanceRef.current = 0;
        setDistanceState(0);
        lastPointRef.current = null;
        setTimeSec(0);

        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        timerRef.current = setInterval(() => setTimeSec((t) => t + 1), 1000);

        let pos = null;
        try {
          pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, timeout: 7000 });
        } catch (e) {
          debug("startRun getCurrentPosition failed", e);
        }

        if (pos?.coords) {
          const { latitude: lat, longitude: lon } = pos.coords;
          try {
            coordinate.setValue({ latitude: lat, longitude: lon });
          } catch {}
          if (mapRef.current && Number.isFinite(lat) && Number.isFinite(lon)) {
            try {
              mapRef.current.animateCamera?.({ center: { latitude: lat, longitude: lon }, zoom: 17 });
            } catch (e) {
              debug("animateCamera failed", e);
            }
          }
          handleLocationUpdate({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        }

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
              handleLocationUpdate({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy });
            }
          );
          watcherRef.current = sub;
        } catch (e) {
          debug("watchPositionAsync failed, fallback polling", e);
          const poll = setInterval(async () => {
            try {
              const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
              if (p?.coords) {
                handleLocationUpdate({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy });
              }
            } catch (err) {
              debug("polling error", err);
            }
          }, WATCH_TIME_INTERVAL_MS);
          watcherRef.current = { pollingInterval: poll };
        }
      } catch (e) {
        debug("startRun catch", e);
      }
    },
    [handleLocationUpdate, running]
  );

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
    setReplayPathState([]);
    setTimeSec(0);
    setMode(null);
  }, []);

  const stopRun = useCallback(
    async (opts = {}) => {
      try {
        if (!running) return;

        runningRef.current = false;
        setRunning(false);

        stopWatcherAndPolling();

        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        flushRouteBufferToState();

        const path = sanitizePath(routeState);
        const totalDistance = distanceRef.current;

        const hasValidRun = path.length > 1 && totalDistance > 1 && timeSec > 2;
        if (!hasValidRun) {
          resetRunVisuals();
          return;
        }

        const runData = {
          path,
          distance: totalDistance,
          duration: timeSec,
          avgSpeed: totalDistance && timeSec ? Number(((totalDistance / 1000) / (timeSec / 3600)).toFixed(2)) : 0,
          date: new Date().toISOString(),
        };

        if (mode === "zones") {
          try {
            const savedZone = await sync.createAndSaveZoneFromPath?.(path, { simplifyTolerance: 0.0006, smoothIterations: 0, maxPoints: 300, compressMax: 300 });
            if (savedZone) {
              setPolygons((prev) => [{ coords: savedZone.coords, area: savedZone.area, id: savedZone.id, date: savedZone.date }, ...(Array.isArray(prev) ? prev : [])]);
            }
          } catch (e) {
            debug("zone creation via sync failed", e);
            try {
              const built = zones.buildConvexZone(path, { simplifyTolerance: 0.0006, smoothIterations: 0, maxPoints: 300 });
              const area = zones.calcArea(built);
              if (Array.isArray(built) && built.length >= 3 && area >= ZONE_MIN_AREA_M2) {
                const z = await sync.saveLocalZone?.({ coords: built, area, date: new Date().toISOString() });
                sync.scheduleZonesSync?.();
                setPolygons((prev) => [{ coords: z.coords, area: z.area, id: z.id, date: z.date }, ...(Array.isArray(prev) ? prev : [])]);
              }
            } catch (fallbackErr) {
              debug("fallback zone save failed", fallbackErr);
            }
          }
        }

        await fadeOutRoute();
        resetRunVisuals();

        setCurrentRunData(runData);
        setShowRunModal(true);
      } catch (e) {
        debug("stopRun catch", e);
      }
    },
    [running, routeState, timeSec, resetRunVisuals, fadeOutRoute, stopWatcherAndPolling, flushRouteBufferToState, mode]
  );

  /* ============ Replay (mantive) ============ */
  const startReplay = useCallback(
    (runEntry) => {
      try {
        if (!runEntry || !Array.isArray(runEntry.path) || runEntry.path.length === 0) return;
        stopWatcherAndPolling();
        setReplaying(true);
        runningRef.current = false;
        setRunning(false);
        setRouteState([]);
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
            return;
          }
          const p = path[idx++];
          setReplayPathState((prev) => {
            const merged = prev.concat(p);
            return merged.length > ROUTE_CAP ? merged.slice(merged.length - ROUTE_CAP) : merged;
          });

          try {
            if (Platform.OS === "android" && markerRef.current?.animateMarkerToCoordinate) {
              markerRef.current.animateMarkerToCoordinate({ latitude: p.latitude, longitude: p.longitude }, 200);
            } else {
              coordinate.timing({ latitude: p.latitude, longitude: p.longitude, duration: 200, useNativeDriver: false }).start();
            }
          } catch {
            try {
              coordinate.setValue({ latitude: p.latitude, longitude: p.longitude });
            } catch {}
          }
        }, 250);
      } catch (e) {
        debug("startReplay catch", e);
      }
    },
    [coordinate, stopWatcherAndPolling]
  );

  const stopReplay = useCallback(() => {
    try {
      if (replayIntervalRef.current) clearInterval(replayIntervalRef.current);
      replayIntervalRef.current = null;
      setReplaying(false);
      setReplayPathState([]);
      setRouteState([]);
    } catch (e) {
      debug("stopReplay catch", e);
    }
  }, []);

  /* ============ UI helpers ============ */
  const openRunsModal = useCallback(() => setShowRunsModal(true), []);
  const closeRunsModal = useCallback(() => {
    setShowRunsModal(false);
    setSelectedRun(null);
  }, []);
  const openRunDetails = useCallback((run) => setSelectedRun(run), []);
  const toggleZones = useCallback(() => setShowZones((s) => !s), []);
  const openStartModal = useCallback(() => setSelectModeVisible(true), []);
  const openRunsList = useCallback(() => setShowRunsModal(true), []);

  /* Capture/share + exports (mantive, sem alterações) */
  const autoCapture = useCallback(async (savedRun) => {
    try {
      if (!mapCaptureRef.current) return;
      const uri = await captureRef(mapCaptureRef.current, { format: "png", quality: 0.9, result: "tmpfile" });
      const dest = FileSystem.cacheDirectory + `wayper_run_${savedRun?.id || Date.now()}.png`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest, { dialogTitle: "Compartilhar Replay Wayper" });
    } catch (e) {
      debug("autoCapture catch", e);
    }
  }, []);

  const captureAndShareMap = useCallback(async (filenamePrefix = "wayper_run") => {
    try {
      if (!mapCaptureRef.current) {
        Alert.alert("Erro", "Mapa indisponível para captura.");
        return;
      }
      const uri = await captureRef(mapCaptureRef.current, { format: "png", quality: 0.9, result: "tmpfile" });
      const dest = FileSystem.cacheDirectory + `${filenamePrefix}_${Date.now()}.png`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, { dialogTitle: "Compartilhar Replay Wayper" });
      } else {
        Alert.alert("Compartilhar", "Compartilhamento não disponível neste dispositivo.");
      }
    } catch (e) {
      debug("captureAndShareMap catch", e);
      Alert.alert("Erro", "Não foi possível capturar o mapa.");
    }
  }, []);

  const pointsToGPX = useCallback((coords = [], meta = {}) => {
    try {
      const safeName = (meta.name || "Wayper Run").replace(/</g, "");
      const header = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Wayper" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${safeName}</name><time>${meta.time || new Date().toISOString()}</time></metadata>\n  <trk><name>${safeName}</name><trkseg>`;
      const pts = sanitizePath(coords).map((p) => `<trkpt lat="${p.latitude}" lon="${p.longitude}"><time>${p.timestamp || ""}</time></trkpt>`).join("\n");
      const footer = `</trkseg></trk></gpx>`;
      return `${header}\n${pts}\n${footer}`;
    } catch (e) {
      debug("pointsToGPX catch", e);
      return "";
    }
  }, []);

  const shareRunAsGPX = useCallback(async (run) => {
    try {
      if (!run || !Array.isArray(run.path)) return;
      const gpx = pointsToGPX(run.path, { name: `Wayper Run ${run.date}`, time: new Date(run.date).toISOString() });
      const path = FileSystem.cacheDirectory + `wayper_run_${run.id || Date.now()}.gpx`;
      await FileSystem.writeAsStringAsync(path, gpx, { encoding: FileSystem.EncodingUTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
      else Alert.alert("Compartilhar", "Compartilhamento não disponível neste dispositivo.");
    } catch (e) {
      debug("shareRunAsGPX catch", e);
      Alert.alert("Erro", "Falha ao gerar/compartilhar GPX.");
    }
  }, [pointsToGPX]);

  const shareRunAsJSON = useCallback(async (run) => {
    try {
      if (!run) return;
      const path = FileSystem.cacheDirectory + `wayper_run_${run.id || Date.now()}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(run));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
      else Alert.alert("Compartilhar", "Compartilhamento não disponível neste dispositivo.");
    } catch (e) {
      debug("shareRunAsJSON catch", e);
      Alert.alert("Erro", "Falha ao gerar/compartilhar JSON.");
    }
  }, []);

  /* Fit map to zones */
  const fitMapToAllZones = useCallback(() => {
    try {
      if (!mapRef.current || !polygons || !Array.isArray(polygons) || polygons.length === 0) return;
      const all = polygons.flatMap((p) => (p && Array.isArray(p.coords) ? p.coords : [])).filter(Boolean);
      if (!all || all.length === 0) return;
      const coords = all.map((c) => ({ latitude: Number(c.latitude), longitude: Number(c.longitude) })).filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
      if (coords.length === 0) return;
      mapRef.current.fitToCoordinates(coords, { edgePadding: { top: 80, right: 80, bottom: 220, left: 80 }, animated: true });
    } catch (e) {
      debug("fitMapToAllZones", e);
    }
  }, [polygons]);

  useEffect(() => {
    if (showZones) {
      const t = setTimeout(() => fitMapToAllZones(), 300);
      return () => clearTimeout(t);
    }
  }, [showZones, fitMapToAllZones]);

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
  if (!location) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#00e676" />
        <Text style={{ color: "#fff", marginTop: 10 }}>Obtendo localização inicial…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View ref={mapCaptureRef} style={{ flex: 1 }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          initialRegion={{
            latitude: safeLocation.latitude,
            longitude: safeLocation.longitude,
            latitudeDelta: 0.001,
            longitudeDelta: 0.001,
          }}
          showsUserLocation={false}
          toolbarEnabled={false}
          loadingEnabled={true}
          loadingIndicatorColor="#00e676"
          moveOnMarkerPress={false}
        >
          {showZones &&
            Array.isArray(polygons) &&
            polygons.map((z, i) =>
              z && Array.isArray(z.coords) && z.coords.length >= 3 ? (
                <Polygon key={z.id || i} coordinates={z.coords} strokeColor="#00b894" fillColor="rgba(0,184,148,0.25)" strokeWidth={4} />
              ) : null
            )}

          {Array.isArray(routeState) && routeState.length >= 2 && routeState.every((p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) && (
            <Polyline coordinates={routeState} strokeWidth={4} strokeColor="#0984e3" lineJoin="round" lineCap="round" />
          )}

          {Array.isArray(replayPathState) && replayPathState.length >= 2 && replayPathState.every((p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) && (
            <Polyline coordinates={replayPathState} strokeWidth={4} strokeColor="#fdcb6e" lineJoin="round" lineCap="round" />
          )}

          {safeLocation && Number.isFinite(safeLocation.latitude) && Number.isFinite(safeLocation.longitude) && (
            <Marker.Animated
              ref={markerRef}
              coordinate={coordinate}
              anchor={{ x: 0.5, y: 0.5 }}
              flat={true}
              tracksViewChanges={false}
              style={{ width: 48, height: 48 }}
              image={myLocationIcon}
            />
          )}
        </MapView>
      </View>

      {(running || replaying) && (
        <View style={styles.runPanel}>
          <Text style={styles.runTitle}>{running ? (mode === "zones" ? "Capturando Zonas" : "Corrida Livre") : "Reproduzindo"}</Text>
          <View style={styles.runRow}>
            <Text style={styles.runLabel}>Tempo</Text>
            <Text style={styles.runValue}>{formatTime(timeSec)}</Text>
          </View>
          <View style={styles.runRow}>
            <Text style={styles.runLabel}>Distância</Text>
            <Text style={styles.runValue}>{(distanceState / 1000).toFixed(2)} km</Text>
          </View>
        </View>
      )}

      {!running && !replaying && (
        <View style={styles.menuPanel}>
          <TouchableOpacity style={styles.startMainBtn} onPress={openStartModal}>
            <Text style={styles.startMainBtnTxt}>Iniciar Corrida</Text>
          </TouchableOpacity>

          <View style={styles.menuRow}>
            <TouchableOpacity style={styles.menuItem} onPress={toggleZones}>
              <Text style={styles.menuItemTitle}>Zonas</Text>
              <Text style={styles.menuItemValue}>{showZones ? "Exibindo" : "Ocultas"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={openRunsList}>
              <Text style={styles.menuItemTitle}>Corridas</Text>
              <Text style={styles.menuItemValue}>{runsCount}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.metaText}>Zonas: {zonesCount} • Corridas: {runsCount}</Text>
        </View>
      )}

      {running && (
        <View style={styles.bottomButtons}>
          <TouchableOpacity style={[styles.mainButton, { backgroundColor: "#d63031" }]} onPress={stopRun}>
            <Text style={styles.mainButtonText}>Finalizar</Text>
          </TouchableOpacity>
        </View>
      )}
      {replaying && (
        <View style={styles.bottomButtons}>
          <TouchableOpacity style={[styles.mainButton, { backgroundColor: "#d63031" }]} onPress={stopReplay}>
            <Text style={styles.mainButtonText}>Parar Reprodução</Text>
          </TouchableOpacity>
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
      <Modal visible={showSavedModal} animationType="slide" transparent={true} onRequestClose={() => setShowSavedModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.savedModalContent}>
            <Text style={styles.detailsTitle}>Corrida salva</Text>
            <Text style={styles.detailsInfo}>Distância: {(lastSavedRun?.distance / 1000)?.toFixed(2) ?? "—"} km</Text>
            <Text style={styles.detailsInfo}>Duração: {lastSavedRun?.duration ?? "—"} s</Text>
            <Text style={styles.detailsInfo}>Data: {lastSavedRun ? new Date(lastSavedRun.date).toLocaleString() : "—"}</Text>
            <TouchableOpacity style={styles.actionBtn} onPress={() => { setShowSavedModal(false); setSelectedRun(lastSavedRun); setShowRunsModal(true); }}>
              <Text style={styles.actionBtnText}>Ver Corrida</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => { setShowSavedModal(false); captureAndShareMap(`wayper_run_${lastSavedRun?.id || Date.now()}`); }}>
              <Text style={styles.actionBtnText}>Compartilhar imagem</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowSavedModal(false)}>
              <Text style={styles.closeBtnText}>Fechar</Text>
            </TouchableOpacity>
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

            setRunsList((prev) => [saved, ...(Array.isArray(prev) ? prev : [])]);
            setLastSavedRun(saved);
            setShowSavedModal(true);

            setTimeout(() => {
              try {
                autoCapture(saved);
              } catch (e) {
                debug("autoCapture failed", e);
              }
            }, 400);

            try {
              const distanceMeters = Number(normalized.distance) || 0;
              const durationSec = Number(normalized.duration) || 0;
              const areaM2 = Number(normalized.area) || 0;
              const result = await xpService.awardRunXP?.({ distance: distanceMeters, duration: durationSec, area: areaM2 });
              debug("XP applied for run:", result?.applied, result?.xpBreakdown);
            } catch (err) {
              debug("Erro ao aplicar XP via xpService:", err);
              try {
                await updateProfileStats?.({ distance: payload.distance, duration: payload.duration, area: payload.area, isZone: false, meta: { runId: saved?.id } });
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

      {/* Run details modal */}
      <Modal visible={!!selectedRun} animationType="slide" transparent={true} onRequestClose={() => setSelectedRun(null)}>
        <View style={styles.modalContainer}>
          <View style={styles.detailsContent}>
            <Text style={styles.detailsTitle}>Detalhes da Corrida</Text>
            <View style={{ height: 200, width: "100%", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
              <MapView style={{ flex: 1 }} initialRegion={{ latitude: Number(selectedRun?.path?.[0]?.latitude) || 0, longitude: Number(selectedRun?.path?.[0]?.longitude) || 0, latitudeDelta: 0.01, longitudeDelta: 0.01 }} scrollEnabled={false} rotateEnabled={false} pitchEnabled={false} zoomEnabled={false} provider={PROVIDER_GOOGLE}>
                {Array.isArray(selectedRun?.path) && selectedRun.path.length >= 2 && selectedRun.path.every(p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) && (<Polyline coordinates={selectedRun.path} strokeWidth={4} strokeColor={WAYPER_GREEN} />)}
                {Array.isArray(selectedRun?.path) && selectedRun.path.length >= 3 && selectedRun.path.every(p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) && (<Polygon coordinates={selectedRun.path} strokeColor="rgba(0,230,118,0.8)" fillColor="rgba(0,230,118,0.15)" strokeWidth={2} />)}
              </MapView>
            </View>
            <Text style={styles.detailsInfo}>Distância: {(selectedRun?.distance / 1000)?.toFixed(2)} km</Text>
            <Text style={styles.detailsInfo}>Duração: {selectedRun?.duration} s</Text>
            <Text style={styles.detailsInfo}>Vel. Média: {selectedRun?.avgSpeed} km/h</Text>
            <Text style={styles.detailsInfo}>Data: {selectedRun?.date}</Text>
            <TouchableOpacity style={styles.actionBtn} onPress={() => { startReplay(selectedRun); setSelectedRun(null); setShowRunsModal(false); }}><Text style={styles.actionBtnText}>Assistir Replay</Text></TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => shareRunAsGPX(selectedRun)}><Text style={styles.actionBtnText}>Exportar GPX</Text></TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => shareRunAsJSON(selectedRun)}><Text style={styles.actionBtnText}>Exportar JSON</Text></TouchableOpacity>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedRun(null)}><Text style={styles.closeBtnText}>Fechar</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* mode picker */}
      <Modal visible={selectModeVisible} transparent animationType="fade">
        <View style={styles.modeOverlay}>
          <View style={styles.modeBox}>
            <Text style={styles.modeTitle}>Selecione o tipo de corrida</Text>
            <TouchableOpacity style={styles.modeBtn} onPress={() => { setSelectModeVisible(false); startWithCountdown("free"); }}><Text style={styles.modeBtnText}>Corrida Livre</Text></TouchableOpacity>
            <TouchableOpacity style={styles.modeBtn} onPress={() => { setSelectModeVisible(false); startWithCountdown("zones"); }}><Text style={styles.modeBtnText}>Capturar Zonas</Text></TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectModeVisible(false)}><Text style={styles.cancelBtnText}>Cancelar</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {counting && (
        <View style={styles.countdownOverlay}><View style={styles.countdownBox}><Text style={styles.countdownNumber}>{countdown > 0 ? countdown : "VAI"}</Text></View></View>
      )}
    </View>
  );
};

export default React.memo(MapScreen);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  map: { flex: 1 },
  loading: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },

  myLocationDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: WAYPER_GREEN, borderWidth: 3, borderColor: "#000", shadowColor: WAYPER_GREEN, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 8, elevation: 6 },

  runPanel: { position: "absolute", top: 22, left: 16, right: 16, padding: 14, borderRadius: 16, backgroundColor: "rgba(15, 15, 15, 0.55)", borderWidth: 1, borderColor: "rgba(0,255,200,0.15)" },
  runTitle: { fontSize: 17, fontWeight: "900", textAlign: "center", color: "#eaffff", marginBottom: 8, letterSpacing: 0.8 },
  runRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  runLabel: { color: "#c4f6f6", fontWeight: "600" },
  runValue: { color: "#fff", fontWeight: "800" },

  menuPanel: { position: "absolute", bottom: 26, left: 16, right: 16, padding: 18, borderRadius: 18, backgroundColor: "rgba(15,15,15,0.65)", borderColor: "rgba(0,255,200,0.15)", borderWidth: 1 },
  startMainBtn: { width: "100%", paddingVertical: 16, borderRadius: 14, alignItems: "center", marginBottom: 18, backgroundColor: WAYPER_GREEN, shadowColor: WAYPER_GREEN, shadowOpacity: 0.4, shadowRadius: 10 },
  startMainBtnTxt: { color: "#000", fontSize: 19, fontWeight: "900", letterSpacing: 0.5 },

  menuRow: { flexDirection: "row", width: "100%", justifyContent: "space-between", marginBottom: 10 },
  menuItem: { flex: 1, marginHorizontal: 6, paddingVertical: 12, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(0,255,200,0.1)", borderWidth: 1, alignItems: "center" },
  menuItemTitle: { fontWeight: "800", fontSize: 14, color: "#eaffff" },
  menuItemValue: { marginTop: 4, color: "#9dd", fontSize: 12 },

  metaText: { marginTop: 10, color: "#9dd", fontSize: 12, textAlign: "center", opacity: 0.8 },

  bottomButtons: { position: "absolute", bottom: 22, width: "100%", alignItems: "center" },
  mainButton: { width: "75%", paddingVertical: 14, borderRadius: 16, alignItems: "center", backgroundColor: "#ff1744", shadowColor: "#ff1744", shadowOpacity: 0.5, shadowRadius: 12 },
  mainButtonText: { color: "#fff", fontWeight: "900", fontSize: 16, letterSpacing: 0.6 },

  modeOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 },
  modeBox: { width: "100%", backgroundColor: "rgba(15,15,15,0.9)", padding: 22, borderRadius: 16, borderWidth: 1, borderColor: "rgba(0,255,200,0.2)" },
  modeTitle: { fontSize: 22, fontWeight: "900", textAlign: "center", marginBottom: 22, color: "#eaffff" },
  modeBtn: { backgroundColor: WAYPER_GREEN, paddingVertical: 14, borderRadius: 12, alignItems: "center", marginBottom: 12 },
  modeBtnText: { color: "#000", fontWeight: "900", fontSize: 17 },
  cancelBtn: { backgroundColor: "#ff1744", paddingVertical: 12, borderRadius: 12, alignItems: "center", marginTop: 6 },
  cancelBtnText: { color: "#fff", fontWeight: "900", fontSize: 15 },

  modalContainer: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 20 },
  modalContent: { backgroundColor: "#0d0f12", borderRadius: 18, padding: 20, height: "80%" },
  modalTitle: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 12 },
  runItem: { paddingVertical: 12, borderBottomWidth: 1, borderColor: "#333" },
  runDate: { color: "#fff", fontSize: 16, fontWeight: "700" },
  runStats: { color: "#aaa", fontSize: 13, marginTop: 2 },

  detailsContent: { backgroundColor: "#0d0f12", borderRadius: 18, padding: 20 },
  detailsTitle: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 12, textAlign: "center" },
  detailsInfo: { color: "#aaa", fontSize: 14, marginTop: 8 },
  actionBtn: { backgroundColor: WAYPER_GREEN, paddingVertical: 12, borderRadius: 12, marginTop: 12 },
  actionBtnText: { color: "#000", fontWeight: "800", textAlign: "center", fontSize: 16 },
  closeBtn: { backgroundColor: "#1c1c1c", paddingVertical: 12, borderRadius: 12, marginTop: 18 },
  closeBtnText: { color: "#fff", fontWeight: "700", textAlign: "center" },
  savedModalContent: { backgroundColor: "#0d0f12", borderRadius: 18, padding: 20, width: "100%", maxHeight: 360, alignSelf: "center" },

  countdownOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center" },
  countdownBox: { width: 240, height: 240, borderRadius: 20, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,255,200,0.05)", borderColor: "rgba(0,255,200,0.25)", borderWidth: 1 },
  countdownNumber: { fontSize: 110, fontWeight: "900", color: "#00ffe1" },
});
