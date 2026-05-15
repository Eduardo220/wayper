import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import WayperMapLibre, { WAYPER_FALLBACK_COORD } from "../../components/Map/WayperMapLibre";
import { WPButton } from "../../components/ui";
import { WayperTheme } from "../../theme/wayperTheme";
import sync from "../../utils/sync";

let captureRef;
try {
  // eslint-disable-next-line global-require
  captureRef = require("react-native-view-shot").captureRef;
} catch {
  captureRef = null;
}

const MIN_BAR_HEIGHT = 22;
const CHART_BASE_HEIGHT = 118;

const debug = (...args) => {
  const enabled = false;
  if (enabled) console.log("[RunDetail]", ...args);
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

function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.round(safeNum(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(secondsPerKm = 0) {
  const total = Math.max(0, Math.round(safeNum(secondsPerKm)));
  if (!total) return "--/km";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}/km`;
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

  if (totalMeters - lastKmMeters > 10) {
    const partialMeters = totalMeters - lastKmMeters;
    const partialTime = totalTime - lastKmTime;
    splits.push({
      km: +((lastKmMeters / 1000) + (partialMeters / 1000)).toFixed(2),
      time: Math.round(partialTime),
      paceSec: partialTime,
    });
    pacePerKm.push(Math.round(partialTime));
  }

  return { splits, pacePerKm, avgSpeedKmh, maxSpeedKmh, totalMeters, totalTime };
}

function buildGpx(run, path) {
  const safeName = String(run?.name || "Corrida Wayper").replace(/[<>]/g, "");
  const points = sanitizePath(path)
    .map((point) => {
      const time = point.timestamp ? new Date(point.timestamp).toISOString() : "";
      return `<trkpt lat="${point.latitude}" lon="${point.longitude}"><time>${time}</time></trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Wayper" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${safeName}</name></metadata>
  <trk><name>${safeName}</name><trkseg>
${points}
  </trkseg></trk>
</gpx>`;
}

function RunDetailScreenInner({ route }) {
  const run = route?.params?.run;
  const captureViewRef = useRef(null);
  const anim = useRef(new Animated.Value(0)).current;
  const [userAvgPace, setUserAvgPace] = useState(null);

  const path = useMemo(() => sanitizePath(run?.path || []), [run]);
  const midPoint = useMemo(() => {
    if (path.length === 0) return WAYPER_FALLBACK_COORD;
    return path[Math.floor(path.length / 2)] || path[0] || WAYPER_FALLBACK_COORD;
  }, [path]);

  const stats = useMemo(() => computeSplits(path, run?.duration || 0), [path, run]);
  const totalMeters = stats.totalMeters > 0 ? stats.totalMeters : safeNum(run?.distance);
  const totalTime = stats.totalTime > 0 ? stats.totalTime : safeNum(run?.duration);
  const totalKm = (totalMeters / 1000).toFixed(2);
  const paceSec = totalMeters > 0 ? totalTime / (totalMeters / 1000) : 0;
  const paceDisplay = formatPace(paceSec);
  const avgSpeedDisplay = (safeNum(stats.avgSpeedKmh) || safeNum(run?.avgSpeed)).toFixed(1);
  const maxSpeedDisplay = safeNum(stats.maxSpeedKmh).toFixed(1);
  const runTitle = run?.name || "Corrida";
  const effort = run?.effort ?? "--";

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
          (item) => item.id !== run.id && safeNum(item.distance) > 0 && safeNum(item.duration) > 0
        );
        const total = comparable.reduce(
          (acc, item) => {
            acc.seconds += safeNum(item.duration);
            acc.km += safeNum(item.distance) / 1000;
            return acc;
          },
          { seconds: 0, km: 0 }
        );
        setUserAvgPace(total.km > 0 ? total.seconds / total.km : null);
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

  const exportGPX = useCallback(async () => {
    try {
      if (!run || path.length === 0) {
        Alert.alert("Nada para exportar");
        return;
      }

      const filePath = `${FileSystem.cacheDirectory}wayper_run_${run.id || Date.now()}.gpx`;
      await FileSystem.writeAsStringAsync(filePath, buildGpx(run, path), { encoding: FileSystem.EncodingUTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, { mimeType: "application/gpx+xml", dialogTitle: "Exportar GPX - Wayper" });
      } else {
        Alert.alert("Exportado", `GPX salvo em: ${filePath}`);
      }
    } catch (error) {
      debug("exportGPX", error);
      Alert.alert("Erro", "Nao foi possivel exportar GPX.");
    }
  }, [path, run]);

  const exportJSON = useCallback(async () => {
    try {
      if (!run) return;
      const filePath = `${FileSystem.cacheDirectory}wayper_run_${run.id || Date.now()}.json`;
      await FileSystem.writeAsStringAsync(filePath, JSON.stringify(run), { encoding: FileSystem.EncodingUTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, { dialogTitle: "Exportar JSON - Wayper" });
      } else {
        Alert.alert("Exportado", `JSON salvo em: ${filePath}`);
      }
    } catch (error) {
      debug("exportJSON", error);
      Alert.alert("Erro", "Nao foi possivel exportar JSON.");
    }
  }, [run]);

  const shareMapImage = useCallback(async () => {
    try {
      if (!captureRef || !captureViewRef.current) {
        Alert.alert("Compartilhar", "Preview indisponivel para captura.");
        return;
      }

      const uri = await captureRef(captureViewRef.current, { format: "png", quality: 0.95, result: "tmpfile" });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Compartilhar imagem da corrida" });
      } else {
        Alert.alert("Imagem pronta", uri);
      }
    } catch (error) {
      debug("shareMapImage", error);
      Alert.alert("Erro", "Nao foi possivel compartilhar a imagem.");
    }
  }, []);

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
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Animated.View style={animStyle}>
        <View ref={captureViewRef} collapsable={false} style={styles.captureCard}>
          <View style={styles.heroMap}>
            <WayperMapLibre
              style={styles.map}
              routePath={path}
              centerCoordinate={midPoint}
              showUserLocation={false}
              interactive={false}
              fitToContent={path.length > 1}
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
                <Ionicons name="walk-outline" size={22} color={WayperTheme.colors.textInverse} />
              </View>
              <View style={styles.heroTextWrap}>
                <Text style={styles.eyebrow}>Wayper Run</Text>
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
                  <Text style={styles.splitPace}>{formatPace(split.time)}</Text>
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

          <View style={styles.actions}>
            <WPButton
              title="Compartilhar imagem"
              icon={<Ionicons name="image-outline" size={21} color={WayperTheme.colors.textInverse} />}
              onPress={shareMapImage}
            />
            <WPButton
              title="Exportar GPX"
              variant="secondary"
              icon={<Ionicons name="map-outline" size={21} color={WayperTheme.colors.primary} />}
              onPress={exportGPX}
              style={styles.actionGap}
            />
            <WPButton
              title="Exportar JSON"
              variant="ghost"
              icon={<Ionicons name="code-slash-outline" size={21} color={WayperTheme.colors.textMuted} />}
              onPress={exportJSON}
              style={styles.actionGap}
            />
          </View>
        </View>
      </Animated.View>
    </ScrollView>
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

const RunDetailScreen = React.memo(RunDetailScreenInner);
export default RunDetailScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
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
});
