// src/screens/MapScreen.js
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import MapView, {
  Marker,
  Polyline,
  Polygon,
  AnimatedRegion,
} from "react-native-maps";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { captureRef } from "react-native-view-shot";
import { Ionicons } from "@expo/vector-icons";

// project helpers & services
import formatTime from "../utils/formatTime";
import { getDistance } from "../utils/geo";
import zones from "../utils/zones";
import sync from "../utils/sync";
import RunSummaryModal from "../components/Runs/RunSummaryModal";


/* ---------------------- Constants / Tunables ---------------------- */
const MIN_ACCURACY = 75; // meters tolerated
const FLUSH_INTERVAL_MS = 300; // buffer flush interval
const WATCH_TIME_INTERVAL_MS = 1000;
const WATCH_DISTANCE_INTERVAL = 0;
const INITIAL_REGION_DELTA = 0.001;
const COUNTDOWN_DEFAULT = 3;
const MAX_SPIKE_DISTANCE_M = 1000;
const ZONE_MIN_AREA_M2 = 5;
const WAYPER_GREEN = "#00e676";

/* ---------------------- Small helpers ---------------------- */
const debug = (...args) => {
  try {
    // toggle logs by setting this to false if needed
    // console.log("[MAP]", ...args);
  } catch {}
};

const safeStringify = (obj) => {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
};

const uid = () =>
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

/* ---------------------- Component ---------------------- */
const MapScreen = () => {
  /* ---------------------- UI state ---------------------- */
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);

  const [running, setRunning] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [showZones, setShowZones] = useState(true);
  const [selectModeVisible, setSelectModeVisible] = useState(false);
  const [counting, setCounting] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const [showRunModal, setShowRunModal] = useState(false);
  const [currentRunData, setCurrentRunData] = useState(null);

  /* Metrics & persisted UI */
  const [routeState, setRouteState] = useState([]);
  const [replayPathState, setReplayPathState] = useState([]);
  const [distanceState, setDistanceState] = useState(0);
  const [timeSec, setTimeSec] = useState(0);
  const [runsList, setRunsList] = useState([]);
  const [polygons, setPolygons] = useState([]); // array of {coords, area, id, date}
  const [mode, setMode] = useState(null); // 'free' | 'zones'

  /* modal / details */
  const [showRunsModal, setShowRunsModal] = useState(false);
  const [selectedRun, setSelectedRun] = useState(null);
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [lastSavedRun, setLastSavedRun] = useState(null);

  /* refs (stable across renders) */
  const mapRef = useRef(null);
  const mapCaptureRef = useRef(null);
  const coordinate = useRef(
    new AnimatedRegion({
      latitude: 0,
      longitude: 0,
      latitudeDelta: INITIAL_REGION_DELTA,
      longitudeDelta: INITIAL_REGION_DELTA,
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

  const isActiveTracking = useMemo(() => runningRef.current === true, []);

  /* ---------------------- Initialization ---------------------- */
  useEffect(() => {
    mountedRef.current = true;
    let flushTimer = null;
    let appStateSub = null;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Permissão negada",
            "Ative o GPS e permita localização em primeiro plano."
          );
          setLoading(false);
          return;
        }

        let pos = null;
        try {
          pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Highest,
          });
        } catch (e) {
          debug("initial position failed", e);
        }

        const initial = pos?.coords
          ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
          : { latitude: 0, longitude: 0 };

        if (mountedRef.current) {
          setLocation(initial);
          try {
            coordinate.setValue(initial);
          } catch {}
        }

        appStateSub = AppState.addEventListener("change", (next) => {
          appStateRef.current = next;
        });

        flushTimer = setInterval(() => {
          flushRouteBufferToState();
        }, FLUSH_INTERVAL_MS);

        // load persisted runs and zones (batched)
        try {
          const [persistedRuns, persistedZones] = await Promise.all([
            sync.loadLocalRuns(),
            sync.loadLocalZones(),
          ]);

          if (Array.isArray(persistedRuns) && persistedRuns.length > 0) {
            // keep newest first in UI
            setRunsList(persistedRuns.slice().reverse());
          }

          if (Array.isArray(persistedZones) && persistedZones.length > 0) {
            setPolygons(
              persistedZones.map((z) => ({
                coords: z.coords,
                area: z.area,
                id: z.id,
                date: z.date,
              }))
            );
          }
        } catch (e) {
          debug("load persisted failed", e);
        }
      } catch (err) {
        debug("init catch", err);
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
      if (appStateSub?.remove) appStateSub.remove();
      runningRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------- Stop watcher helper ---------------------- */
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

  /* ---------------------- Flush buffer to state ---------------------- */
  const flushRouteBufferToState = useCallback(() => {
    try {
      const buf = routeBufferRef.current;
      if (!buf || buf.length === 0) return;

      const mapped = buf
        .map((p) => ({
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
          timestamp: p.timestamp,
        }))
        .filter(
          (p) =>
            Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
        );

      if (mapped.length === 0) {
        routeBufferRef.current = [];
        return;
      }

      // append to route state in a functional way to avoid stale closures
      setRouteState((prev) => {
        // avoid huge arrays growing unbounded in memory: cap to last 5000
        const merged = prev.concat(mapped);
        return merged.length > 5000 ? merged.slice(merged.length - 5000) : merged;
      });

      routeBufferRef.current = [];
      setDistanceState(distanceRef.current);
    } catch (e) {
      debug("flush catch", e);
    }
  }, []);

  /* ---------------------- Location handler ---------------------- */
  const handleLocationUpdate = useCallback(
    (locObj = {}) => {
      try {
        const lat = Number(locObj.latitude);
        const lon = Number(locObj.longitude);
        const accuracy = locObj.accuracy != null ? Number(locObj.accuracy) : 9999;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        // keep UI location up-to-date
        setLocation({ latitude: lat, longitude: lon });

        // smoothly animate marker
        try {
          coordinate.timing({
            latitude: lat,
            longitude: lon,
            duration: 280,
            useNativeDriver: false,
          }).start();
        } catch {
          try {
            coordinate.setValue({ latitude: lat, longitude: lon });
          } catch {}
        }

        if (!runningRef.current) return;

        if (!Number.isFinite(accuracy) || accuracy > MIN_ACCURACY) return;

        const point = { latitude: lat, longitude: lon, accuracy, timestamp: Date.now() };

        if (!lastPointRef.current) {
          lastPointRef.current = point;
          routeBufferRef.current.push(point);
          return;
        }

        const last = lastPointRef.current;
        const d = getDistance(last.latitude, last.longitude, point.latitude, point.longitude);

        if (!Number.isFinite(d) || d <= 0 || d > MAX_SPIKE_DISTANCE_M) {
          return;
        }

        distanceRef.current += d;
        lastPointRef.current = point;
        routeBufferRef.current.push(point);
        setDistanceState(distanceRef.current);
      } catch (e) {
        debug("handleLocationUpdate", e);
      }
    },
    [coordinate]
  );

  /* ---------------------- Start with countdown wrapper ---------------------- */
  const startWithCountdown = useCallback(
    (selectedMode = "free") => {
      try {
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
      } catch (e) {
        debug("startWithCountdown catch", e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [counting, running]
  );

  /* ---------------------- Start Run ---------------------- */
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
          pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Highest,
          });
        } catch (e) {
          debug("startRun getCurrentPosition failed", e);
        }

        if (pos?.coords) {
          const { latitude: lat, longitude: lon } = pos.coords;
          try {
            coordinate.setValue({ latitude: lat, longitude: lon });
            mapRef.current?.animateCamera?.({
              center: { latitude: lat, longitude: lon },
              zoom: 17,
            });
            handleLocationUpdate({
              latitude: lat,
              longitude: lon,
              accuracy: pos.coords.accuracy,
            });
          } catch {}
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
              handleLocationUpdate({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                accuracy: loc.coords.accuracy,
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
                });
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

  /* ---------------------- Fade out route animation ---------------------- */
  const fadeOutRoute = useCallback(() => {
    return new Promise((resolve) => {
      try {
        routeFadeAnim.setValue(1);
        Animated.timing(routeFadeAnim, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }).start(() => {
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

      const path = [...routeState];
      const totalDistance = distanceRef.current;

      const hasValidRun =
        path.length > 1 &&
        totalDistance > 1 &&
        timeSec > 2;

      if (!hasValidRun) {
        resetRunVisuals();
        return;
      }

      const runData = {
        path,
        distance: totalDistance,
        duration: timeSec,
        avgSpeed:
          totalDistance && timeSec
            ? Number(
                (totalDistance / 1000 / (timeSec / 3600)).toFixed(2)
              )
            : 0,
        date: new Date().toISOString(),
      };

      /* --------------------- ZONES MODE --------------------- */
      if (mode === "zones") {
        try {
          const savedZone = await sync.createAndSaveZoneFromPath(path, {
            simplifyTolerance: 0.0006,
            smoothIterations: 0,
            maxPoints: 300,
            compressMax: 300,
          });

          if (savedZone) {
            setPolygons((prev) => [
              {
                coords: savedZone.coords,
                area: savedZone.area,
                id: savedZone.id,
                date: savedZone.date,
              },
              ...prev,
            ]);
          }
        } catch (e) {
          debug("zone creation via sync failed", e);
          try {
            const built = zones.buildConvexZone(path, {
              simplifyTolerance: 0.0006,
              smoothIterations: 0,
              maxPoints: 300,
            });
            const area = zones.calcArea(built);
            if (built.length >= 3 && area >= ZONE_MIN_AREA_M2) {
              const z = await sync.saveLocalZone({
                coords: built,
                area,
                date: new Date().toISOString(),
              });
              sync.scheduleZonesSync?.();
              setPolygons((prev) => [
                {
                  coords: z.coords,
                  area: z.area,
                  id: z.id,
                  date: z.date,
                },
                ...prev,
              ]);
            }
          } catch (fallbackErr) {
            debug("fallback zone save failed", fallbackErr);
          }
        }
      }

      await fadeOutRoute();
      resetRunVisuals();

      // AQUI ESTAVA TEU ERRO: AGORA ESTÁ CORRETO.
      setCurrentRunData(runData);
      setShowRunModal(true);
    } catch (e) {
      debug("stopRun catch", e);
    }
  },
  [
    running,
    routeState,
    timeSec,
    resetRunVisuals,
    fadeOutRoute,
    stopWatcherAndPolling,
    flushRouteBufferToState,
    mode,
  ]
);


  /* ---------------------- Replay helpers ---------------------- */
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

        let idx = 0;
        replayIntervalRef.current = setInterval(() => {
          if (!runEntry || idx >= runEntry.path.length) {
            clearInterval(replayIntervalRef.current);
            replayIntervalRef.current = null;
            setReplaying(false);
            setReplayPathState([]);
            setRouteState([]);
            return;
          }

          const p = runEntry.path[idx++];
          setReplayPathState((prev) => prev.concat(p));

          try {
            coordinate.timing({
              latitude: p.latitude,
              longitude: p.longitude,
              duration: 200,
              useNativeDriver: false,
            }).start();
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

  /* ---------------------- UI helpers / modals ---------------------- */
  const openRunsModal = useCallback(() => setShowRunsModal(true), []);
  const closeRunsModal = useCallback(() => {
    setShowRunsModal(false);
    setSelectedRun(null);
  }, []);
  const openRunDetails = useCallback((run) => setSelectedRun(run), []);

  /* ---------------------- Auto capture & share ---------------------- */
  const autoCapture = useCallback(async (savedRun) => {
    try {
      if (!mapCaptureRef.current) return;
      const uri = await captureRef(mapCaptureRef.current, { format: "png", quality: 0.9, result: "tmpfile" });
      const dest = FileSystem.cacheDirectory + `wayper_run_${savedRun?.id || Date.now()}.png`;
      await FileSystem.copyAsync({ from: uri, to: dest });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, { dialogTitle: "Compartilhar Replay Wayper" });
      }
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

  /* ---------------------- GPX / JSON helpers ---------------------- */
  const pointsToGPX = useCallback((coords = [], meta = {}) => {
    try {
      const header = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Wayper" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${(meta.name || "Wayper Run").replace(/</g, "")}</name><time>${meta.time || new Date().toISOString()}</time></metadata>
  <trk><name>${(meta.name || "Wayper Run").replace(/</g, "")}</name><trkseg>`;
      const pts = coords.map((p) => `<trkpt lat="${p.latitude}" lon="${p.longitude}"><time>${p.timestamp || ""}</time></trkpt>`).join("\n");
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

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
      } else {
        Alert.alert("Compartilhar", "Compartilhamento não disponível neste dispositivo.");
      }
    } catch (e) {
      debug("shareRunAsGPX catch", e);
      Alert.alert("Erro", "Falha ao gerar/compartilhar GPX.");
    }
  }, [pointsToGPX]);

  const shareRunAsJSON = useCallback(async (run) => {
    try {
      if (!run) return;
      const path = FileSystem.cacheDirectory + `wayper_run_${run.id || Date.now()}.json`;
      await FileSystem.writeAsStringAsync(path, safeStringify(run), { encoding: FileSystem.EncodingUTF8 });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
      } else {
        Alert.alert("Compartilhar", "Compartilhamento não disponível neste dispositivo.");
      }
    } catch (e) {
      debug("shareRunAsJSON catch", e);
      Alert.alert("Erro", "Falha ao gerar/compartilhar JSON.");
    }
  }, []);

  /* ---------------------- Fit map to show all zones when toggled on ---------------------- */
  const fitMapToAllZones = useCallback(() => {
    try {
      if (!mapRef.current || !polygons || polygons.length === 0) return;
      // collect all coords
      const all = polygons.flatMap((p) => (Array.isArray(p.coords) ? p.coords : []));
      if (all.length === 0) return;
      const coords = all.map((c) => ({ latitude: c.latitude, longitude: c.longitude }));
      mapRef.current.fitToCoordinates(coords, { edgePadding: { top: 80, right: 80, bottom: 220, left: 80 }, animated: true });
    } catch (e) {
      debug("fitMapToAllZones", e);
    }
  }, [polygons]);

  /* whenever showZones toggled on, fit map to them (gentle UX) */
  useEffect(() => {
    if (showZones) {
      // defer slightly to allow UI settle
      const t = setTimeout(() => {
        fitMapToAllZones();
      }, 300);
      return () => clearTimeout(t);
    }
  }, [showZones, fitMapToAllZones]);

  /* ---------------------- Render guard while loading location ---------------------- */
  if (loading || !location) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={WAYPER_GREEN} />
      </View>
    );
  }

  /* ---------------------- JSX (visual preserved) ---------------------- */
  return (
    <View style={styles.container}>
      <View ref={mapCaptureRef} style={{ flex: 1 }}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={{
            latitude: location.latitude,
            longitude: location.longitude,
            latitudeDelta: INITIAL_REGION_DELTA,
            longitudeDelta: INITIAL_REGION_DELTA,
          }}
        >
          {showZones &&
            polygons.map((z, i) => (
              <Polygon
                key={z.id || i}
                coordinates={z.coords}
                strokeColor="#00b894"
                fillColor="rgba(0,184,148,0.25)"
                strokeWidth={8}
              />
            ))}

          {routeState.length > 0 && (
            <Polyline
              coordinates={routeState}
              strokeWidth={8}
              strokeColor="#0984e3"
              lineJoin="round"
              lineCap="round"
            />
          )}

          {replayPathState.length > 0 && (
            <Polyline
              coordinates={replayPathState}
              strokeWidth={8}
              strokeColor="#fdcb6e"
              lineJoin="round"
              lineCap="round"
            />
          )}

          <Marker.Animated coordinate={coordinate}>
            <View style={styles.myLocationDot} />
          </Marker.Animated>
        </MapView>
      </View>

      {(running || replaying) && (
        <View style={styles.runPanel}>
          <Text style={styles.runTitle}>
            {running ? (mode === "zones" ? "Capturando Zonas" : "Corrida Livre") : "Reproduzindo"}
          </Text>
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
          <TouchableOpacity style={styles.startMainBtn} onPress={() => setSelectModeVisible(true)}>
            <Text style={styles.startMainBtnTxt}>Iniciar Corrida</Text>
          </TouchableOpacity>

          <View style={styles.menuRow}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                // toggle showZones and show all if turning on
                setShowZones((s) => {
                  const next = !s;
                  if (!s && polygons.length > 0) {
                    // will trigger useEffect to fit map
                  }
                  return next;
                });
              }}
            >
              <Text style={styles.menuItemTitle}>Zonas</Text>
              <Text style={styles.menuItemValue}>{showZones ? "Exibindo" : "Ocultas"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={() => setShowRunsModal(true)}>
              <Text style={styles.menuItemTitle}>Corridas</Text>
              <Text style={styles.menuItemValue}>{runsList.length}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.metaText}>Zonas: {polygons.length} • Corridas: {runsList.length}</Text>
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

      {/* Runs Modal */}
      <Modal visible={showRunsModal} animationType="slide" transparent={true} onRequestClose={closeRunsModal}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Suas Corridas</Text>

            <FlatList
              data={runsList}
              keyExtractor={(item) => item.id || uid()}
              style={{ flex: 1 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.runItem}
                  onPress={() => {
                    openRunDetails(item);
                  }}
                >
                  <Text style={styles.runDate}>{item.date}</Text>
                  <Text style={styles.runStats}>
                    {(item.distance / 1000).toFixed(2)} km • {Math.round(item.duration)} s
                  </Text>
                </TouchableOpacity>
              )}
            />

            <TouchableOpacity style={styles.closeBtn} onPress={closeRunsModal}>
              <Text style={styles.closeBtnText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Saved run modal */}
      <Modal visible={showSavedModal} animationType="slide" transparent={true} onRequestClose={() => setShowSavedModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.savedModalContent}>
            <Text style={styles.detailsTitle}>Corrida salva</Text>

            <Text style={styles.detailsInfo}>Distância: {(lastSavedRun?.distance / 1000)?.toFixed(2) ?? "—"} km</Text>
            <Text style={styles.detailsInfo}>Duração: {lastSavedRun?.duration ?? "—"} s</Text>
            <Text style={styles.detailsInfo}>
              Data: {lastSavedRun ? new Date(lastSavedRun.date).toLocaleString() : "—"}
            </Text>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                setShowSavedModal(false);
                setSelectedRun(lastSavedRun);
                setShowRunsModal(true);
              }}
            >
              <Text style={styles.actionBtnText}>Ver Corrida</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                setShowSavedModal(false);
                captureAndShareMap(`wayper_run_${lastSavedRun?.id || Date.now()}`);
              }}
            >
              <Text style={styles.actionBtnText}>Compartilhar imagem</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowSavedModal(false)}>
              <Text style={styles.closeBtnText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* RunSummaryModal: customization UI before saving */}
      <RunSummaryModal
        visible={showRunModal}
        baseRunData={currentRunData}
        onClose={() => setShowRunModal(false)}
        onSave={async (payload) => {
          try {
            // ensure payload has path property (compat)
            payload.path = payload.path || payload.coords || currentRunData?.path || [];
            // save via sync (ultra-optimized)
            const saved = await sync.saveLocalRun(payload);
            // schedule background sync if available
            try {
              sync.scheduleRunsSync?.();
            } catch {}

            // update UI lists (newest first)
            setRunsList((prev) => [saved, ...(Array.isArray(prev) ? prev : [])]);

            // keep lastSavedRun reference and show confirmation modal
            setLastSavedRun(saved);
            setShowSavedModal(true);

            // auto capture preview (non-blocking)
            setTimeout(() => {
              try {
                autoCapture(saved);
              } catch (e) {
                debug("autoCapture failed", e);
              }
            }, 400);
          } catch (e) {
            debug("RunSummaryModal onSave failed", e);
            Alert.alert("Erro", "Não foi possível salvar a corrida localmente.");
          } finally {
            setShowRunModal(false);
          }
        }}
      />

      {/* Run details (quick modal) */}
      <Modal visible={!!selectedRun} animationType="slide" transparent={true} onRequestClose={() => setSelectedRun(null)}>
        <View style={styles.modalContainer}>
          <View style={styles.detailsContent}>
            <Text style={styles.detailsTitle}>Detalhes da Corrida</Text>

            <View style={{ height: 200, width: "100%", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
              <MapView
                style={{ flex: 1 }}
                initialRegion={{
                  latitude: selectedRun?.path?.[0]?.latitude || 0,
                  longitude: selectedRun?.path?.[0]?.longitude || 0,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
                scrollEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                zoomEnabled={false}
              >
                <Polyline coordinates={selectedRun?.path || []} strokeWidth={4} strokeColor={WAYPER_GREEN} />
                <Polygon
                  coordinates={selectedRun?.path || []}
                  strokeColor="rgba(0,230,118,0.8)"
                  fillColor="rgba(0,230,118,0.15)"
                  strokeWidth={2}
                />
              </MapView>
            </View>

            <Text style={styles.detailsInfo}>Distância: {(selectedRun?.distance / 1000)?.toFixed(2)} km</Text>
            <Text style={styles.detailsInfo}>Duração: {selectedRun?.duration} s</Text>
            <Text style={styles.detailsInfo}>Vel. Média: {selectedRun?.avgSpeed} km/h</Text>
            <Text style={styles.detailsInfo}>Data: {selectedRun?.date}</Text>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                startReplay(selectedRun);
                setSelectedRun(null);
                setShowRunsModal(false);
              }}
            >
              <Text style={styles.actionBtnText}>Assistir Replay</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtn} onPress={() => shareRunAsGPX(selectedRun)}>
              <Text style={styles.actionBtnText}>Exportar GPX</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtn} onPress={() => shareRunAsJSON(selectedRun)}>
              <Text style={styles.actionBtnText}>Exportar JSON</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedRun(null)}>
              <Text style={styles.closeBtnText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* mode selection modal */}
      <Modal visible={selectModeVisible} transparent animationType="fade">
        <View style={styles.modeOverlay}>
          <View style={styles.modeBox}>
            <Text style={styles.modeTitle}>Selecione o tipo de corrida</Text>
            <TouchableOpacity
              style={styles.modeBtn}
              onPress={() => {
                setSelectModeVisible(false);
                startWithCountdown("free");
              }}
            >
              <Text style={styles.modeBtnText}>Corrida Livre</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modeBtn}
              onPress={() => {
                setSelectModeVisible(false);
                startWithCountdown("zones");
              }}
            >
              <Text style={styles.modeBtnText}>Capturar Zonas</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectModeVisible(false)}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* countdown overlay */}
      {counting && (
        <View style={styles.countdownOverlay}>
          <View style={styles.countdownBox}>
            <Text style={styles.countdownNumber}>{countdown > 0 ? countdown : "VAI"}</Text>
          </View>
        </View>
      )}
    </View>
  );
};

/* export memoized to avoid unnecessary rerenders by parent re-renders */
export default React.memo(MapScreen);

/* =============== styles (preserved visuals) =============== */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },

  map: {
    flex: 1,
  },

  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  myLocationDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#00ffe1",
    borderWidth: 3,
    borderColor: "#000",
    shadowColor: "#00ffe1",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },

  runPanel: {
    position: "absolute",
    top: 22,
    left: 16,
    right: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(15, 15, 15, 0.55)",
    borderWidth: 1,
    borderColor: "rgba(0,255,200,0.15)",
  },

  runTitle: {
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
    color: "#eaffff",
    marginBottom: 8,
    letterSpacing: 0.8,
  },

  runRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },

  runLabel: {
    color: "#c4f6f6",
    fontWeight: "600",
  },

  runValue: {
    color: "#fff",
    fontWeight: "800",
  },

  menuPanel: {
    position: "absolute",
    bottom: 26,
    left: 16,
    right: 16,
    padding: 18,
    borderRadius: 18,
    backgroundColor: "rgba(15,15,15,0.65)",
    borderColor: "rgba(0,255,200,0.15)",
    borderWidth: 1,
  },

  startMainBtn: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 18,
    backgroundColor: WAYPER_GREEN,
    shadowColor: WAYPER_GREEN,
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },

  startMainBtnTxt: {
    color: "#000",
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: 0.5,
  },

  menuRow: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  menuItem: {
    flex: 1,
    marginHorizontal: 6,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(0,255,200,0.1)",
    borderWidth: 1,
    alignItems: "center",
  },

  menuItemTitle: {
    fontWeight: "800",
    fontSize: 14,
    color: "#eaffff",
  },

  menuItemValue: {
    marginTop: 4,
    color: "#9dd",
    fontSize: 12,
  },

  metaText: {
    marginTop: 10,
    color: "#9dd",
    fontSize: 12,
    textAlign: "center",
    opacity: 0.8,
  },

  bottomButtons: {
    position: "absolute",
    bottom: 22,
    width: "100%",
    alignItems: "center",
  },

  mainButton: {
    width: "75%",
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    backgroundColor: "#ff1744",
    shadowColor: "#ff1744",
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },

  mainButtonText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 0.6,
  },

  modeOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },

  modeBox: {
    width: "100%",
    backgroundColor: "rgba(15,15,15,0.9)",
    padding: 22,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,200,0.2)",
  },

  modeTitle: {
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 22,
    color: "#eaffff",
  },

  modeBtn: {
    backgroundColor: WAYPER_GREEN,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },

  modeBtnText: {
    color: "#000",
    fontWeight: "900",
    fontSize: 17,
  },

  cancelBtn: {
    backgroundColor: "#ff1744",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 6,
  },

  cancelBtnText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 15,
  },

  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 20,
  },

  modalContent: {
    backgroundColor: "#0d0f12",
    borderRadius: 18,
    padding: 20,
    height: "80%",
  },
  modalTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 12,
  },
  runItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: "#333",
  },
  runDate: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  runStats: {
    color: "#aaa",
    fontSize: 13,
    marginTop: 2,
  },
  detailsContent: {
    backgroundColor: "#0d0f12",
    borderRadius: 18,
    padding: 20,
  },
  detailsTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 12,
    textAlign: "center",
  },
  detailsInfo: {
    color: "#aaa",
    fontSize: 14,
    marginTop: 8,
  },
  actionBtn: {
    backgroundColor: WAYPER_GREEN,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 12,
  },
  actionBtnText: {
    color: "#000",
    fontWeight: "800",
    textAlign: "center",
    fontSize: 16,
  },
  closeBtn: {
    backgroundColor: "#1c1c1c",
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 18,
  },
  closeBtnText: {
    color: "#fff",
    fontWeight: "700",
    textAlign: "center",
  },
  savedModalContent: {
    backgroundColor: "#0d0f12",
    borderRadius: 18,
    padding: 20,
    width: "100%",
    maxHeight: 360,
    alignSelf: "center",
  },
  countdownOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },

  countdownBox: {
    width: 240,
    height: 240,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,255,200,0.05)",
    borderColor: "rgba(0,255,200,0.25)",
    borderWidth: 1,
  },

  countdownNumber: {
    fontSize: 110,
    fontWeight: "900",
    color: "#00ffe1",
  },
});

