// src/screens/ClanDetailScreen.js
import React, { useEffect, useState } from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { colors } from "../../theme/colors";
import ClanChat from "../../components/Clan/ClanChat";
import ClanMembersList from "../../components/Clan/ClanMembersList";
import { Platform } from "react-native";

export default function ClanDetailScreen({ route, navigation }) {
  const clanId = route?.params?.clanId;
  const [clan, setClan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMember, setIsMember] = useState(false);
  const [memberRole, setMemberRole] = useState(null);

  useEffect(() => {
    if (!clanId) return navigation.goBack();

    const ref = doc(db, "clans", clanId);
    const unsub = onSnapshot(ref, s => {
      if (s.exists()) setClan({ id: s.id, ...s.data() });
      else navigation.goBack();
      setLoading(false);
    });

    const check = async () => {
      const uid = auth.currentUser.uid;
      const mRef = doc(db, "clans", clanId, "members", uid);
      const snap = await getDoc(mRef);

      if (snap.exists()) {
        setIsMember(true);
        setMemberRole(snap.data().role);
      } else {
        setIsMember(false);
        setMemberRole(null);
      }
    };

    check();
    return () => unsub();
  }, [clanId]);

  if (loading || !clan) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      
      {/* HEADER FIXO */}
      <View style={styles.header}>
        <View style={styles.avatarWrap}>
          <Image source={{ uri: clan.avatar || null }} style={styles.avatar} />
        </View>

        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.name}>
            {clan.name} <Text style={styles.tag}>#{clan.tag}</Text>
          </Text>

          <Text style={styles.desc}>{clan.description}</Text>

          <View style={{ flexDirection: "row", marginTop: 8 }}>
            <Text style={styles.small}>Membros: {clan.membersCount || 0}</Text>
            <Text style={[styles.small, { marginLeft: 12 }]}>
              Criado por: {clan.ownerId}
            </Text>
          </View>
        </View>
      </View>

      {/* BOTÕES */}
      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: isMember ? colors.backgroundCard : colors.primary }]}
        >
          <Text style={{ color: colors.white }}>
            {isMember ? "Dentro" : "Entrar"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.backgroundCard }]}>
          <Text style={{ color: colors.textMain }}>Convidar</Text>
        </TouchableOpacity>

        {memberRole === "owner" && (
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.accent }]}>
            <Text style={{ color: colors.white }}>Gerenciar</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ANÚNCIO */}
      {clan.announcement && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Anúncio</Text>
          <Text style={styles.sectionText}>{clan.announcement}</Text>
        </View>
      )}

      {/* LISTA DE MEMBROS (TEM SCROLL PRÓPRIO) */}
      <ClanMembersList clanId={clanId} />

      {/* CHAT (TEM SCROLL PRÓPRIO) */}
      <Text style={styles.chatTitle}>Chat do clã</Text>
      <ClanChat clanId={clanId} />

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
    paddingTop: Platform.OS === "ios" ? 56 : 20,
  },

  header: {
    flexDirection: "row",
    backgroundColor: colors.backgroundCard,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },

  avatarWrap: {
    width: 84,
    height: 84,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },

  avatar: { width: 80, height: 80, borderRadius: 10 },

  name: { color: colors.textMain, fontWeight: "900", fontSize: 18 },

  tag: { color: colors.textMuted, fontWeight: "700" },

  desc: { color: colors.textMuted, marginTop: 6 },

  small: { color: colors.textMuted },

  btnRow: { flexDirection: "row", gap: 12, marginTop: 12 },

  actionBtn: {
    padding: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },

  section: {
    backgroundColor: colors.backgroundCard,
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
    borderColor: colors.border,
    borderWidth: 1,
  },

  sectionTitle: { color: colors.textSoft, fontWeight: "800", marginBottom: 6 },

  sectionText: { color: colors.textMain },

  chatTitle: {
    color: colors.textMain,
    fontWeight: "900",
    marginTop: 18,
    marginBottom: 6,
    fontSize: 16,
  },
});
