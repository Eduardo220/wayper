import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
import WayperMapLibre, { WAYPER_FALLBACK_COORD } from "../../components/Map/WayperMapLibre";
import RunShareModal from "../../components/Runs/RunShareModal";
import RunShareCard, { RUN_SHARE_CARD_SIZE } from "../../components/Runs/RunShareCard";
import RunSummaryModal from "../../components/Runs/RunSummaryModal";
import { WPButton } from "../../components/ui";
import { WayperTheme } from "../../theme/wayperTheme";
import { auth } from "../../firebaseConfig";
import sync from "../../utils/sync";
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
} from "../../utils/share/runShareExport";
import {
  calculatePaceSecondsPerKm,
  formatPaceFromSeconds,
  getFormattedPace,
  MIN_DISTANCE_FOR_PACE_KM,
} from "../../utils/pace";
import { getRunDisplayTitle } from "../../utils/runDisplayTitle";
import { isRunOwnedByCurrentUser } from "../../utils/runOwnership";
import { normalizeRunPath } from "../../utils/runPath";
import { beautifyRoutePath, getRenderablePathForRun, getRenderableSegmentsForRun, getRunBoundaryPoints } from "../../services/runTracking";

const MIN_BAR_HEIGHT = 22;
const CHART_BASE_HEIGHT = 118;

const debug = (...args) => {
  const enabled = false;
  if (enabled) console.log("[RunDetail]", ...args);
};

const showRunShareFailure = (message, error) => {
  const userMessage = getShareUnavailableMessage(error, message);
  if (error?.code === "TRACE_POINTS_INSUFFICIENT") {
    Alert.alert("Tracado indisponivel", userMessage);
    return;
  }

  showShareError(userMessage, error);
};

const safeNum = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const sanitizePath = (path = []) =>
  (Array.isArray(path) ? path : [])
    .map((point) => {
      if (!point) return null;
      const latitude = safeNum(point.latitude ?? point.lat, NaN);
      const longitude = safeNum(point.longitude ?? point.lon ?? point.lng, NaN);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude, timestamp: point.timestamp ?? null };
    })
    .filter(Boolean);

const buildShareSvgPoints = (coords = [], { width = 320, height = 210, padding = 28, smooth = false } = {}) => {
  const safeCoords = sanitizePath(coords);
  const points = smooth
    ? beautifyRoutePath(safeCoords, { toleranceM: 7, minPointDistanceM: 2, spikeToleranceM: 10, maxPoints: 700 })
    : safeCoords;

  if (points.length < 2) return "";

  const lats = points.map((point) => point.latitude);
  const lngs = points.map((point) => point.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = Math.max(maxLat - minLat, 0.000001);
  const lngRange = Math.max(maxLng - minLng, 0.000001);
  const drawWidth = width - padding * 2;
  const drawHeight = height - padding * 2;

  return points
    .map((point) => {
      const x = padding + ((point.longitude - minLng) / lngRange) * drawWidth;
      const y = padding + (1 - (point.latitude - minLat) / latRange) * drawHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.round(safeNum(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(secondsPerKm = 0) {
  const formatted = formatPaceFromSeconds(secondsPerKm);
  return formatted === "--:--" ? formatted : `${formatted}/km`;
}

function formatDate(date) {
  try {
    if (!date) return "Data indisponivel";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return String(date);
    return parsed.toLocaleString();
  } catch {
    return "Data indisponivel";
  }
}

function haversine(pointA, pointB) {
  const radius = 6371e3;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const latA = toRad(safeNum(pointA.latitude));
  const latB = toRad(safeNum(pointB.latitude));
  const deltaLat = toRad(safeNum(pointB.latitude) - safeNum(pointA.latitude));
  const deltaLng = toRad(safeNum(pointB.longitude) - safeNum(pointA.longitude));
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * c;
}

function buildTimeline(path = [], totalDuration = 0) {
  const points = sanitizePath(path);
  if (points.length === 0) return [];
  if (points.length === 1) return [{ ...points[0], cumulativeMeters: 0, cumulativeTime: 0 }];

  const segments = [];
  let totalMeters = 0;

  for (let index = 1; index < points.length; index += 1) {
    const meters = haversine(points[index - 1], points[index]);
    segments[index - 1] = meters;
    totalMeters += meters;
  }

  const hasTimestamps = points.every((point) => Number.isFinite(Number(point.timestamp)));
  const output = [{ ...points[0], cumulativeMeters: 0, cumulativeTime: 0 }];
  let cumulativeMeters = 0;
  let cumulativeTime = 0;

  for (let index = 1; index < points.length; index += 1) {
    const segmentMeters = segments[index - 1] || 0;
    let segmentTime = 0;

    if (hasTimestamps) {
      const previousTime = Number(points[index - 1].timestamp);
      const currentTime = Number(points[index].timestamp);
      segmentTime = Math.max(0, (currentTime - previousTime) / 1000);
    } else {
      const duration = Math.max(1, safeNum(totalDuration, points.length - 1));
      segmentTime = totalMeters > 0 ? (segmentMeters / totalMeters) * duration : duration / (points.length - 1);
    }

    cumulativeMeters += segmentMeters;
    cumulativeTime += segmentTime;
    output.push({ ...points[index], cumulativeMeters, cumulativeTime });
  }

  return output;
}

function computeSplits(path = [], totalDuration = 0) {
  const timeline = buildTimeline(path, totalDuration);
  if (timeline.length < 2) {
    return { splits: [], pacePerKm: [], avgSpeedKmh: 0, maxSpeedKmh: 0, totalMeters: 0, totalTime: 0 };
  }

  const totalMeters = safeNum(timeline[timeline.length - 1].cumulativeMeters);
  const totalTime = safeNum(timeline[timeline.length - 1].cumulativeTime);
  const avgSpeedKmh = totalTime > 0 ? (totalMeters / totalTime) * 3.6 : 0;
  let maxSpeedKmh = 0;

  for (let index = 1; index < timeline.length; index += 1) {
    const meters = Math.max(0, timeline[index].cumulativeMeters - timeline[index - 1].cumulativeMeters);
    const seconds = Math.max(0.001, timeline[index].cumulativeTime - timeline[index - 1].cumulativeTime);
    maxSpeedKmh = Math.max(maxSpeedKmh, (meters / seconds) * 3.6);
  }

  const splits = [];
  const pacePerKm = [];
  let kmIndex = 1;
  let lastKmTime = 0;
  let lastKmMeters = 0;
  let pointIndex = 0;

  while (kmIndex * 1000 <= totalMeters + 1e-6) {
    while (pointIndex < timeline.length && timeline[pointIndex].cumulativeMeters < kmIndex * 1000) {
      pointIndex += 1;
    }
    if (pointIndex >= timeline.length) break;

    const current = timeline[pointIndex];
    const previous = timeline[pointIndex - 1] || timeline[0];
    const segmentMeters = current.cumulativeMeters - previous.cumulativeMeters;
    const segmentTime = current.cumulativeTime - previous.cumulativeTime;
    const metersBefore = kmIndex * 1000 - previous.cumulativeMeters;
    const ratio = segmentMeters > 0 ? metersBefore / segmentMeters : 0;
    const timeAtKm = previous.cumulativeTime + segmentTime * ratio;
    const kmTime = timeAtKm - lastKmTime;

    splits.push({ km: kmIndex, time: Math.round(kmTime), paceSec: kmTime });
    pacePerKm.push(Math.round(kmTime));
    lastKmTime = timeAtKm;
    lastKmMeters = kmIndex * 1000;
    kmIndex += 1;
  }

  if (totalMeters - lastKmMeters >= MIN_DISTANCE_FOR_PACE_KM * 1000) {
    const partialMeters = totalMeters - lastKmMeters;
    const partialTime = totalTime - lastKmTime;
    const partialPace = calculatePaceSecondsPerKm(partialTime, partialMeters / 1000) || 0;
    splits.push({
      km: +((lastKmMeters / 1000) + (partialMeters / 1000)).toFixed(2),
      time: Math.round(partialTime),
      paceSec: partialPace,
    });
    if (partialPace > 0) pacePerKm.push(partialPace);
  }

  return { splits, pacePerKm, avgSpeedKmh, maxSpeedKmh, totalMeters, totalTime };
}

function RunDetailScreenInner({ route, navigation }) {
  const initialRun = route?.params?.run || null;
  const readOnly = !!(route?.params?.readOnly || route?.params?.viewOnly || initialRun?.readOnly);
  const captureViewRef = useRef(null);
  const shareFullRef = useRef(null);
  const shareTraceRef = useRef(null);
  const anim = useRef(new Animated.Value(0)).current;
  const [currentRun, setCurrentRun] = useState(initialRun);
  const [userAvgPace, setUserAvgPace] = useState(null);
  const [shareVisible, setShareVisible] = useState(false);
  const [shareLoading, setShareLoading] = useState(null);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const run = currentRun;

  useEffect(() => {
    setCurrentRun(initialRun);
  }, [initialRun]);

  useLayoutEffect(() => {
    navigation?.setOptions?.({
      headerRight: currentRun && !readOnly
        ? () => (
            <TouchableOpacity
              activeOpacity={0.82}
              hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
              style={styles.headerOptionsButton}
              onPress={() => setOptionsVisible(true)}
            >
              <Ionicons name="ellipsis-horizontal" size={24} color={WayperTheme.colors.text} />
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [currentRun, navigation, readOnly]);

  const path = useMemo(() => normalizeRunPath(run), [run]);
  const mapSegments = useMemo(
    () => getRenderableSegmentsForRun(run || {}).map((segment) => sanitizePath(segment)).filter((segment) => segment.length > 1),
    [run]
  );
  const mapPath = useMemo(() => {
    const renderPath = sanitizePath(getRenderablePathForRun(run || {}));
    const segmentedPath = mapSegments.flat();
    if (segmentedPath.length > 1) return segmentedPath;
    return renderPath.length > 1 ? renderPath : path;
  }, [mapSegments, path, run]);
  const zoneCoords = useMemo(() => sanitizePath(run?.zoneCoords || run?.zone?.coords || []), [run]);
  const isZoneRun = run?.mode === "zones" || safeNum(run?.area) > 0 || zoneCoords.length >= 3;
  const hasZoneShape = isZoneRun && zoneCoords.length >= 3;
  const midPoint = useMemo(() => {
    if (hasZoneShape) return zoneCoords[0] || WAYPER_FALLBACK_COORD;
    if (mapPath.length === 0) return WAYPER_FALLBACK_COORD;
    return mapPath[Math.floor(mapPath.length / 2)] || mapPath[0] || WAYPER_FALLBACK_COORD;
  }, [hasZoneShape, mapPath, zoneCoords]);

  const stats = useMemo(() => computeSplits(path, run?.duration || 0), [path, run]);
  const totalMeters = stats.totalMeters > 0 ? stats.totalMeters : safeNum(run?.distance);
  const totalTime = stats.totalTime > 0 ? stats.totalTime : safeNum(run?.duration);
  const totalKm = (totalMeters / 1000).toFixed(2);
  const paceSec = calculatePaceSecondsPerKm(totalTime, totalMeters / 1000) || 0;
  const paceDisplay = getFormattedPace(totalTime, totalMeters / 1000, { suffix: "/km" });
  const avgSpeedDisplay = (safeNum(stats.avgSpeedKmh) || safeNum(run?.avgSpeed)).toFixed(1);
  const maxSpeedDisplay = safeNum(stats.maxSpeedKmh).toFixed(1);
  const runTitle = getRunDisplayTitle(run);
  const effort = run?.effort ?? "--";
  const distanceDisplay = `${totalKm} km`;
  const durationDisplay = formatDuration(totalTime);
  const areaDisplay = `${Math.round(safeNum(run?.area))} m2`;
  const shareCardTitle = runTitle;
  const shareTraceTitle = isZoneRun ? "Wayper Zone" : "Wayper Trace";
  const routeEndpointPath = useMemo(
    () => (path.length > 1 ? path : mapPath),
    [mapPath, path]
  );
  const routeBoundary = useMemo(
    () => getRunBoundaryPoints(routeEndpointPath),
    [routeEndpointPath]
  );
  const routeStartPoint = routeBoundary.start;
  const routeEndPoint = routeBoundary.finishCandidate;
  const showRouteBoundaryMarkers = routeBoundary.hasStart;
  const shareRoutePath = useMemo(
    () => routeEndpointPath,
    [routeEndpointPath]
  );
  const shareTracePoints = useMemo(
    () => buildShareSvgPoints(hasZoneShape ? zoneCoords : shareRoutePath, { smooth: false }),
    [hasZoneShape, shareRoutePath, zoneCoords]
  );
  const shareContext = useMemo(
    () => ({
      runId: run?.id,
      path: hasZoneShape ? zoneCoords : shareRoutePath,
      zoneCoords,
      isZone: isZoneRun,
      distanceKm: totalMeters / 1000,
      durationSeconds: totalTime,
    }),
    [hasZoneShape, isZoneRun, run?.id, shareRoutePath, totalMeters, totalTime, zoneCoords]
  );
  const currentUserId = auth.currentUser?.uid || "offline";
  const canReplayRun = useMemo(
    () =>
      !readOnly &&
      !isZoneRun &&
      path.length > 1 &&
      isRunOwnedByCurrentUser(run, currentUserId, { allowLegacyLocal: !readOnly }),
    [currentUserId, isZoneRun, path.length, readOnly, run]
  );

  const handleReplayRun = useCallback(() => {
    if (!canReplayRun || !run) {
      Alert.alert("Replay indisponivel", "O replay esta disponivel apenas para corridas livres do seu historico.");
      return;
    }

    const params = {
      replayRun: run,
      replayReturnTo: { type: "run-detail", run },
      replayRequestId: `${run.id || run.date || "run"}:${Date.now()}`,
      replayAllowLegacyLocal: !readOnly,
    };
    const parent = navigation.getParent?.();
    if (parent) parent.navigate("Mapa", params);
    else navigation.navigate("Mapa", params);
  }, [canReplayRun, navigation, readOnly, run]);

  const handleEditSave = useCallback(
    async (payload) => {
      if (!run?.id) {
        Alert.alert("Editar corrida", "Nao foi possivel identificar esta corrida.");
        return;
      }

      const updatedRun = {
        ...run,
        ...payload,
        id: run.id,
        date: run.date || payload?.date || new Date().toISOString(),
        synced: false,
        updatedAt: new Date().toISOString(),
      };

      const saved = await sync.saveLocalRun(updatedRun);
      sync.scheduleRunsSync?.();
      setCurrentRun(saved);
      navigation?.setParams?.({ run: saved });
      Alert.alert("Corrida atualizada", "As alteracoes foram salvas.");
    },
    [navigation, run]
  );

  const deleteRun = useCallback(async () => {
    if (!run?.id || deleting) return;

    try {
      setDeleting(true);
      const result = await sync.deleteLocalRun?.(run.id, { deleteRemote: true });
      if (!result?.deleted) {
        Alert.alert("Excluir corrida", "Nao foi possivel excluir esta corrida. Tente novamente.");
        return;
      }

      setOptionsVisible(false);
      setEditVisible(false);
      navigation?.goBack?.();
    } catch (error) {
      debug("deleteRun", error);
      Alert.alert("Excluir corrida", "Nao foi possivel excluir esta corrida. Tente novamente.");
    } finally {
      setDeleting(false);
    }
  }, [deleting, navigation, run?.id]);

  const confirmDeleteRun = useCallback(() => {
    setOptionsVisible(false);
    Alert.alert(
      "Excluir corrida",
      "Tem certeza que deseja excluir esta corrida? Essa acao nao pode ser desfeita.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: deleteRun,
        },
      ]
    );
  }, [deleteRun]);

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, [anim]);

  useEffect(() => {
    let mounted = true;

    async function loadAveragePace() {
      if (!run) return;
      try {
        const localRuns = await sync.loadLocalRuns();
        if (!mounted) return;
        const comparable = (Array.isArray(localRuns) ? localRuns : []).filter(
          (item) => item.id !== run.id && safeNum(item.distance) >= MIN_DISTANCE_FOR_PACE_KM * 1000 && safeNum(item.duration) > 0
        );
        const total = comparable.reduce(
          (acc, item) => {
            acc.seconds += safeNum(item.duration);
            acc.km += safeNum(item.distance) / 1000;
            return acc;
          },
          { seconds: 0, km: 0 }
        );
        setUserAvgPace(calculatePaceSecondsPerKm(total.seconds, total.km));
      } catch (error) {
        debug("loadAveragePace", error);
      }
    }

    loadAveragePace();
    return () => {
      mounted = false;
    };
  }, [run]);

  const insight = useMemo(() => {
    if (!userAvgPace || !paceSec) return null;
    const percentage = ((userAvgPace - paceSec) / userAvgPace) * 100;
    const absolute = Math.abs(Math.round(percentage));
    return {
      faster: percentage > 0,
      text: percentage > 0
        ? `Voce foi ${absolute}% mais rapido que sua media.`
        : `Voce ficou ${absolute}% mais lento que sua media.`,
    };
  }, [paceSec, userAvgPace]);

  const shareFullImage = useCallback(async () => {
    if (shareLoading) return;

    try {
      setShareLoading("share-image");
      const uri = await captureRunShareImage(shareFullRef, {
        filename: `wayper-mapa-${run?.id || Date.now()}`,
        width: RUN_SHARE_CARD_SIZE.card.width,
        height: RUN_SHARE_CARD_SIZE.card.height,
      });
      await logShareDiagnostics("detail-share-image", { ...shareContext, generatedUri: uri });
      await shareImageFile(uri, { dialogTitle: "Compartilhar corrida Wayper" });
    } catch (error) {
      logShareError("detail-share-image", error, shareContext);
      showRunShareFailure("Nao foi possivel gerar a imagem para compartilhar. Tente novamente.", error);
    } finally {
      setShareLoading(null);
    }
  }, [run?.id, shareContext, shareLoading]);

  const shareTraceImage = useCallback(async () => {
    if (shareLoading) return;

    try {
      setShareLoading("share-trace");
      assertTraceHasEnoughPoints(shareContext);
      const uri = await generateTracePngFromPath(hasZoneShape ? zoneCoords : shareRoutePath, {
        ref: shareTraceRef,
        zoneCoords,
        isZone: isZoneRun,
        filename: `wayper-png-${run?.id || Date.now()}`,
        width: RUN_SHARE_CARD_SIZE.trace.width,
        height: RUN_SHARE_CARD_SIZE.trace.height,
      });
      await logShareDiagnostics("detail-share-trace", { ...shareContext, generatedUri: uri });
      await shareImageFile(uri, { dialogTitle: "Compartilhar tracado Wayper" });
    } catch (error) {
      logShareError("detail-share-trace", error, shareContext);
      showRunShareFailure("Nao foi possivel gerar o PNG do tracado. Tente novamente.", error);
    } finally {
      setShareLoading(null);
    }
  }, [hasZoneShape, isZoneRun, run?.id, shareContext, shareLoading, shareRoutePath, zoneCoords]);

  const saveFullImage = useCallback(async () => {
    if (shareLoading) return;

    try {
      setShareLoading("download-image");
      const uri = await captureRunShareImage(shareFullRef, {
        filename: `wayper-mapa-${run?.id || Date.now()}`,
        width: RUN_SHARE_CARD_SIZE.card.width,
        height: RUN_SHARE_CARD_SIZE.card.height,
      });
      await logShareDiagnostics("detail-download-image", { ...shareContext, generatedUri: uri });
      await saveImageToMediaLibrary(uri, "Wayper");
      Alert.alert("Imagem salva", "A imagem foi salva na galeria do celular.");
    } catch (error) {
      logShareError("detail-download-image", error, shareContext);
      showRunShareFailure("Nao foi possivel salvar a imagem. Tente novamente.", error);
    } finally {
      setShareLoading(null);
    }
  }, [run?.id, shareContext, shareLoading]);

  const saveTraceImage = useCallback(async () => {
    if (shareLoading) return;

    try {
      setShareLoading("download-trace");
      assertTraceHasEnoughPoints(shareContext);
      const uri = await generateTracePngFromPath(hasZoneShape ? zoneCoords : shareRoutePath, {
        ref: shareTraceRef,
        zoneCoords,
        isZone: isZoneRun,
        filename: `wayper-png-${run?.id || Date.now()}`,
        width: RUN_SHARE_CARD_SIZE.trace.width,
        height: RUN_SHARE_CARD_SIZE.trace.height,
      });
      await logShareDiagnostics("detail-download-trace", { ...shareContext, generatedUri: uri });
      await saveImageToMediaLibrary(uri, "Wayper");
      Alert.alert("PNG salvo", "O tracado foi salvo na galeria do celular.");
    } catch (error) {
      logShareError("detail-download-trace", error, shareContext);
      showRunShareFailure("Nao foi possivel salvar o PNG do tracado. Tente novamente.", error);
    } finally {
      setShareLoading(null);
    }
  }, [hasZoneShape, isZoneRun, run?.id, shareContext, shareLoading, shareRoutePath, zoneCoords]);

  const animStyle = useMemo(
    () => ({
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
    }),
    [anim]
  );

  if (!run) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.invalidText}>Corrida invalida</Text>
      </View>
    );
  }

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Animated.View style={animStyle}>
        <View ref={captureViewRef} collapsable={false} style={styles.captureCard}>
          <View style={styles.heroMap}>
            <WayperMapLibre
              style={styles.map}
              routePath={hasZoneShape ? [] : mapPath}
              routeSegments={hasZoneShape ? [] : mapSegments}
              routeMode="result"
              zones={hasZoneShape ? [{ coords: zoneCoords, area: run?.area }] : []}
              showZones={hasZoneShape}
              centerCoordinate={midPoint}
              showUserLocation={false}
              interactive={false}
              fitToContent={hasZoneShape || mapPath.length > 1}
              showRouteEndpoints={showRouteBoundaryMarkers}
              routeStartCoordinate={routeStartPoint}
              routeEndCoordinate={routeEndPoint}
              contentPadding={{ top: 58, right: 48, bottom: 62, left: 48 }}
            />
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(3,7,11,0.20)", "rgba(3,7,11,0.05)", "rgba(3,7,11,0.88)"]}
              locations={[0, 0.48, 1]}
              style={styles.heroGradient}
            />
            <View style={styles.heroContent}>
              <View style={styles.heroBadge}>
                <Ionicons name={isZoneRun ? "map-outline" : "walk-outline"} size={22} color={WayperTheme.colors.textInverse} />
              </View>
              <View style={styles.heroTextWrap}>
                <Text style={styles.eyebrow}>{isZoneRun ? "Wayper Zone" : "Wayper Run"}</Text>
                <Text style={styles.title} numberOfLines={2}>{runTitle}</Text>
                <Text style={styles.date}>{formatDate(run.date)}</Text>
              </View>
            </View>
          </View>

          <View style={styles.captureMetrics}>
            <MetricTile icon="navigate-outline" label="Distancia" value={`${totalKm} km`} />
            <MetricTile icon="timer-outline" label="Tempo" value={formatDuration(totalTime)} />
            <MetricTile icon="speedometer-outline" label="Pace" value={paceDisplay} />
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.metricGrid}>
            <MetricTile icon="flash-outline" label="Vel. media" value={`${avgSpeedDisplay} km/h`} compact />
            <MetricTile icon="trending-up-outline" label="Vel. max" value={`${maxSpeedDisplay} km/h`} compact />
            <MetricTile icon="fitness-outline" label="Esforco" value={String(effort)} compact accent="cyan" />
          </View>

          {insight ? (
            <LinearGradient
              colors={[
                insight.faster ? "rgba(0,230,118,0.23)" : "rgba(255,204,51,0.18)",
                WayperTheme.colors.surfaceElevated,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.insight}
            >
              <Ionicons
                name={insight.faster ? "rocket-outline" : "pulse-outline"}
                size={22}
                color={insight.faster ? WayperTheme.colors.primary : WayperTheme.colors.warning}
              />
              <Text style={styles.insightText}>{insight.text}</Text>
            </LinearGradient>
          ) : null}

          <SectionCard title="Pace por km" icon="analytics-outline">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartRow}>
              {(stats.pacePerKm.length ? stats.pacePerKm : [Math.round(paceSec || 0)]).map((seconds, index) => {
                const denominator = userAvgPace || Math.max(...(stats.pacePerKm.length ? stats.pacePerKm : [seconds]), 1);
                const isFaster = userAvgPace ? seconds < userAvgPace : true;
                const height = Math.max(MIN_BAR_HEIGHT, Math.min(CHART_BASE_HEIGHT, (seconds / denominator) * CHART_BASE_HEIGHT));
                return (
                  <View style={styles.barWrap} key={`pace-${index}`}>
                    <View style={styles.barRail}>
                      <View
                        style={[
                          styles.bar,
                          {
                            height,
                            backgroundColor: isFaster ? WayperTheme.colors.primary : WayperTheme.colors.warning,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.barLabel}>{formatPace(seconds)}</Text>
                    <Text style={styles.barSub}>{index + 1} km</Text>
                  </View>
                );
              })}
            </ScrollView>
          </SectionCard>

          <SectionCard title="Splits" icon="list-outline">
            {stats.splits.length === 0 ? (
              <Text style={styles.emptyText}>Splits indisponiveis para esta corrida.</Text>
            ) : (
              stats.splits.map((split, index) => (
                <View style={styles.splitRow} key={`split-${index}`}>
                  <Text style={styles.splitKm}>{split.km} km</Text>
                  <Text style={styles.splitTime}>{formatDuration(split.time)}</Text>
                  <Text style={styles.splitPace}>{formatPace(split.paceSec)}</Text>
                </View>
              ))
            )}
          </SectionCard>

          <SectionCard title="Detalhes" icon="document-text-outline">
            <View style={styles.tagWrap}>
              {(run.tags || []).length ? (
                (run.tags || []).map((tag) => (
                  <View style={styles.tag} key={tag}>
                    <Ionicons name="pricetag-outline" size={14} color={WayperTheme.colors.primary} />
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>Sem tags</Text>
              )}
            </View>

            <View style={styles.notesBox}>
              <Text style={styles.notesLabel}>Notas</Text>
              <Text style={styles.notesText}>{run.notes || "Sem notas para esta corrida."}</Text>
            </View>

            {run.photoUri ? <Image source={{ uri: run.photoUri }} style={styles.photo} /> : null}
          </SectionCard>

          {!readOnly ? (
            <View style={styles.actions}>
              {canReplayRun ? (
                <WPButton
                  title="Reproduzir corrida"
                  icon={<Ionicons name="play-circle-outline" size={21} color={WayperTheme.colors.textInverse} />}
                  onPress={handleReplayRun}
                />
              ) : null}
              <WPButton
                title="Compartilhar corrida"
                icon={<Ionicons name="image-outline" size={21} color={WayperTheme.colors.textInverse} />}
                onPress={() => setShareVisible(true)}
                style={canReplayRun ? styles.actionGap : undefined}
              />
            </View>
          ) : null}
        </View>
      </Animated.View>
    </ScrollView>
    <RunShareModal
      visible={shareVisible}
      onClose={() => setShareVisible(false)}
      run={run}
      path={shareRoutePath}
      segments={hasZoneShape ? [] : mapSegments}
      zoneCoords={zoneCoords}
      isZone={isZoneRun}
      title={shareCardTitle}
      subtitle={runTitle}
      distance={distanceDisplay}
      duration={durationDisplay}
      pace={paceDisplay}
      date={formatDate(run.date)}
      area={areaDisplay}
      publicLink={run?.publicLink || run?.publicUrl || run?.shareUrl || run?.url}
    />
    <RunSummaryModal
      visible={editVisible}
      mode="edit"
      onClose={() => setEditVisible(false)}
      onSave={handleEditSave}
      baseRunData={run || {}}
    />
    <Modal
      visible={optionsVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setOptionsVisible(false)}
    >
      <Pressable style={styles.optionsBackdrop} onPress={() => setOptionsVisible(false)}>
        <Pressable style={styles.optionsMenu} onPress={(event) => event.stopPropagation?.()}>
          <View style={styles.optionsHandle} />
          <Text style={styles.optionsTitle}>Mais opcoes</Text>
          <TouchableOpacity
            activeOpacity={0.86}
            style={styles.optionItem}
            onPress={() => {
              setOptionsVisible(false);
              setEditVisible(true);
            }}
          >
            <View style={styles.optionIcon}>
              <Ionicons name="create-outline" size={21} color={WayperTheme.colors.primary} />
            </View>
            <View style={styles.optionTextWrap}>
              <Text style={styles.optionText}>Editar corrida</Text>
              <Text style={styles.optionSubtext}>Alterar nome, tags, notas, esforco e imagens</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.86}
            style={[styles.optionItem, styles.deleteOptionItem]}
            onPress={confirmDeleteRun}
            disabled={deleting}
          >
            <View style={[styles.optionIcon, styles.deleteOptionIcon]}>
              <Ionicons name="trash-outline" size={21} color={WayperTheme.colors.danger} />
            </View>
            <View style={styles.optionTextWrap}>
              <Text style={[styles.optionText, styles.deleteOptionText]}>{deleting ? "Excluindo..." : "Excluir corrida"}</Text>
              <Text style={styles.optionSubtext}>Remover totalmente esta corrida</Text>
            </View>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

function MetricTile({ icon, label, value, compact = false, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <View style={[styles.metricTile, compact && styles.metricTileCompact]}>
      <View style={[styles.metricIcon, { borderColor: accent === "cyan" ? WayperTheme.colors.cyanBorder : WayperTheme.colors.primaryBorder }]}>
        <Ionicons name={icon} size={compact ? 16 : 18} color={color} />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function SectionCard({ title, icon, children }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={19} color={WayperTheme.colors.primary} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function ShareMiniMetric({ label, value }) {
  return (
    <View style={styles.shareMiniMetric}>
      <Text style={styles.shareMiniMetricLabel}>{label}</Text>
      <Text style={styles.shareMiniMetricValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const RunDetailScreen = React.memo(RunDetailScreenInner);
export default RunDetailScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
  },
  headerOptionsButton: {
    width: 42,
    height: 42,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    marginRight: 6,
  },
  optionsBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.58)",
    justifyContent: "flex-end",
    padding: WayperTheme.spacing.page,
  },
  optionsMenu: {
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    padding: WayperTheme.spacing.lg,
    ...WayperTheme.shadows.card,
  },
  optionsHandle: {
    alignSelf: "center",
    width: 52,
    height: 5,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.borderStrong,
    marginBottom: WayperTheme.spacing.lg,
  },
  optionsTitle: {
    color: WayperTheme.colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginBottom: WayperTheme.spacing.md,
  },
  optionItem: {
    minHeight: 74,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    paddingHorizontal: WayperTheme.spacing.md,
    paddingVertical: WayperTheme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.md,
    marginTop: WayperTheme.spacing.md,
  },
  deleteOptionItem: {
    borderColor: WayperTheme.colors.dangerBorder,
    backgroundColor: WayperTheme.colors.dangerSoft,
  },
  optionIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  deleteOptionIcon: {
    backgroundColor: "rgba(255, 51, 71, 0.12)",
    borderColor: WayperTheme.colors.dangerBorder,
  },
  optionTextWrap: {
    flex: 1,
  },
  optionText: {
    color: WayperTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  deleteOptionText: {
    color: WayperTheme.colors.danger,
  },
  optionSubtext: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 3,
  },
  scrollContent: {
    paddingBottom: 42,
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
    padding: WayperTheme.spacing.xl,
  },
  invalidText: {
    ...WayperTheme.typography.body,
    color: WayperTheme.colors.textMuted,
  },
  captureCard: {
    backgroundColor: WayperTheme.colors.background,
  },
  heroMap: {
    height: 360,
    overflow: "hidden",
    backgroundColor: WayperTheme.colors.background,
  },
  map: {
    flex: 1,
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroContent: {
    position: "absolute",
    left: WayperTheme.spacing.page,
    right: WayperTheme.spacing.page,
    bottom: WayperTheme.spacing.xl,
    flexDirection: "row",
    alignItems: "center",
  },
  heroBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: WayperTheme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    marginRight: WayperTheme.spacing.md,
    ...WayperTheme.shadows.greenGlow,
  },
  heroTextWrap: {
    flex: 1,
  },
  eyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 31,
    fontWeight: "900",
    marginTop: 3,
  },
  date: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  captureMetrics: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: WayperTheme.spacing.lg,
    paddingBottom: WayperTheme.spacing.sm,
  },
  content: {
    paddingHorizontal: WayperTheme.spacing.page,
  },
  metricGrid: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.md,
  },
  metricTile: {
    flex: 1,
    minHeight: 106,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.md,
    justifyContent: "center",
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  metricTileCompact: {
    minHeight: 92,
  },
  metricIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    marginBottom: WayperTheme.spacing.sm,
  },
  metricLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: 20,
    fontWeight: "900",
    marginTop: 3,
  },
  insight: {
    minHeight: 64,
    borderRadius: WayperTheme.radius.xl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    padding: WayperTheme.spacing.lg,
    marginTop: WayperTheme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.md,
  },
  insightText: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  sectionCard: {
    marginTop: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.lg,
    ...WayperTheme.shadows.card,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: WayperTheme.spacing.lg,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: WayperTheme.spacing.md,
  },
  sectionTitle: {
    color: WayperTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  chartRow: {
    alignItems: "flex-end",
    paddingRight: WayperTheme.spacing.lg,
  },
  barWrap: {
    width: 68,
    alignItems: "center",
    marginRight: WayperTheme.spacing.sm,
  },
  barRail: {
    width: 42,
    height: CHART_BASE_HEIGHT,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  bar: {
    width: "100%",
    borderTopLeftRadius: WayperTheme.radius.pill,
    borderTopRightRadius: WayperTheme.radius.pill,
  },
  barLabel: {
    color: WayperTheme.colors.text,
    fontSize: 12,
    fontWeight: "900",
    marginTop: WayperTheme.spacing.sm,
  },
  barSub: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 1,
  },
  splitRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: WayperTheme.colors.border,
  },
  splitKm: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontWeight: "900",
  },
  splitTime: {
    flex: 1,
    textAlign: "center",
    color: WayperTheme.colors.textMuted,
    fontWeight: "800",
  },
  splitPace: {
    flex: 1,
    textAlign: "right",
    color: WayperTheme.colors.primary,
    fontWeight: "900",
  },
  emptyText: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 14,
    fontWeight: "700",
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.sm,
  },
  tag: {
    minHeight: 38,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    paddingHorizontal: WayperTheme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.xs,
  },
  tagText: {
    color: WayperTheme.colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  notesBox: {
    marginTop: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.lg,
  },
  notesLabel: {
    color: WayperTheme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: WayperTheme.spacing.sm,
  },
  notesText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
  },
  photo: {
    width: "100%",
    height: 190,
    borderRadius: WayperTheme.radius.xl,
    marginTop: WayperTheme.spacing.lg,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  actions: {
    marginTop: WayperTheme.spacing.xl,
    marginBottom: WayperTheme.spacing.xxl,
  },
  actionGap: {
    marginTop: WayperTheme.spacing.sm,
  },
  shareOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  shareSheet: {
    width: "100%",
    maxHeight: "88%",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: "rgba(8, 16, 24, 0.98)",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  shareHandle: {
    width: 48,
    height: 5,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.borderStrong,
    alignSelf: "center",
    marginBottom: 18,
  },
  shareSheetContent: {
    paddingBottom: 24,
  },
  shareHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: WayperTheme.spacing.lg,
  },
  shareEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  shareTitle: {
    color: WayperTheme.colors.text,
    fontSize: 26,
    fontWeight: "900",
    marginTop: 2,
  },
  shareHint: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 3,
  },
  shareCloseIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  shareCarousel: {
    gap: 12,
    paddingRight: 12,
  },
  shareCard: {
    width: 292,
    minHeight: 340,
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
  shareMiniLogo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
  },
  shareMapArtwork: {
    height: 166,
    borderRadius: WayperTheme.radius.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    backgroundColor: WayperTheme.colors.background,
  },
  shareCardName: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 11,
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
    height: 214,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: "rgba(0, 230, 118, 0.06)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    overflow: "hidden",
  },
  shareActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  shareActionButton: {
    flex: 1,
    minHeight: 50,
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
});
