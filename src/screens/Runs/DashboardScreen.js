import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import sync from "../../utils/sync";
import runRepository from "../../repositories/runRepository";
import runSyncQueueRepository from "../../repositories/runSyncQueueRepository";
import territoryRepository from "../../repositories/territoryRepository";
import { getProgressSummary } from "../../repositories/progressionRepository";
import { WPCard, WPScreen } from "../../components/ui";
import { EmptyState as SharedEmptyState } from "../../components/states";
import { WayperTheme } from "../../theme/wayperTheme";
import { calculatePaceSecondsPerKm, formatPaceFromSeconds } from "../../utils/pace";

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const MS_IN_WEEK = 7 * MS_IN_DAY;
const CHART_HEIGHT = 128;

const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const safeDateTs = (value) => {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

const formatKm = (meters = 0, digits = 2) => `${(safeNumber(meters) / 1000).toFixed(digits)} km`;

const formatDuration = (seconds = 0) => {
  const total = Math.max(0, Math.round(safeNumber(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
};

const paceSeconds = (run) => {
  const distance = safeNumber(run?.distance);
  const duration = safeNumber(run?.duration);
  return calculatePaceSecondsPerKm(duration, distance / 1000) ?? Infinity;
};

const formatPace = (seconds) => {
  const formatted = formatPaceFromSeconds(seconds);
  return formatted === "--:--" ? formatted : `${formatted}/km`;
};

const formatShortDate = (value) => {
  const ts = safeDateTs(value);
  if (!ts) return "Sem data";
  return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
};

const getRunName = (run, index) => run?.name || `Corrida #${index + 1}`;

const getWeekKey = (ts) => Math.floor(ts / MS_IN_WEEK) * MS_IN_WEEK;

export default function DashboardScreen() {
  const [runs, setRuns] = useState([]);
  const [zones, setZones] = useState([]);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  const loadAll = useCallback(async ({ forceSync = false } = {}) => {
    if (forceSync) setRefreshing(true);
    else setLoading(true);

    try {
      if (forceSync && typeof sync.syncNow === "function") {
        setSyncing(true);
        try {
          await sync.syncNow();
        } catch (error) {
          console.warn("[Dashboard] syncNow failed", error);
        } finally {
          setSyncing(false);
        }
      }

      const [loadedRuns, loadedTerritories, loadedProgress] = await Promise.all([
        runRepository.list(),
        territoryRepository.list({ status: "active" }),
        getProgressSummary(),
      ]);

      setRuns(Array.isArray(loadedRuns.data) ? loadedRuns.data : []);
      setZones(Array.isArray(loadedTerritories.data) ? loadedTerritories.data : []);
      setProgress(loadedProgress || null);
    } catch (error) {
      console.warn("[Dashboard] loadAll failed", error);
      Alert.alert("Erro", "Falha ao carregar dados do dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      await loadAll();
      if (!mounted) return;
      runSyncQueueRepository.startAutoSync?.().catch((error) => {
        console.warn("[Dashboard] startAutoSync failed", error);
      });
    })();

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        speed: 16,
        bounciness: 7,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      mounted = false;
      try {
        const stopResult = runSyncQueueRepository.stopAutoSync?.();
        stopResult?.catch?.(() => {});
      } catch {}
    };
  }, [fadeAnim, loadAll, slideAnim]);

  const onRefresh = useCallback(() => loadAll({ forceSync: true }), [loadAll]);

  const stats = useMemo(() => {
    const cleanRuns = (Array.isArray(runs) ? runs : [])
      .filter(Boolean)
      .map((run) => ({
        ...run,
        distance: safeNumber(run.distance),
        duration: safeNumber(run.duration),
        ts: safeDateTs(run.date),
      }))
      .sort((a, b) => b.ts - a.ts);

    const cleanZones = (Array.isArray(zones) ? zones : []).filter(Boolean);
    const now = Date.now();
    const weekStart = now - 7 * MS_IN_DAY;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const totalMeters = cleanRuns.reduce((sum, run) => sum + run.distance, 0);
    const totalDuration = cleanRuns.reduce((sum, run) => sum + run.duration, 0);
    const weeklyMeters = cleanRuns
      .filter((run) => run.ts >= weekStart)
      .reduce((sum, run) => sum + run.distance, 0);
    const monthlyMeters = cleanRuns
      .filter((run) => run.ts >= monthStart.getTime())
      .reduce((sum, run) => sum + run.distance, 0);
    const zoneArea = cleanZones.reduce((sum, zone) => sum + safeNumber(zone.areaM2 ?? zone.area), 0);

    const bestDistance = [...cleanRuns]
      .filter((run) => run.distance > 0)
      .sort((a, b) => b.distance - a.distance)
      .slice(0, 6);

    const bestPace = [...cleanRuns]
      .filter((run) => Number.isFinite(paceSeconds(run)))
      .sort((a, b) => paceSeconds(a) - paceSeconds(b))
      .slice(0, 6);

    const avgPace = calculatePaceSecondsPerKm(totalDuration, totalMeters / 1000) ?? Infinity;

    const weekMap = new Map();
    cleanRuns.forEach((run) => {
      if (!run.ts) return;
      const key = getWeekKey(run.ts);
      weekMap.set(key, (weekMap.get(key) || 0) + run.distance);
    });

    const weeks = [];
    for (let index = 11; index >= 0; index -= 1) {
      const key = getWeekKey(now - index * MS_IN_WEEK);
      weeks.push({
        key,
        meters: weekMap.get(key) || 0,
        label: new Date(key).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      });
    }

    return {
      runs: cleanRuns,
      totalMeters,
      totalRuns: cleanRuns.length,
      totalZones: cleanZones.length,
      totalDuration,
      weeklyMeters,
      monthlyMeters,
      zoneArea,
      bestDistance,
      bestPace,
      avgPace,
      weeks,
      maxWeekMeters: Math.max(...weeks.map((week) => week.meters), 1),
      totalXp: safeNumber(progress?.totalXp),
      level: safeNumber(progress?.level, 1),
      achievementsUnlocked: safeNumber(progress?.achievementsUnlocked),
      achievementsTotal: safeNumber(progress?.achievementsTotal),
    };
  }, [progress, runs, zones]);

  if (loading) {
    return (
      <WPScreen>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={WayperTheme.colors.primary} />
          <Text style={styles.loadingText}>Carregando dashboard...</Text>
        </View>
      </WPScreen>
    );
  }

  return (
    <WPScreen safe={false}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={WayperTheme.colors.primary}
            colors={[WayperTheme.colors.primary]}
          />
        }
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <LinearGradient
            colors={["rgba(0,230,118,0.22)", "rgba(56,217,255,0.08)", "rgba(3,7,11,0)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroTop}>
              <View>
                <Text style={styles.heroEyebrow}>Wayper analytics</Text>
                <Text style={styles.heroTitle}>Dashboard</Text>
                <Text style={styles.heroSubtitle}>Seu ritmo, volume e melhores marcas em um painel unico.</Text>
              </View>
              <TouchableOpacity activeOpacity={0.85} style={styles.syncButton} onPress={onRefresh}>
                {syncing ? (
                  <ActivityIndicator size="small" color={WayperTheme.colors.primary} />
                ) : (
                  <Ionicons name="sync-outline" size={22} color={WayperTheme.colors.primary} />
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.heroMetrics}>
              <HeroMetric label="Total" value={formatKm(stats.totalMeters)} icon="navigate-outline" />
              <HeroMetric label="Pace medio" value={formatPace(stats.avgPace)} icon="speedometer-outline" accent="cyan" />
            </View>
          </LinearGradient>

          <View style={styles.metricGrid}>
            <MetricTile label="Corridas" value={String(stats.totalRuns)} icon="walk-outline" />
            <MetricTile label="Esta semana" value={formatKm(stats.weeklyMeters)} icon="calendar-outline" />
            <MetricTile label="Este mes" value={formatKm(stats.monthlyMeters)} icon="trending-up-outline" accent="cyan" />
            <MetricTile label="Zonas" value={String(stats.totalZones)} sub={`${Math.round(stats.zoneArea)} m2`} icon="map-outline" accent="cyan" />
            <MetricTile label="XP" value={String(Math.round(stats.totalXp))} sub={`Nivel ${stats.level} - ${stats.achievementsUnlocked}/${stats.achievementsTotal} conquistas`} icon="sparkles-outline" />
          </View>

          <SectionCard
            title="Volume semanal"
            subtitle="Km acumulados nas ultimas 12 semanas"
            icon="bar-chart-outline"
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartRow}>
              {stats.weeks.map((week) => (
                <WeekBar
                  key={String(week.key)}
                  week={week}
                  maxMeters={stats.maxWeekMeters}
                />
              ))}
            </ScrollView>
          </SectionCard>

          <SectionCard
            title="Maiores distancias"
            subtitle="Suas corridas mais longas"
            icon="trophy-outline"
            rightLabel={stats.bestDistance.length ? formatKm(stats.bestDistance[0]?.distance || 0) : "--"}
          >
            {stats.bestDistance.length ? (
              stats.bestDistance.map((run, index) => (
                <RankingRow
                  key={run.id || `distance-${index}`}
                  index={index}
                  title={getRunName(run, index)}
                  meta={`${formatShortDate(run.date)} • ${formatDuration(run.duration)}`}
                  value={formatKm(run.distance)}
                  progress={run.distance / Math.max(stats.bestDistance[0]?.distance || 1, 1)}
                  icon="flag-outline"
                  accent={index === 0 ? "green" : "cyan"}
                />
              ))
            ) : (
              <EmptyState text="Ainda nao ha corridas com distancia registrada." />
            )}
          </SectionCard>

          <SectionCard
            title="Melhor pace"
            subtitle="Menor tempo por quilometro"
            icon="flash-outline"
            rightLabel={stats.bestPace.length ? formatPace(paceSeconds(stats.bestPace[0])) : "--:--"}
          >
            {stats.bestPace.length ? (
              stats.bestPace.map((run, index) => {
                const best = paceSeconds(stats.bestPace[0]);
                const current = paceSeconds(run);
                const progress = best > 0 && Number.isFinite(current) ? Math.min(1, best / current) : 0;
                return (
                  <RankingRow
                    key={run.id || `pace-${index}`}
                    index={index}
                    title={getRunName(run, index)}
                    meta={`${formatShortDate(run.date)} • ${formatKm(run.distance)}`}
                    value={formatPace(current)}
                    progress={progress}
                    icon="speedometer-outline"
                    accent="green"
                  />
                );
              })
            ) : (
              <EmptyState text="Ainda nao ha corridas com pace valido." />
            )}
          </SectionCard>

          <View style={styles.footerCard}>
            <Ionicons name="sparkles-outline" size={22} color={WayperTheme.colors.primary} />
            <Text style={styles.footerText}>
              Puxe para atualizar e sincronizar seus dados locais com o Firebase.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </WPScreen>
  );
}

function HeroMetric({ label, value, icon, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <View style={styles.heroMetric}>
      <View style={[styles.heroMetricIcon, { borderColor: accent === "cyan" ? WayperTheme.colors.cyanBorder : WayperTheme.colors.primaryBorder }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.heroMetricLabel}>{label}</Text>
      <Text style={styles.heroMetricValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function MetricTile({ label, value, sub, icon, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  return (
    <WPCard style={styles.metricTile} accent={accent === "cyan" ? "cyan" : "green"}>
      <View style={[styles.metricIcon, { backgroundColor: accent === "cyan" ? WayperTheme.colors.cyanSoft : WayperTheme.colors.primarySoft }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.metricTileLabel}>{label}</Text>
      <Text style={[styles.metricTileValue, { color }]} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={styles.metricTileSub}>{sub}</Text> : null}
    </WPCard>
  );
}

function SectionCard({ title, subtitle, icon, rightLabel, children }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={20} color={WayperTheme.colors.primary} />
        </View>
        <View style={styles.sectionTextWrap}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
        {rightLabel ? <Text style={styles.sectionRight}>{rightLabel}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function WeekBar({ week, maxMeters }) {
  const ratio = Math.max(0.04, Math.min(1, safeNumber(week.meters) / Math.max(maxMeters, 1)));
  const height = Math.max(10, ratio * CHART_HEIGHT);

  return (
    <View style={styles.weekWrap}>
      <View style={styles.weekRail}>
        <LinearGradient
          colors={[WayperTheme.colors.primary, WayperTheme.colors.cyan]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={[styles.weekFill, { height }]}
        />
      </View>
      <Text style={styles.weekKm}>{(safeNumber(week.meters) / 1000).toFixed(1)}</Text>
      <Text style={styles.weekLabel}>{week.label}</Text>
    </View>
  );
}

function RankingRow({ index, title, meta, value, progress, icon, accent = "green" }) {
  const color = accent === "cyan" ? WayperTheme.colors.cyan : WayperTheme.colors.primary;
  const width = `${Math.max(8, Math.min(100, progress * 100))}%`;

  return (
    <View style={styles.rankRow}>
      <View style={[styles.rankPosition, index === 0 && styles.rankPositionLeader]}>
        <Text style={[styles.rankPositionText, index === 0 && styles.rankPositionLeaderText]}>{index + 1}</Text>
      </View>
      <View style={styles.rankBody}>
        <View style={styles.rankTopLine}>
          <View style={styles.rankTitleWrap}>
            <Ionicons name={icon} size={15} color={color} />
            <Text style={styles.rankTitle} numberOfLines={1}>{title}</Text>
          </View>
          <Text style={[styles.rankValue, { color }]}>{value}</Text>
        </View>
        <Text style={styles.rankMeta} numberOfLines={1}>{meta}</Text>
        <View style={styles.rankProgressTrack}>
          <LinearGradient
            colors={accent === "cyan"
              ? [WayperTheme.colors.cyan, WayperTheme.colors.primary]
              : [WayperTheme.colors.primaryLight, WayperTheme.colors.primaryDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.rankProgressFill, { width }]}
          />
        </View>
      </View>
    </View>
  );
}

function EmptyState({ text }) {
  return (
    <SharedEmptyState
      compact
      title="Ainda sem dados suficientes"
      description={text}
      style={styles.emptyState}
    />
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
  },
  content: {
    paddingBottom: 44,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.background,
  },
  loadingText: {
    marginTop: WayperTheme.spacing.md,
    color: WayperTheme.colors.textMuted,
    fontWeight: "700",
  },
  hero: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.xl,
    borderRadius: WayperTheme.radius.xxl,
    padding: WayperTheme.spacing.xl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: WayperTheme.spacing.lg,
  },
  heroEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroTitle: {
    color: WayperTheme.colors.text,
    fontSize: 34,
    fontWeight: "900",
    marginTop: WayperTheme.spacing.xs,
  },
  heroSubtitle: {
    maxWidth: 260,
    marginTop: WayperTheme.spacing.sm,
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  syncButton: {
    width: 50,
    height: 50,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  heroMetrics: {
    flexDirection: "row",
    gap: WayperTheme.spacing.md,
    marginTop: WayperTheme.spacing.xl,
  },
  heroMetric: {
    flex: 1,
    minHeight: 96,
    borderRadius: WayperTheme.radius.xl,
    padding: WayperTheme.spacing.lg,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
  },
  heroMetricIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    marginBottom: WayperTheme.spacing.sm,
  },
  heroMetricLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  heroMetricValue: {
    marginTop: WayperTheme.spacing.xs,
    color: WayperTheme.colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.md,
    paddingHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.lg,
  },
  metricTile: {
    width: "48%",
    minHeight: 140,
    margin: 0,
  },
  metricIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: WayperTheme.spacing.md,
  },
  metricTileLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricTileValue: {
    marginTop: WayperTheme.spacing.xs,
    fontSize: 24,
    fontWeight: "900",
  },
  metricTileSub: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    marginTop: WayperTheme.spacing.xs,
  },
  sectionCard: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.lg,
    padding: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: WayperTheme.spacing.lg,
  },
  sectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: WayperTheme.spacing.md,
  },
  sectionTextWrap: {
    flex: 1,
  },
  sectionTitle: {
    color: WayperTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  sectionSubtitle: {
    marginTop: 2,
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
  },
  sectionRight: {
    color: WayperTheme.colors.primary,
    fontSize: 15,
    fontWeight: "900",
  },
  chartRow: {
    alignItems: "flex-end",
    gap: WayperTheme.spacing.sm,
    paddingRight: WayperTheme.spacing.lg,
  },
  weekWrap: {
    width: 46,
    alignItems: "center",
  },
  weekRail: {
    width: 24,
    height: CHART_HEIGHT,
    borderRadius: WayperTheme.radius.pill,
    justifyContent: "flex-end",
    overflow: "hidden",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  weekFill: {
    width: "100%",
    borderTopLeftRadius: WayperTheme.radius.pill,
    borderTopRightRadius: WayperTheme.radius.pill,
  },
  weekKm: {
    marginTop: WayperTheme.spacing.sm,
    color: WayperTheme.colors.text,
    fontSize: 11,
    fontWeight: "900",
  },
  weekLabel: {
    marginTop: 2,
    color: WayperTheme.colors.textSubtle,
    fontSize: 10,
    fontWeight: "700",
  },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 82,
    paddingVertical: WayperTheme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: WayperTheme.colors.border,
  },
  rankPosition: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    marginRight: WayperTheme.spacing.md,
  },
  rankPositionLeader: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primaryLight,
    ...WayperTheme.shadows.greenGlow,
  },
  rankPositionText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "900",
  },
  rankPositionLeaderText: {
    color: WayperTheme.colors.textInverse,
  },
  rankBody: {
    flex: 1,
  },
  rankTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: WayperTheme.spacing.md,
  },
  rankTitleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.xs,
  },
  rankTitle: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  rankValue: {
    fontSize: 15,
    fontWeight: "900",
  },
  rankMeta: {
    marginTop: 3,
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
  },
  rankProgressTrack: {
    height: 7,
    marginTop: WayperTheme.spacing.sm,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    overflow: "hidden",
  },
  rankProgressFill: {
    height: "100%",
    borderRadius: WayperTheme.radius.pill,
  },
  emptyState: {
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.lg,
  },
  emptyText: {
    marginTop: WayperTheme.spacing.sm,
    color: WayperTheme.colors.textMuted,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "700",
  },
  footerCard: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.lg,
    minHeight: 70,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    padding: WayperTheme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.md,
  },
  footerText: {
    flex: 1,
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
});
