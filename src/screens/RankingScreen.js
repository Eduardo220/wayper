// src/screens/RankingScreen.js
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Animated,
  Easing,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

// THEME PADRÃO DO APP
const colors = {
  primary: "#FF5A5F",
  accent: "#00b894",
  bg: "#07111a",
  bgCard: "#0b151d",
  muted: "#9aa0a6",
  textMain: "#e6eef6",
  textMuted: "#9aa0a6",
  gold: "#FFD700",
  silver: "#C0C0C0",
  bronze: "#CD7F32",
};

// —————————————————————————————————————————————
// MOCK (SE FIREBASE FALHAR)
const makeMockRanking = (city = "Santa Maria", count = 100) =>
  Array.from({ length: count }, (_, i) => {
    const zones = Math.floor(Math.random() * 120);
    const area = +(Math.random() * 50).toFixed(2);
    const xp = Math.floor(Math.random() * 25000);
    const level = Math.floor(xp / 2000) + 1;
    const eloScore = Math.floor(Math.random() * 3000);

    const elo =
      eloScore > 2400 ? "Global" :
      eloScore > 1800 ? "Diamante" :
      eloScore > 1200 ? "Ouro" :
      eloScore > 700 ? "Prata" :
      "Bronze";

    return {
      id: (i + 1).toString(),
      name: `Usuário ${i + 1}`,
      avatar: `https://i.pravatar.cc/150?img=${(i % 70) + 1}`,
      city,
      zones,
      area,
      xp,
      level,
      elo,
      eloScore,
      dailyPoints: Math.floor(Math.random() * 300),
    };
  });

// —————————————————————————————————————————————
// SORT
const sortBy = (list, criterion) => {
  const copy = [...list];
  if (criterion === "zones") return copy.sort((a, b) => b.zones - a.zones);
  if (criterion === "area") return copy.sort((a, b) => b.area - a.area);
  if (criterion === "xp") return copy.sort((a, b) => b.xp - a.xp);
  return copy.sort((a, b) => b.eloScore - a.eloScore);
};

const topBadge = (pos) => {
  if (pos === 0) return { label: "1", color: colors.gold };
  if (pos === 1) return { label: "2", color: colors.silver };
  if (pos === 2) return { label: "3", color: colors.bronze };
  return null;
};

// —————————————————————————————————————————————
// RankItem
function RankItem({ item, index }) {
  const badge = topBadge(index);

  return (
    <View style={styles.item}>
      <View style={styles.positionCol}>
        {badge ? (
          <View style={[styles.medal, { backgroundColor: badge.color }]}>
            <Text style={styles.medalText}>{badge.label}</Text>
          </View>
        ) : (
          <Text style={styles.position}>{index + 1}</Text>
        )}
      </View>

      <Image source={{ uri: item.avatar }} style={styles.avatar} />

      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={styles.rowBetween}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <View style={styles.eloBox}>
            <Text style={styles.eloText}>{item.elo}</Text>
          </View>
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.info}>
            {item.zones} zonas • {item.area} km²
          </Text>

          <View style={styles.xpBox}>
            <Text style={styles.xpText}>{item.level} • {item.xp} XP</Text>
          </View>
        </View>

        <View style={styles.progressRow}>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${Math.min(100, (item.xp % 2000) / 20)}%` },
              ]}
            />
          </View>
          <Text style={styles.dailyPoints}>+{item.dailyPoints}/dia</Text>
        </View>
      </View>
    </View>
  );
}

// —————————————————————————————————————————————
// TELA PRINCIPAL DO RANKING
export default function RankingScreen({ route }) {
  const routeCity = route?.params?.city || "Santa Maria";

  const [city, setCity] = useState(routeCity);
  const [scope, setScope] = useState("global");
  const [criterion, setCriterion] = useState("zones");
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(() => makeMockRanking(city));

  const animScale = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animScale, { toValue: 1.02, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(animScale, { toValue: 0.96, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
      { iterations: -1 }
    ).start();
  }, []);

  const filtered = useMemo(() => {
    let list = [...data];

    if (scope === "regional") list = list.filter((u) => u.city.toLowerCase() === city.toLowerCase());
    if (query.trim()) list = list.filter((u) => u.name.toLowerCase().includes(query.trim().toLowerCase()));

    return sortBy(list, criterion);
  }, [data, scope, city, criterion, query]);

  const top3 = filtered.slice(0, 3);

  // HEADER COMPONENT
  const Header = () => (
    <View style={styles.headerContainer}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Ionicons name="trophy-outline" size={28} color={colors.primary} />
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.title}>Ranking</Text>
            <Text style={styles.subtitle}>Global • Regional</Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="Cidade"
            placeholderTextColor="#888"
            style={styles.cityInput}
          />
        </View>
      </View>

      <View style={styles.controlsRow}>
        <View style={styles.segment}>
          <TouchableOpacity onPress={() => setScope("global")} style={[styles.segmentBtn, scope === "global" && styles.segmentActive]}>
            <Text style={[styles.segmentText, scope === "global" && styles.segmentTextActive]}>Global</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setScope("regional")} style={[styles.segmentBtn, scope === "regional" && styles.segmentActive]}>
            <Text style={[styles.segmentText, scope === "regional" && styles.segmentTextActive]}>Regional</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filterGroup}>
          <TouchableOpacity onPress={() => setCriterion("zones")} style={[styles.filterBtn, criterion === "zones" && styles.filterActive]}>
            <Text style={[styles.filterText, criterion === "zones" && styles.filterTextActive]}>Zonas</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setCriterion("area")} style={[styles.filterBtn, criterion === "area" && styles.filterActive]}>
            <Text style={[styles.filterText, criterion === "area" && styles.filterTextActive]}>Área</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setCriterion("xp")} style={[styles.filterBtn, criterion === "xp" && styles.filterActive]}>
            <Text style={[styles.filterText, criterion === "xp" && styles.filterTextActive]}>XP</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.heroRow}>
        <View style={styles.heroLeft}>
          <Text style={styles.heroTitle}>Top 3</Text>
          <Text style={styles.heroSub}>Líderes do momento</Text>
        </View>

        <Animated.View style={[styles.heroRight, { transform: [{ scale: animScale }] }]}>
          {top3.map((u) => (
            <View key={u.id} style={styles.topCard}>
              <Image source={{ uri: u.avatar }} style={styles.topAvatar} />
              <Text style={styles.topName}>{u.name}</Text>
              <Text style={styles.topSmall}>{u.zones} zonas • {u.area} km²</Text>
            </View>
          ))}
        </Animated.View>
      </View>

      <View style={styles.separator} />
    </View>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={{ padding: 24, alignItems: "center" }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item, index }) => <RankItem item={item} index={index} />}
          contentContainerStyle={{ paddingBottom: 160 }}
          ListHeaderComponent={<Header />}
          stickyHeaderIndices={[0]}
          ListEmptyComponent={<Text style={{ textAlign: "center", marginTop: 20, color: colors.textMuted }}>Sem resultados</Text>}
        />
      )}
    </View>
  );
}

// —————————————————————————————————————————————
// STYLES FINAL (REFORMULADO)
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "ios" ? 54 : 20,
  },

  headerContainer: {
    backgroundColor: colors.bgCard,
    paddingVertical: 10,
    borderBottomColor: "#0d2837",
    borderBottomWidth: 1,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
  },

  headerLeft: { flexDirection: "row", alignItems: "center" },
  headerRight: { width: 160 },

  title: { fontSize: 20, fontWeight: "900", color: colors.textMain },
  subtitle: { fontSize: 12, color: colors.textMuted },

  cityInput: {
    backgroundColor: "#0f1920",
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
    color: colors.textMain,
    fontWeight: "600",
    borderColor: "#143040",
    borderWidth: 1,
  },

  controlsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 6,
  },

  segment: {
    flexDirection: "row",
    backgroundColor: "#0f1920",
    borderRadius: 10,
    overflow: "hidden",
    borderColor: "#12333f",
    borderWidth: 1,
  },

  segmentBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { color: colors.textMain, fontWeight: "700" },
  segmentTextActive: { color: "#fff" },

  filterGroup: { flexDirection: "row", gap: 8 },
  filterBtn: {
    backgroundColor: "#07121a",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderColor: "#12333f",
    borderWidth: 1,
  },
  filterActive: { backgroundColor: colors.accent },
  filterText: { color: colors.textMain, fontWeight: "700" },
  filterTextActive: { color: "#fff" },

  heroRow: { flexDirection: "row", alignItems: "center", marginTop: 10, marginBottom: 12 },
  heroLeft: { flex: 1 },
  heroTitle: { fontSize: 16, fontWeight: "900", color: colors.textMain },
  heroSub: { fontSize: 12, color: colors.textMuted },

  heroRight: { flexDirection: "row", alignItems: "center" },

  topCard: {
    width: 90,
    alignItems: "center",
    marginLeft: 8,
    backgroundColor: "#071a21",
    padding: 8,
    borderRadius: 10,
    borderColor: "#0d2d39",
    borderWidth: 1.2,
  },

  topAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: 6,
    borderColor: "#13414f",
    borderWidth: 2,
    backgroundColor: "#0c1d24",
  },

  topName: { fontSize: 12, fontWeight: "800", color: colors.textMain },
  topSmall: { fontSize: 11, color: colors.textMuted, textAlign: "center" },

  separator: { height: 1, backgroundColor: "#081a22", marginVertical: 6 },

  item: {
    flexDirection: "row",
    paddingVertical: 14,
    alignItems: "center",
    borderBottomColor: "#0a2630",
    borderBottomWidth: 1,
  },

  positionCol: { width: 40, alignItems: "center" },
  position: { fontWeight: "900", color: colors.textMain },

  medal: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  medalText: { color: "#fff", fontWeight: "900" },

  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0b1316",
    borderColor: "#13414f",
    borderWidth: 1.2,
  },

  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },

  name: { fontSize: 15, fontWeight: "900", color: colors.textMain, maxWidth: 160 },
  info: { fontSize: 13, color: colors.textMuted },

  eloBox: {
    backgroundColor: "#0a2a31",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderColor: "#13414f",
    borderWidth: 1,
  },
  eloText: { color: colors.accent, fontSize: 12, fontWeight: "900" },

  xpBox: {
    backgroundColor: "#07161a",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderColor: "#13303c",
    borderWidth: 1,
  },
  xpText: { color: colors.textMain, fontSize: 12, fontWeight: "700" },

  progressRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  progressBarBg: { flex: 1, height: 6, backgroundColor: "#07161a", borderRadius: 6, overflow: "hidden", marginRight: 8 },
  progressBarFill: { height: 6, backgroundColor: colors.primary },

  dailyPoints: { fontSize: 11, color: colors.textMuted },
});
