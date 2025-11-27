// src/screens/FriendRunsScreen.js
// Histórico de corridas — estilizado no padrão Wayper 2025

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { collection, query, orderBy, limit, startAfter, getDocs } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../../theme/colors";

export default function FriendRunsScreen({ route }) {
  const friendId = route?.params?.friendId;
  const PAGE_SIZE = 12;

  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastDoc, setLastDoc] = useState(null);
  const [endReached, setEndReached] = useState(false);

  useEffect(() => {
    if (!friendId) return;
    loadPage();
  }, [friendId]);

  const loadPage = async () => {
    setLoading(true);
    try {
      const runsRef = collection(db, "users", friendId, "runs");
      const q = query(runsRef, orderBy("date", "desc"), limit(PAGE_SIZE));
      const snaps = await getDocs(q);

      const arr = [];
      snaps.forEach((s) => arr.push({ id: s.id, ...s.data() }));

      setRuns(arr);
      setLastDoc(snaps.docs[snaps.docs.length - 1] || null);
      setEndReached(snaps.size < PAGE_SIZE);
    } catch (e) {
      Alert.alert("Erro", "Falha ao carregar histórico.");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || endReached || !lastDoc) return;

    setLoadingMore(true);

    try {
      const runsRef = collection(db, "users", friendId, "runs");
      const q = query(
        runsRef,
        orderBy("date", "desc"),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      const snaps = await getDocs(q);
      const arr = [];
      snaps.forEach((s) => arr.push({ id: s.id, ...s.data() }));

      setRuns((prev) => [...prev, ...arr]);
      setLastDoc(snaps.docs[snaps.docs.length - 1] || lastDoc);

      if (snaps.size < PAGE_SIZE) setEndReached(true);
    } catch (e) {
      console.warn("loadMore error", e);
    } finally {
      setLoadingMore(false);
    }
  };

  const shareGPX = async (run) => {
    try {
      const gpx = toGPX(
        run.path || run.coords || [],
        {
          name: `Run ${run.date}`,
          time: new Date(run.date).toISOString(),
        }
      );

      const path = FileSystem.cacheDirectory + `run_${run.id}.gpx`;
      await FileSystem.writeAsStringAsync(path, gpx, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
      else Alert.alert("Aviso", "Compartilhamento não disponível.");
    } catch {
      Alert.alert("Erro", "Falha ao exportar GPX.");
    }
  };

  const toGPX = (coords, meta = {}) => {
    const header = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Wayper">`;

    const body = coords
      .map(
        (p) =>
          `<trkpt lat="${p.latitude}" lon="${p.longitude}">
             <time>${p.timestamp || ""}</time>
           </trkpt>`
      )
      .join("\n");

    return `${header}
<trk>
<name>${meta.name}</name>
<trkseg>
${body}
</trkseg>
</trk>
</gpx>`;
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.date}>{new Date(item.date).toLocaleString()}</Text>

        <Text style={styles.small}>
          {(item.distance / 1000).toFixed(2)} km • {formatTime(item.time)}
        </Text>

        <Text style={styles.small}>
          Área: {(item.area || 0).toFixed(2)} km²
        </Text>
      </View>

      <View style={{ alignItems: "flex-end" }}>
        <TouchableOpacity style={styles.smallBtn} onPress={() => shareGPX(item)}>
          <Text style={styles.smallBtnText}>GPX</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.smallBtn, { marginTop: 8 }]}
          onPress={() =>
            Alert.alert("Detalhes da Corrida", JSON.stringify(item, null, 2))
          }
        >
          <Text style={styles.smallBtnText}>Detalhes</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={runs}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ListFooterComponent={() =>
          loadingMore ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null
        }
        contentContainerStyle={{ padding: 14 }}
      />
    </View>
  );
}

function formatTime(s) {
  if (s == null) return "-:--";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec < 10 ? "0" + sec : sec}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: Platform.OS === "ios" ? 56 : 20,
  },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  card: {
    backgroundColor: colors.backgroundCard,
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    flexDirection: "row",
    borderColor: colors.border,
    borderWidth: 1,
  },

  date: {
    color: colors.textMain,
    fontWeight: "800",
    fontSize: 14,
  },

  small: {
    color: colors.textMuted,
    marginTop: 6,
    fontSize: 13,
  },

  smallBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },

  smallBtnText: {
    color: colors.white,
    fontWeight: "900",
  },
});
