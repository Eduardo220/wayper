import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  ActivityIndicator,
  Platform,
  RefreshControl,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";
import { fetchAllRanking, fetchMonthlyRanking } from "../services/ranking";
import { getMonthlyMedalForRank, getRankingMonthKey } from "../services/ranking/constants";

const colors = {
  primary: "#00b894",
  accent: "#26c6da",
  bg: "#07111a",
  bgCard: "#0b151d",
  muted: "#9aa0a6",
  textMain: "#e6eef6",
  textMuted: "#9aa0a6",
  border: "#12333f",
};

const DEFAULT_AVATAR = "https://i.pravatar.cc/150?u=wayper";

const makeMockRanking = (city = "Santa Maria", count = 40) =>
  Array.from({ length: count }, (_, i) => {
    const distance = Math.round((Math.random() * 220 + 5) * 1000);
    const area = Math.round((Math.random() * 2_500_000) + 20_000);
    return {
      id: `mock-${i + 1}`,
      name: `Usuario ${i + 1}`,
      avatar: `https://i.pravatar.cc/150?img=${(i % 70) + 1}`,
      city,
      area,
      distance,
      monthlyArea: area * 0.35,
      monthlyDistance: distance * 0.35,
      totalRuns: Math.floor(Math.random() * 70),
      level: Math.floor(Math.random() * 40) + 1,
      xp: Math.floor(Math.random() * 25000),
    };
  });

const formatKm = (meters = 0) => `${(Number(meters || 0) / 1000).toFixed(2)} km`;
const formatArea = (m2 = 0) => {
  const safe = Number(m2 || 0);
  if (safe >= 1e6) return `${(safe / 1e6).toFixed(2)} km²`;
  return `${Math.round(safe)} m²`;
};

const getMetricValue = (item, mode, period) => {
  if (mode === "distance") {
    return Number(period === "monthly" ? item.monthlyDistance ?? item.distance : item.distance) || 0;
  }
  return Number(period === "monthly" ? item.monthlyArea ?? item.area : item.area) || 0;
};

const getMetricLabel = (item, mode, period) => {
  const value = getMetricValue(item, mode, period);
  return mode === "distance" ? formatKm(value) : formatArea(value);
};

const normalizeRanking = (list, mode, period) =>
  (Array.isArray(list) ? list : [])
    .map((item) => ({
      ...item,
      avatar: item.avatar || item.photoURL || DEFAULT_AVATAR,
      name: item.name || item.displayName || item.username || "Jogador",
    }))
    .sort((a, b) => getMetricValue(b, mode, period) - getMetricValue(a, mode, period))
    .map((item, index) => ({ ...item, rank: index + 1 }));

function RankItem({ item, mode, period }) {
  const medal = period === "monthly" ? getMonthlyMedalForRank(item.rank) : null;

  return (
    <View style={styles.item}>
      <View style={styles.positionCol}>
        <View style={[styles.rankBadge, medal && { backgroundColor: medal.color }]}>
          <Text style={[styles.rankText, medal && { color: "#07111a" }]}>{item.rank}</Text>
        </View>
      </View>

      <Image source={{ uri: item.avatar }} style={styles.avatar} />

      <View style={styles.itemBody}>
        <View style={styles.rowBetween}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          {medal ? (
            <View style={styles.medalPill}>
              <Text style={styles.medalText}>{medal.label}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.info}>
            {mode === "distance" ? "Km percorrido" : "Area capturada"}
          </Text>
          <Text style={styles.metric}>{getMetricLabel(item, mode, period)}</Text>
        </View>

        <Text style={styles.meta}>
          {item.totalRuns || 0} corridas • Nivel {item.level || 1}
        </Text>
      </View>
    </View>
  );
}

export default function RankingScreen({ route }) {
  const injectedCity = route?.params?.city || "Santa Maria";

  const [city, setCity] = useState(injectedCity);
  const [scope, setScope] = useState("global");
  const [period, setPeriod] = useState("monthly");
  const [mode, setMode] = useState("area");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState([]);

  const persistMyMonthlyPreview = useCallback(
    async (ranking) => {
      const uid = auth.currentUser?.uid;
      if (!uid || period !== "monthly") return;

      const me = ranking.find((item) => item.id === uid);
      if (!me?.rank) return;

      const field = mode === "distance" ? "bestMonthlyRankDistance" : "bestMonthlyRankArea";
      try {
        await setDoc(
          doc(db, "users", uid),
          {
            monthlyRankPreview: me.rank,
            [field]: me.rank,
            bestMonthlyRank: me.rank,
            rankingMonth: getRankingMonthKey(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (error) {
        console.warn("Ranking preview persist failed:", error);
      }
    },
    [mode, period]
  );

  const loadRanking = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const args = {
          scope,
          city: city.trim() || null,
          criterion: mode,
          limitTo: 300,
        };

        const remote =
          period === "monthly"
            ? await fetchMonthlyRanking(args)
            : await fetchAllRanking(args);

        const normalized = normalizeRanking(remote.length ? remote : makeMockRanking(city), mode, period);
        setData(normalized);
        persistMyMonthlyPreview(normalized);
      } catch (error) {
        console.warn("Ranking load error:", error);
        setData(normalizeRanking(makeMockRanking(city), mode, period));
        Alert.alert("Ranking", "Usando dados locais de exemplo porque o ranking remoto falhou.");
      } finally {
        setLoading(false);
      }
    },
    [city, mode, period, persistMyMonthlyPreview, scope]
  );

  useEffect(() => {
    loadRanking();
  }, [loadRanking]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadRanking({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadRanking]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((item) => {
      const name = String(item.name || "").toLowerCase();
      const username = String(item.username || "").toLowerCase();
      return name.includes(q) || username.includes(q);
    });
  }, [data, search]);

  const top3 = useMemo(() => filtered.slice(0, 3), [filtered]);
  const monthLabel = getRankingMonthKey();

  const Header = useCallback(
    () => (
      <View style={styles.headerContainer}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Ionicons name="trophy-outline" size={28} color={colors.primary} />
            <View style={{ marginLeft: 10 }}>
              <Text style={styles.title}>Ranking</Text>
              <Text style={styles.subtitle}>
                {period === "monthly" ? `Mensal ${monthLabel}` : "Geral"} • {scope === "regional" ? city : "Global"}
              </Text>
            </View>
          </View>

          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="Cidade"
            placeholderTextColor="#78858d"
            style={styles.cityInput}
          />
        </View>

        <View style={styles.controlsRow}>
          <View style={styles.segment}>
            <TouchableOpacity onPress={() => setPeriod("monthly")} style={[styles.segmentBtn, period === "monthly" && styles.segmentActive]}>
              <Text style={[styles.segmentText, period === "monthly" && styles.segmentTextActive]}>Mensal</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPeriod("all")} style={[styles.segmentBtn, period === "all" && styles.segmentActive]}>
              <Text style={[styles.segmentText, period === "all" && styles.segmentTextActive]}>Geral</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.segment}>
            <TouchableOpacity onPress={() => setScope("global")} style={[styles.segmentBtn, scope === "global" && styles.segmentActive]}>
              <Text style={[styles.segmentText, scope === "global" && styles.segmentTextActive]}>Global</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setScope("regional")} style={[styles.segmentBtn, scope === "regional" && styles.segmentActive]}>
              <Text style={[styles.segmentText, scope === "regional" && styles.segmentTextActive]}>Regional</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.modeRow}>
          <TouchableOpacity onPress={() => setMode("area")} style={[styles.modeBtn, mode === "area" && styles.modeActive]}>
            <Ionicons name="map-outline" size={16} color={mode === "area" ? "#07111a" : colors.textMain} />
            <Text style={[styles.modeText, mode === "area" && styles.modeTextActive]}>Area</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("distance")} style={[styles.modeBtn, mode === "distance" && styles.modeActive]}>
            <Ionicons name="walk-outline" size={16} color={mode === "distance" ? "#07111a" : colors.textMain} />
            <Text style={[styles.modeText, mode === "distance" && styles.modeTextActive]}>Km</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar atleta"
          placeholderTextColor="#78858d"
          style={styles.searchInput}
        />

        <View style={styles.heroRow}>
          <View>
            <Text style={styles.heroTitle}>Top 3</Text>
            <Text style={styles.heroSub}>
              Medalhas mensais: Top 100, 50, 10, 3, 2 e 1
            </Text>
          </View>

          <View style={styles.heroRight}>
            {top3.map((item) => (
              <View key={item.id} style={styles.topCard}>
                <Image source={{ uri: item.avatar }} style={styles.topAvatar} />
                <Text style={styles.topName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.topSmall}>{getMetricLabel(item, mode, period)}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    ),
    [city, mode, monthLabel, period, scope, search, top3]
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Carregando ranking...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <RankItem item={item} mode={mode} period={period} />}
          contentContainerStyle={{ paddingBottom: 140 }}
          ListHeaderComponent={<Header />}
          ListEmptyComponent={<Text style={styles.empty}>Sem resultados</Text>}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "ios" ? 54 : 20,
  },
  loading: { padding: 24, alignItems: "center" },
  loadingText: { color: colors.textMuted, marginTop: 10 },
  headerContainer: {
    backgroundColor: colors.bg,
    paddingVertical: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  title: { fontSize: 20, fontWeight: "900", color: colors.textMain },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  cityInput: {
    width: 130,
    backgroundColor: "#0f1920",
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
    color: colors.textMain,
    fontWeight: "600",
    borderColor: colors.border,
    borderWidth: 1,
  },
  controlsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, gap: 8 },
  segment: {
    flexDirection: "row",
    backgroundColor: "#0f1920",
    borderRadius: 10,
    overflow: "hidden",
    borderColor: colors.border,
    borderWidth: 1,
  },
  segmentBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { color: colors.textMain, fontWeight: "800", fontSize: 12 },
  segmentTextActive: { color: "#07111a" },
  modeRow: { flexDirection: "row", marginTop: 10, gap: 10 },
  modeBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#0f1920",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  modeActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  modeText: { color: colors.textMain, fontWeight: "900" },
  modeTextActive: { color: "#07111a" },
  searchInput: {
    marginTop: 10,
    backgroundColor: "#0f1920",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    color: colors.textMain,
    borderColor: colors.border,
    borderWidth: 1,
  },
  heroRow: { marginTop: 14, marginBottom: 10 },
  heroTitle: { fontSize: 16, fontWeight: "900", color: colors.textMain },
  heroSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  heroRight: { flexDirection: "row", marginTop: 10 },
  topCard: {
    flex: 1,
    alignItems: "center",
    marginRight: 8,
    backgroundColor: colors.bgCard,
    padding: 8,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
  },
  topAvatar: { width: 50, height: 50, borderRadius: 25, marginBottom: 6, backgroundColor: "#0c1d24" },
  topName: { fontSize: 12, fontWeight: "800", color: colors.textMain, maxWidth: 82 },
  topSmall: { fontSize: 11, color: colors.textMuted, textAlign: "center", marginTop: 2 },
  item: {
    flexDirection: "row",
    paddingVertical: 14,
    alignItems: "center",
    borderBottomColor: "#0a2630",
    borderBottomWidth: 1,
  },
  positionCol: { width: 44, alignItems: "center" },
  rankBadge: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f1920",
    borderColor: colors.border,
    borderWidth: 1,
  },
  rankText: { fontWeight: "900", color: colors.textMain },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#0b1316", borderColor: colors.border, borderWidth: 1 },
  itemBody: { flex: 1, marginLeft: 12 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  name: { fontSize: 15, fontWeight: "900", color: colors.textMain, maxWidth: 160 },
  info: { fontSize: 13, color: colors.textMuted },
  metric: { color: colors.textMain, fontSize: 13, fontWeight: "900" },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  medalPill: { backgroundColor: "#10252b", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  medalText: { color: colors.accent, fontWeight: "900", fontSize: 11 },
  empty: { textAlign: "center", marginTop: 20, color: colors.textMuted },
});
