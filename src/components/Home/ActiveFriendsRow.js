import React, { memo, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../../theme/wayperTheme";
import HomeAvatar from "./HomeAvatar";

function ActiveFriendsRow({ friends = [], onAddPress, onSeeAllPress }) {
  const safeFriends = useMemo(() => (Array.isArray(friends) ? friends.slice(0, 12) : []), [friends]);

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Seus amigos ativos</Text>
        <Pressable accessibilityRole="button" onPress={onSeeAllPress} hitSlop={8}>
          <Text style={styles.seeAll}>Ver todos</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.friendsContent}
      >
        <Pressable style={styles.friendItem} onPress={onAddPress}>
          <View style={styles.addCircle}>
            <Ionicons name="add" size={25} color={WayperTheme.colors.textInverse} />
          </View>
          <Text style={styles.friendName} numberOfLines={1}>Adicionar</Text>
        </Pressable>

        {safeFriends.map((friend) => (
          <Pressable key={friend.id || friend.friendUid || friend.name} style={styles.friendItem} onPress={onSeeAllPress}>
            <View>
              <HomeAvatar uri={friend.avatar || friend.photoURL} name={friend.name || friend.username} size={58} />
              <View style={[styles.statusDot, friend.isActive ? styles.statusDotOn : styles.statusDotOff]} />
            </View>
            <Text style={styles.friendName} numberOfLines={1}>{friend.name || friend.username || "Atleta"}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export default memo(ActiveFriendsRow);

const styles = StyleSheet.create({
  section: {
    marginTop: 18,
  },
  titleRow: {
    paddingHorizontal: WayperTheme.spacing.page,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
  },
  seeAll: {
    color: WayperTheme.colors.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  friendsContent: {
    paddingHorizontal: WayperTheme.spacing.page,
    gap: 15,
  },
  friendItem: {
    width: 74,
    alignItems: "center",
  },
  addCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.34,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  statusDot: {
    position: "absolute",
    right: 1,
    bottom: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: WayperTheme.colors.background,
  },
  statusDotOn: {
    backgroundColor: WayperTheme.colors.primary,
  },
  statusDotOff: {
    backgroundColor: WayperTheme.colors.textSubtle,
  },
  friendName: {
    maxWidth: 74,
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 8,
  },
});
