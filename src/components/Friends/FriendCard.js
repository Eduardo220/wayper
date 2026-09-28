// ==== FriendCard with Presence Badge ====
import React, { memo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import useFriendPresence from "../../hooks/useFriendPresence";
import HomeAvatar from "../Home/HomeAvatar";

function FriendCard({ friend, onPress, onRemove }) {
  const isOnline = useFriendPresence(friend?.friendUid);

  const avatar = friend?.avatar || friend?.photoURL || null;
  const name = friend?.name || friend?.username || "—";

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.avatarWrapper}>
        <HomeAvatar uri={avatar} name={name} size={64} />
        
        {/* === Presence badge === */}
        <View
          style={[
            styles.presenceBadge,
            { backgroundColor: isOnline ? "#00e676" : "#b0b0b0" },
          ]}
        />
      </View>

      <View style={{ flex: 1, marginRight: 8 }}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.username}>@{friend.username}</Text>

        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statText}>Lv {friend.level || 1}</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={styles.statText}>{(friend.totalArea || 0).toFixed(2)} km²</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.iconBtn} onPress={onRemove}>
        <Ionicons name="trash-outline" size={20} color={colors.primary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default memo(FriendCard);

// === styles ===
const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.backgroundCard,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },

  avatarWrapper: {
    width: 64,
    height: 64,
    marginRight: 12,
  },

  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },

  // Presence Circle — pequeno, discreto, profissional
  presenceBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#fff",
  },

  name: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.textMain,
  },

  username: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },

  statsRow: {
    flexDirection: "row",
    marginTop: 8,
    gap: 8,
  },

  statPill: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },

  statText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 12,
  },

  iconBtn: {
    padding: 8,
  },
});
