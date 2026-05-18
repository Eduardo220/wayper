import React, { memo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../../theme/wayperTheme";

const BRAND_LOGO = require("../../../assets/logo.png");

function openDrawer(navigation) {
  if (typeof navigation?.openDrawer === "function") {
    navigation.openDrawer();
    return;
  }
  const parent = navigation?.getParent?.();
  if (typeof parent?.openDrawer === "function") parent.openDrawer();
}

function HomeHeader({
  navigation,
  unreadMessages = 0,
  notificationsCount = 0,
  onNotificationsPress,
  onMessagesPress,
}) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" style={styles.menuButton} onPress={() => openDrawer(navigation)}>
        <Ionicons name="menu" size={25} color={WayperTheme.colors.text} />
      </Pressable>

      <View style={styles.titleBlock}>
        <Image source={BRAND_LOGO} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brand} numberOfLines={1}>Wayper</Text>
        <View style={styles.divider} />
        <Text style={styles.title} numberOfLines={1}>Início</Text>
      </View>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={styles.iconButton} onPress={onNotificationsPress}>
          <Ionicons name="notifications-outline" size={22} color={WayperTheme.colors.text} />
          {notificationsCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{Math.min(99, notificationsCount)}</Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable accessibilityRole="button" style={styles.iconButton} onPress={onMessagesPress}>
          <Ionicons name="chatbubble-ellipses-outline" size={22} color={WayperTheme.colors.text} />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{Math.min(99, Math.max(0, unreadMessages))}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export default memo(HomeHeader);

const styles = StyleSheet.create({
  header: {
    minHeight: 76,
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(3, 8, 11, 0.96)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0, 230, 118, 0.10)",
  },
  menuButton: {
    width: 48,
    height: 48,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    marginLeft: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  logo: {
    width: 32,
    height: 26,
    borderRadius: 7,
    marginRight: 9,
  },
  brand: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0,
  },
  divider: {
    width: 1,
    height: 30,
    backgroundColor: WayperTheme.colors.borderStrong,
    marginHorizontal: 12,
  },
  title: {
    color: WayperTheme.colors.primary,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    letterSpacing: 0,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: WayperTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.18)",
  },
  badge: {
    position: "absolute",
    top: 6,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.background,
  },
  badgeText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 10,
    fontWeight: "900",
  },
});
