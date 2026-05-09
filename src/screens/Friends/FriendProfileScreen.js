// src/screens/FriendProfileScreen.js
import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  ScrollView,
} from "react-native";
import { doc, getDoc, collection, query, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import MedalsWidget from "../../components/MedalsWidget";
import { colors } from "../../theme/colors";

const formatArea = (m2 = 0) => {
  const safe = Number(m2 || 0);
  if (safe >= 1e6) return `${(safe / 1e6).toFixed(2)} km²`;
  return `${Math.round(safe)} m²`;
};

export default function FriendProfileScreen({ route, navigation }) {
  const friendId = route?.params?.friendId;
  const [friend, setFriend] = useState(null);
  const [loading, setLoading] = useState(true);
  const [runsCount, setRunsCount] = useState(0);
  const [areaTotal, setAreaTotal] = useState(0);

  useEffect(() => {
    if (!friendId) {
      navigation.goBack();
      return;
    }

    let unsubUser = null;

    unsubUser = onSnapshot(
      doc(db, "users", friendId),
      (snap) => {
        if (snap.exists()) {
          setFriend({ id: snap.id, ...snap.data() });
          setLoading(false);
        } else {
          navigation.goBack();
        }
      },
      () => setLoading(false)
    );

    (async () => {
      try {
        const runsRef = collection(db, "users", friendId, "runs");
        const snaps = await getDocs(query(runsRef));
        let a = 0;

        snaps.forEach((d) => {
          const data = d.data();
          a += data.area || 0;
        });

        setRunsCount(snaps.size);
        setAreaTotal(a);
      } catch {}
    })();

    return () => unsubUser && unsubUser();
  }, [friendId]);

  const topStats = useMemo(() => {
    if (!friend) return {};
    return {
      level: friend.level || 1,
      xp: friend.xp || 0,
      totalZones: friend.totalZones || 0,
      totalArea: areaTotal || friend.totalArea || 0,
    };
  }, [friend, areaTotal]);

  if (loading || !friend) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (friend.isPrivate || friend.profileVisibility === "private") {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Image source={{ uri: friend.avatar || friend.photoURL || "https://i.pravatar.cc/150" }} style={styles.avatar} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.name}>{friend.name || friend.username}</Text>
            <Text style={styles.username}>@{friend.username}</Text>
            <Text style={styles.small}>Perfil privado</Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

      {/* HEADER */}
      <View style={styles.header}>
        <Image
          source={{
            uri: friend.avatar || friend.photoURL || "https://i.pravatar.cc/150",
          }}
          style={styles.avatar}
        />

        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.name}>{friend.name || friend.username}</Text>
          <Text style={styles.username}>@{friend.username}</Text>

          <View style={styles.statRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{topStats.level}</Text>
              <Text style={styles.statLabel}>Nível</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{topStats.xp}</Text>
              <Text style={styles.statLabel}>XP</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{runsCount}</Text>
              <Text style={styles.statLabel}>Corridas</Text>
            </View>
          </View>
        </View>
      </View>

      {/* RESUMO */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Resumo</Text>

        <View style={styles.rowBetween}>
          <Text style={styles.small}>Zonas conquistadas</Text>
          <Text style={styles.smallBold}>{topStats.totalZones}</Text>
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.small}>Área total</Text>
          <Text style={styles.smallBold}>
            {formatArea(topStats.totalArea || 0)}
          </Text>
        </View>
      </View>

      {/* MEDALHAS */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Medalhas</Text>
        <MedalsWidget userId={friendId} compact />
      </View>

      {/* HISTÓRICO */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Histórico de Corridas</Text>

        <TouchableOpacity
          style={styles.viewAllBtn}
          onPress={() => navigation.navigate("FriendRuns", { friendId })}
        >
          <Text style={styles.viewAllText}>Ver histórico completo</Text>
        </TouchableOpacity>

        <FriendRunsPreview
          friendId={friendId}
          openFull={() => navigation.navigate("FriendRuns", { friendId })}
        />
      </View>
    </ScrollView>
  );
}

// preview — últimas 3 corridas
function FriendRunsPreview({ friendId, openFull }) {
  const [runs, setRuns] = useState(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const runsRef = collection(db, "users", friendId, "runs");
        const snaps = await getDocs(query(runsRef));

        const arr = [];
        snaps.forEach((d) => arr.push({ id: d.id, ...d.data() }));
        arr.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        if (mounted) setRuns(arr.slice(0, 3));
      } catch {
        if (mounted) setRuns([]);
      }
    })();

    return () => (mounted = false);
  }, [friendId]);

  if (!runs) return <ActivityIndicator size="small" color={colors.primary} />;
  if (runs.length === 0) return <Text style={styles.small}>Sem corridas ainda.</Text>;

  return (
    <>
      {runs.map((r) => (
        <View key={r.id} style={styles.runRow}>
          <Text style={styles.smallBold}>
            {new Date(r.date).toLocaleDateString()}
          </Text>

          <Text style={styles.small}>
            {(r.distance / 1000)?.toFixed(2)} km • {formatTime(r.duration)}
          </Text>
        </View>
      ))}

      <TouchableOpacity onPress={openFull} style={styles.link}>
        <Text style={styles.linkText}>Ver tudo</Text>
      </TouchableOpacity>
    </>
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
    paddingHorizontal: 16,
  },

  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.backgroundDark,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.backgroundCard,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderColor: colors.border,
    borderWidth: 1,
  },

  avatar: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    borderColor: colors.border,
  },

  name: {
    color: colors.textMain,
    fontSize: 20,
    fontWeight: "900",
  },

  username: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },

  statRow: {
    flexDirection: "row",
    marginTop: 10,
  },

  statBox: {
    marginRight: 16,
    alignItems: "center",
  },

  statValue: {
    color: colors.textMain,
    fontSize: 17,
    fontWeight: "900",
  },

  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },

  section: {
    backgroundColor: colors.backgroundCard,
    padding: 14,
    borderRadius: 12,
    marginTop: 14,
    borderColor: colors.border,
    borderWidth: 1,
  },

  sectionTitle: {
    color: colors.textSoft,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 10,
  },

  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  small: {
    color: colors.textMuted,
    fontSize: 13,
  },

  smallBold: {
    color: colors.textMain,
    fontSize: 13,
    fontWeight: "700",
  },

  viewAllBtn: {
    alignSelf: "flex-end",
    marginBottom: 8,
  },

  viewAllText: {
    color: colors.primary,
    fontWeight: "800",
  },

  runRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },

  link: {
    marginTop: 10,
    alignItems: "center",
  },

  linkText: {
    color: colors.primary,
    fontWeight: "800",
  },
});

