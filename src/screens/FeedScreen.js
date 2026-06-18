import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { auth, db } from "../firebaseConfig";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  getDoc,
  limit,
} from "firebase/firestore";
import HomeAvatar from "../components/Home/HomeAvatar";

const WAYPER_GREEN = "#00e676";

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const formatDistance = (meters = 0) => `${(Number(meters || 0) / 1000).toFixed(2)} km`;
const formatArea = (m2 = 0) => {
  const safe = Number(m2 || 0);
  if (safe >= 1e6) return `${(safe / 1e6).toFixed(2)} km²`;
  return `${Math.round(safe)} m²`;
};

const formatDate = (value) => {
  try {
    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

export default function FeedScreen() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadFollowingIds = useCallback(async (uid) => {
    const snap = await getDocs(collection(db, "users", uid, "friends"));
    return snap.docs.map((item) => item.data()?.friendId).filter(Boolean);
  }, []);

  const loadUsersMap = useCallback(async (ids) => {
    const pairs = await Promise.all(
      ids.map(async (id) => {
        try {
          const snap = await getDoc(doc(db, "users", id));
          return [id, snap.exists() ? snap.data() : null];
        } catch {
          return [id, null];
        }
      })
    );
    return new Map(pairs);
  }, []);

  const loadFeed = useCallback(async ({ silent = false } = {}) => {
    const user = auth.currentUser;
    if (!user) {
      setActivities([]);
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);

    try {
      const followingIds = await loadFollowingIds(user.uid);
      if (!followingIds.length) {
        setActivities([]);
        return;
      }

      const usersMap = await loadUsersMap(followingIds);
      const rows = [];

      for (const ids of chunk(followingIds, 10)) {
        const q = query(
          collection(db, "activities"),
          where("userId", "in", ids),
          orderBy("timestamp", "desc"),
          limit(30)
        );
        const snap = await getDocs(q);
        snap.forEach((activitySnap) => {
          const data = activitySnap.data();
          if (data.visibility === "private") return;
          const actor = usersMap.get(data.userId) || {};
          rows.push({
            id: activitySnap.id,
            ...data,
            actorName: actor.name || actor.displayName || actor.username || "Usuario",
            actorUsername: actor.username || "",
            actorAvatar: actor.avatar || actor.photoURL || null,
            actorIsPrivate: !!actor.isPrivate,
          });
        });
      }

      rows.sort((a, b) => {
        const ad = a.timestamp?.toDate?.() || a.createdAt?.toDate?.() || new Date(a.date || 0);
        const bd = b.timestamp?.toDate?.() || b.createdAt?.toDate?.() || new Date(b.date || 0);
        return bd - ad;
      });

      setActivities(rows.slice(0, 80));
    } catch (error) {
      console.error("Erro ao buscar feed:", error);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [loadFollowingIds, loadUsersMap]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFeed({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadFeed]);

  const summary = useMemo(() => {
    const runs = activities.filter((item) => item.type === "run").length;
    const zones = activities.filter((item) => item.type === "zone" || item.mode === "zones").length;
    return { runs, zones };
  }, [activities]);

  const renderActivity = ({ item }) => {
    const isZone = item.type === "zone" || item.mode === "zones";
    const date = item.timestamp || item.createdAt || item.date;
    const description =
      item.description ||
      (isZone
        ? `capturou ${formatArea(item.area)}`
        : `correu ${formatDistance(item.distance)}`);

    return (
      <View style={styles.activityItem}>
        <View style={styles.userInfo}>
          <HomeAvatar uri={item.actorAvatar} name={item.actorName} size={48} style={styles.userPhoto} />
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{item.actorName}</Text>
            <Text style={styles.userMeta}>@{item.actorUsername || "wayper"} • {formatDate(date)}</Text>
          </View>
          <Ionicons name={isZone ? "map-outline" : "walk-outline"} size={22} color={WAYPER_GREEN} />
        </View>

        <Text style={styles.activityText}>{description}</Text>

        <View style={styles.metricRow}>
          <View style={styles.metricPill}>
            <Text style={styles.metricLabel}>Km</Text>
            <Text style={styles.metricValue}>{formatDistance(item.distance)}</Text>
          </View>
          <View style={styles.metricPill}>
            <Text style={styles.metricLabel}>Area</Text>
            <Text style={styles.metricValue}>{formatArea(item.area)}</Text>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={WAYPER_GREEN} size="large" />
        <Text style={styles.loadingText}>Carregando feed...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Feed</Text>
        <Text style={styles.subtitle}>
          {summary.runs} corridas • {summary.zones} capturas dos perfis que voce segue
        </Text>
      </View>

      <FlatList
        data={activities}
        keyExtractor={(item) => item.id}
        renderItem={renderActivity}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={WAYPER_GREEN} />}
        contentContainerStyle={activities.length ? styles.listContent : styles.emptyContent}
        ListEmptyComponent={<Text style={styles.emptyText}>Siga outros atletas para ver atividades recentes aqui.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0d10" },
  center: { flex: 1, backgroundColor: "#0b0d10", justifyContent: "center", alignItems: "center" },
  loadingText: { color: "#9aa0a6", marginTop: 10 },
  header: { padding: 18, borderBottomWidth: 1, borderBottomColor: "#182128" },
  title: { fontSize: 24, fontWeight: "900", color: "#fff" },
  subtitle: { color: "#9aa0a6", marginTop: 4 },
  listContent: { padding: 16, paddingBottom: 120 },
  emptyContent: { flexGrow: 1, justifyContent: "center", padding: 24 },
  activityItem: {
    backgroundColor: "#11171d",
    padding: 14,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1c3038",
  },
  userInfo: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  userPhoto: { width: 44, height: 44, borderRadius: 22, marginRight: 10, backgroundColor: "#223039" },
  userName: { fontSize: 16, fontWeight: "900", color: "#fff" },
  userMeta: { fontSize: 12, color: "#8c9aa3", marginTop: 2 },
  activityText: { fontSize: 15, color: "#e8f3f1", marginBottom: 12, fontWeight: "700" },
  metricRow: { flexDirection: "row", gap: 10 },
  metricPill: { flex: 1, backgroundColor: "#0b0d10", padding: 10, borderRadius: 8 },
  metricLabel: { color: "#8c9aa3", fontSize: 12 },
  metricValue: { color: WAYPER_GREEN, fontWeight: "900", marginTop: 3 },
  emptyText: { textAlign: "center", color: "#9aa0a6", fontSize: 16 },
});
