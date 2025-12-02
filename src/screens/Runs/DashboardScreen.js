import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from "react-native";

import sync from "../../utils/sync";
import { colors } from "../../theme/colors";

const WAYPER_GREEN = colors.wayperGreen || "#00e676";
const MS_IN_WEEK = 7 * 24 * 3600 * 1000;

/* ============================================================
   🔧 SMALL UTILS (MEMO-SAFE)
   ============================================================ */
const formatKm = (m = 0) => (Number(m) / 1000).toFixed(2);

const safeNumber = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const nowTs = () => Date.now();

/** pace em segundos por KM */
const paceSeconds = (run) => {
  if (!run || !run.distance || !run.duration) return Infinity;
  const km = run.distance / 1000 || 1;
  return run.duration / km;
};

const formatPaceSecToMMSS = (sec) => {
  if (!isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
};

/* ============================================================
   📊 DASHBOARD MAIN COMPONENT
   ============================================================ */
export default function DashboardScreen() {
  const [runs, setRuns] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoSyncActive, setAutoSyncActive] = useState(false);

  const log = useCallback((msg, ctx) => {
    console.debug("[DASH]", msg, ctx || "");
  }, []);

  /* ============================================================
     🔄 LOAD DATA
     ============================================================ */
  const loadAll = useCallback(
    async (opts = { force: false }) => {
      setLoading(true);
      try {
        const [loadedRuns, loadedZones] = await Promise.all([
          sync.loadLocalRuns(opts),
          sync.loadLocalZones(opts),
        ]);

        setRuns(Array.isArray(loadedRuns) ? loadedRuns : []);
        setZones(Array.isArray(loadedZones) ? loadedZones : []);

        log("loadAll OK", {
          runs: loadedRuns?.length,
          zones: loadedZones?.length,
        });
      } catch (e) {
        console.warn("[DASH] loadAll error", e);
        Alert.alert("Erro", "Falha ao carregar dados do dashboard.");
      } finally {
        setLoading(false);
      }
    },
    [log]
  );

  /* ============================================================
     🚀 INIT + AUTO-SYNC
     ============================================================ */
  useEffect(() => {
    let mounted = true;

    (async () => {
      await loadAll();

      try {
        if (typeof sync.startAutoSync === "function") {
          sync.startAutoSync();
          mounted && setAutoSyncActive(true);
          log("autoSync started");
        }
      } catch (e) {
        console.warn("[DASH] autoSync fail", e);
      }
    })();

    return () => {
      mounted = false;
      try {
        if (typeof sync.stopAutoSync === "function") {
          sync.stopAutoSync();
          log("autoSync stopped (cleanup)");
        }
      } catch (e) {}
    };
  }, [loadAll, log]);

  /* ============================================================
     🔃 PULL TO REFRESH
     ============================================================ */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAll({ force: true });

      if (typeof sync.syncNow === "function") {
        try {
          await sync.syncNow();
          log("syncNow OK");
          await loadAll({ force: true });
        } catch (e) {
          console.warn("[DASH] syncNow error", e);
        }
      }
    } catch (e) {
      // já tratado
    } finally {
      setRefreshing(false);
    }
  }, [loadAll, log]);

  /* ============================================================
     📊 TOTALS (MEMO)
     ============================================================ */
  const totals = useMemo(() => {
    const totalMeters = runs.reduce(
      (acc, r) => acc + safeNumber(r.distance),
      0
    );

    return {
      totalKm: totalMeters / 1000,
      totalRuns: runs.length,
      totalZones: zones.length,
    };
  }, [runs, zones]);

  /* ============================================================
     📈 LAST 12 WEEKS CHART (MEMO)
     ============================================================ */
  const weeks = useMemo(() => {
    const map = new Map();
    const now = nowTs();

    runs.forEach((r) => {
      const ts = Number(new Date(r.date).getTime());
      const weekStart = Math.floor(ts / MS_IN_WEEK) * MS_IN_WEEK;
      map.set(weekStart, (map.get(weekStart) || 0) + safeNumber(r.distance));
    });

    const out = [];
    for (let i = 11; i >= 0; i--) {
      const start =
        Math.floor((now - i * MS_IN_WEEK) / MS_IN_WEEK) * MS_IN_WEEK;
      out.push({
        start,
        meters: map.get(start) || 0,
      });
    }
    return out;
  }, [runs]);

  const maxWeekKm = useMemo(() => {
    const maxMeters = Math.max(...weeks.map((w) => w.meters || 0), 1);
    return Math.max(1, maxMeters / 1000);
  }, [weeks]);

  /* ============================================================
     🥇 RANKING (MEMO)
     ============================================================ */
  const ranking = useMemo(() => {
    const byDistance = [...runs]
      .filter((r) => r.distance)
      .sort((a, b) => b.distance - a.distance)
      .slice(0, 8);

    const validPace = runs.filter((r) => r.distance && r.duration);

    const byPace = [...validPace]
      .sort((a, b) => paceSeconds(a) - paceSeconds(b))
      .slice(0, 8);

    return { byDistance, byPace };
  }, [runs]);

  /* ============================================================
     🧩 RENDER HELPERS
     ============================================================ */
  const renderKmBar = useCallback(
    (w) => {
      const km = (w.meters || 0) / 1000;
      const height = Math.min(120, (km / maxWeekKm) * 120 || 6);

      return (
        <View key={String(w.start)} style={styles.barWrap}>
          <View
            style={[styles.bar, { height: Math.max(6, height) }]}
          />
          <Text style={styles.barLabel}>{formatKm(w.meters)} km</Text>
        </View>
      );
    },
    [maxWeekKm]
  );

  const handleExportSummary = useCallback(() => {
    try {
      const sample = runs.slice(0, 8).map((r) => ({
        id: r.id,
        date: r.date,
        distance_km: (r.distance || 0) / 1000,
        duration_sec: r.duration || 0,
      }));
      Alert.alert("Export preview", JSON.stringify(sample, null, 2));
    } catch (e) {
      console.warn("[DASH] export error", e);
      Alert.alert("Erro", "Falha ao exportar.");
    }
  }, [runs]);

  /* ============================================================
     🖥️ LOADING
     ============================================================ */
  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={WAYPER_GREEN} />
        <Text style={{ color: "#fff", marginTop: 8 }}>
          Carregando dashboard...
        </Text>
      </View>
    );
  }

  /* ============================================================
     🎨 MAIN UI
     ============================================================ */
  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={WAYPER_GREEN}
        />
      }
    >
      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.subtitle}>Resumo pessoal</Text>
      </View>

      {/* CARDS */}
      <View style={styles.cardsRow}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Total km</Text>
          <Text style={styles.cardValue}>
            {totals.totalKm.toFixed(2)}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Corridas</Text>
          <Text style={styles.cardValue}>{totals.totalRuns}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Zonas</Text>
          <Text style={styles.cardValue}>{totals.totalZones}</Text>
        </View>
      </View>

      {/* 12 WEEKS CHART */}
      <View style={{ padding: 16 }}>
        <Text style={styles.sectionTitle}>
          Km nas últimas 12 semanas
        </Text>
        <View style={styles.chartRow}>
          {weeks.map((w) => renderKmBar(w))}
        </View>
      </View>

      {/* RANKING – DISTANCE */}
      <View style={{ padding: 16 }}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>
            Ranking – maiores distâncias
          </Text>
          <TouchableOpacity onPress={handleExportSummary}>
            <Text style={{ color: WAYPER_GREEN }}>Export</Text>
          </TouchableOpacity>
        </View>

        {ranking.byDistance.length === 0 ? (
          <Text style={styles.empty}>Sem dados</Text>
        ) : (
          ranking.byDistance.map((r) => (
            <View key={r.id} style={styles.rankRow}>
              <Text style={styles.rankName}>
                {r.name || "Corrida"}
              </Text>
              <Text style={styles.rankVal}>
                {formatKm(r.distance)} km
              </Text>
            </View>
          ))
        )}
      </View>

      {/* RANKING – PACE */}
      <View style={{ padding: 16 }}>
        <Text style={styles.sectionTitle}>Melhor pace</Text>

        {ranking.byPace.length === 0 ? (
          <Text style={styles.empty}>Sem dados</Text>
        ) : (
          ranking.byPace.map((r) => {
            const sec = paceSeconds(r);
            return (
              <View key={r.id} style={styles.rankRow}>
                <Text style={styles.rankName}>
                  {r.name || "Corrida"}
                </Text>
                <Text style={styles.rankVal}>
                  {formatPaceSecToMMSS(sec)}
                </Text>
              </View>
            );
          })
        )}
      </View>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

/* ============================================================
   🎨 STYLES
   ============================================================ */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDark },

  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.backgroundDark,
  },

  header: { padding: 16 },
  title: {
    color: WAYPER_GREEN,
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: { color: colors.textMuted },

  cardsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
  },
  card: {
    backgroundColor: colors.backgroundCard,
    flex: 1,
    marginRight: 8,
    padding: 12,
    borderRadius: 14,
  },
  cardLabel: { color: colors.textSoft },
  cardValue: {
    color: colors.white,
    fontSize: 22,
    fontWeight: "800",
  },

  sectionTitle: {
    color: WAYPER_GREEN,
    fontWeight: "800",
    marginBottom: 8,
  },

  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingVertical: 12,
  },

  barWrap: {
    width: 40,
    alignItems: "center",
    marginRight: 8,
  },
  bar: {
    width: 30,
    backgroundColor: WAYPER_GREEN,
    borderRadius: 6,
  },
  barLabel: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 4,
  },

  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  rankRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  rankName: { color: colors.white },
  rankVal: { color: colors.white, fontWeight: "700" },

  empty: { color: colors.textMuted, paddingVertical: 10 },
});
