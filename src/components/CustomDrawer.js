import React, { memo } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
} from "react-native";

import {
  DrawerContentScrollView,
} from "@react-navigation/drawer";

import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../theme/wayperTheme";

const BRAND_LOGO = require("../../assets/logo.png");

const DRAWER_ICONS = {
  Mapa: "map-outline",
  Corridas: "walk-outline",
  Dashboard: "analytics-outline",
  Perfil: "person-outline",
  Ranking: "podium-outline",
  Amigos: "people-outline",
  Grupos: "chatbubbles-outline",
};

export default memo(function CustomDrawer(props) {
  const user = props.user || {};

  const name =
    user.name ||
    user.displayName ||
    user.username ||
    user.email?.split("@")[0] ||
    "Usuário";

  const avatar =
    user.photoURL ||
    user.avatar ||
    "https://i.pravatar.cc/150?u=wayper_default";

  const level = Number(user.level) || 1;
  const xp = Number(user.xp) || 0;
  const nextXP = Number(user.nextLevelXp || user.nextLevelXP) || 1000;
  const area = Number(user.totalArea ?? user.area) || 0;

  const progress = Math.max(
    0,
    Math.min((xp / nextXP) * 100 || 0, 100)
  );

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <LinearGradient colors={[WayperTheme.colors.backgroundAlt, WayperTheme.colors.surfaceElevated]} style={styles.header}>
        <View style={styles.brandRow}>
          <Image source={BRAND_LOGO} style={styles.brandLogo} resizeMode="contain" />
          <Text style={styles.brandText}>Wayper</Text>
        </View>
        
        {/* AVATAR */}
        <View>
          <Image source={{ uri: avatar }} style={styles.avatar} />
        </View>

        {/* NOME */}
        <Text style={styles.name}>
          {name}
        </Text>

        {/* LEVEL */}
        <Text style={styles.level}>
          Nível {level}
        </Text>

        {/* XP BAR */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.xpText}>
            {xp} / {nextXP} XP
          </Text>
        </View>

        {/* AREA */}
        <View style={styles.areaRow}>
          <Ionicons name="map-outline" size={16} color={WayperTheme.colors.primary} />
          <Text style={styles.areaText}>
            {area >= 1e6 ? `${(area / 1e6).toFixed(2)} km²` : `${Math.round(area)} m²`} conquistados
          </Text>
        </View>
      </LinearGradient>

      {/* MENU */}
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={styles.scrollBody}
      >
        <View style={styles.navList}>
          {props.state.routes.map((route, index) => {
            const descriptor = props.descriptors?.[route.key];
            const label = descriptor?.options?.drawerLabel ?? descriptor?.options?.title ?? route.name;
            const focused = props.state.index === index;
            const icon = DRAWER_ICONS[route.name] || "ellipse-outline";

            return (
              <TouchableOpacity
                key={route.key}
                activeOpacity={0.86}
                style={[styles.navItem, focused && styles.navItemActive]}
                onPress={() => props.navigation.navigate(route.name)}
              >
                <View style={[styles.navIcon, focused && styles.navIconActive]}>
                  <Ionicons
                    name={icon}
                    size={21}
                    color={focused ? WayperTheme.colors.textInverse : WayperTheme.colors.textMuted}
                  />
                </View>
                <Text style={[styles.navLabel, focused && styles.navLabelActive]}>{label}</Text>
                {focused ? <View style={styles.navActiveDot} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </DrawerContentScrollView>

      {/* FOOTER */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={props.onSignOut}
        >
          <Ionicons name="exit-outline" size={20} color={WayperTheme.colors.textInverse} />
          <Text style={styles.logoutText}>Sair</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
  },

  header: {
    paddingTop: 42,
    paddingBottom: 28,
    paddingHorizontal: 18,
    alignItems: "center",
    borderBottomRightRadius: WayperTheme.radius.xxl,
    borderBottomLeftRadius: WayperTheme.radius.xxl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    overflow: "hidden",
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },

  brandLogo: {
    width: 48,
    height: 36,
    borderRadius: 12,
  },

  brandText: {
    color: WayperTheme.colors.text,
    fontSize: 24,
    fontWeight: "900",
  },

  avatar: {
    width: 95,
    height: 95,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: WayperTheme.colors.primaryBorder,
    marginBottom: 12,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.26,
    shadowRadius: 14,
  },

  name: {
    color: WayperTheme.colors.text,
    fontSize: 20,
    fontWeight: "700",
  },

  level: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    marginTop: 2,
    marginBottom: 12,
  },

  progressContainer: {
    width: "80%",
    alignItems: "center",
  },

  progressBar: {
    width: "100%",
    height: 8,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderRadius: WayperTheme.radius.pill,
    overflow: "hidden",
    marginBottom: 5,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },

  progressFill: {
    height: "100%",
    backgroundColor: WayperTheme.colors.primary,
    borderRadius: 6,
  },

  xpText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 11,
  },

  areaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    gap: 6,
  },

  areaText: {
    color: WayperTheme.colors.text,
    fontSize: 13,
    fontWeight: "600",
  },

  scrollBody: {
    paddingTop: 14,
    paddingHorizontal: 12,
    backgroundColor: WayperTheme.colors.background,
  },
  navList: {
    gap: 8,
    paddingBottom: 18,
  },
  navItem: {
    minHeight: 58,
    borderRadius: WayperTheme.radius.pill,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  navItemActive: {
    backgroundColor: WayperTheme.colors.primarySoft,
    borderColor: WayperTheme.colors.primaryBorder,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  navIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    marginRight: 12,
  },
  navIconActive: {
    backgroundColor: WayperTheme.colors.primary,
  },
  navLabel: {
    flex: 1,
    color: WayperTheme.colors.textMuted,
    fontSize: 15,
    fontWeight: "900",
  },
  navLabelActive: {
    color: WayperTheme.colors.primary,
  },
  navActiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: WayperTheme.colors.primary,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },

  footer: {
    padding: 14,
    backgroundColor: WayperTheme.colors.background,
    borderTopColor: WayperTheme.colors.border,
    borderTopWidth: 1,
  },

  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 54,
    paddingVertical: 12,
    backgroundColor: WayperTheme.colors.primary,
    borderRadius: WayperTheme.radius.pill,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    shadowColor: WayperTheme.colors.primary,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7,
  },

  logoutText: {
    color: WayperTheme.colors.textInverse,
    fontWeight: "700",
    fontSize: 15,
  },
});
