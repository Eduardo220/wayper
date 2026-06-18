// MAIN NAVIGATOR — WAYPER (STABLE, OFFLINE-SAFE)

import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Image, StyleSheet, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { createDrawerNavigator } from "@react-navigation/drawer";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

// FIREBASE
import { auth } from "../firebaseConfig";
import { signOut } from "firebase/auth";

// SCREENS
import MapScreen from "../screens/MapScreen";
import HomeScreen from "../screens/HomeScreen";
import RankingScreen from "../screens/RankingScreen";
import ProfileScreen from "../screens/ProfileScreen";
import DiagnosticsScreen from "../screens/DiagnosticsScreen";
import SettingsScreen from "../screens/SettingsScreen";

// FRIENDS
import FriendsScreen from "../screens/Friends/FriendsScreen";
import FriendProfileScreen from "../screens/Friends/FriendProfileScreen";
import FriendRunsScreen from "../screens/Friends/FriendRunsScreen";

// GROUPS
import GroupsScreen from "../screens/Group/GroupsScreen";
import GroupDetailScreen from "../screens/Group/GroupDetailScreen";
import GroupChatScreen from "../screens/Group/GroupChatScreen";

// RUNS
import CorridasScreen from "../screens/Runs/CorridasScreen";
import RunDetailScreen from "../screens/Runs/RunDetailScreen";
import ZoneDetailScreen from "../screens/Runs/ZoneDetailScreen";
import DashboardScreen from "../screens/Runs/DashboardScreen";
import OnboardingScreen from "../screens/OnboardingScreen";

// UI
import CustomDrawer from "../components/CustomDrawer";
import { WayperTheme } from "../theme/wayperTheme";
import activeRunTrackingService from "../services/runTracking/activeRunTrackingService";
import {
  findRecoverableRunForUser,
  isLiveRecovery,
} from "../services/run/runRecoveryService.js";
import logger, { LOG_CATEGORIES } from "../utils/logger.js";
import { subscribeCurrentUserProfile } from "../repositories/userProfileRepository.js";
import { runLocalMigrationsOnce } from "../services/storage/storageMigrationService.js";
import runSyncQueueRepository from "../repositories/runSyncQueueRepository.js";
import { hasCompletedOnboarding } from "../services/onboarding/onboardingService.js";

const Drawer = createDrawerNavigator();
const Stack = createNativeStackNavigator();
const BRAND_LOGO = require("../../assets/logo.png");

function HeaderTitle({ title }) {
  return (
    <View style={styles.headerTitle}>
      <Image source={BRAND_LOGO} style={styles.headerLogo} resizeMode="contain" />
      <Text style={styles.headerBrand}>Wayper</Text>
      <View style={styles.headerDivider} />
      <Text style={styles.headerText}>{title}</Text>
    </View>
  );
}

/* ===========================
   FRIENDS STACK
   =========================== */
function FriendsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: WayperTheme.colors.background, height: 102 },
        headerShadowVisible: false,
        headerBackground: () => (
          <LinearGradient
            colors={[WayperTheme.colors.background, WayperTheme.colors.backgroundAlt]}
            style={StyleSheet.absoluteFill}
          />
        ),
        headerTintColor: WayperTheme.colors.text,
        headerLeftContainerStyle: { paddingLeft: 10 },
        headerTitleContainerStyle: { marginLeft: 18 },
        headerTitleStyle: { fontWeight: "900", fontSize: 20 },
      }}
    >
      <Stack.Screen name="FriendsHome" component={FriendsScreen} options={{ title: "Amigos" }} />
      <Stack.Screen name="FriendProfile" component={FriendProfileScreen} options={{ title: "Perfil" }} />
      <Stack.Screen name="FriendRuns" component={FriendRunsScreen} options={{ title: "Atividades" }} />
    </Stack.Navigator>
  );
}

/* ===========================
   GROUP STACK
   =========================== */
function GroupStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="GroupsHome" component={GroupsScreen} options={{ title: "Grupos" }} />
      <Stack.Screen name="GroupDetail" component={GroupDetailScreen} options={{ title: "Detalhes do Grupo" }} />
      <Stack.Screen name="GroupChat" component={GroupChatScreen} options={{ title: "Chat do Grupo" }} />
    </Stack.Navigator>
  );
}

/* ===========================
   RUNS STACK
   =========================== */
function RunsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: WayperTheme.colors.background },
        headerTintColor: WayperTheme.colors.text,
        headerTitleStyle: { fontWeight: "900", fontSize: 20 },
      }}
    >
      <Stack.Screen name="CorridasHome" component={CorridasScreen} options={{ title: "Corridas" }} />
      <Stack.Screen name="RunDetail" component={RunDetailScreen} options={{ title: "Detalhes da Corrida" }} />
      <Stack.Screen name="ZoneDetail" component={ZoneDetailScreen} options={{ title: "Detalhes da Zona" }} />
    </Stack.Navigator>
  );
}

/* ===========================
   HOME STACK
   =========================== */
function HomeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: WayperTheme.colors.background },
        headerTintColor: WayperTheme.colors.text,
        headerTitleStyle: { fontWeight: "900", fontSize: 20 },
      }}
    >
      <Stack.Screen name="InicioHome" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="ActivityDetail"
        component={RunDetailScreen}
        options={{ title: "Detalhes da atividade" }}
      />
    </Stack.Navigator>
  );
}

function SettingsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: WayperTheme.colors.background },
        headerTintColor: WayperTheme.colors.text,
        headerTitleStyle: { fontWeight: "900", fontSize: 20 },
      }}
    >
      <Stack.Screen name="SettingsHome" component={SettingsScreen} options={{ title: "Configuracoes" }} />
      <Stack.Screen name="Diagnostico" component={DiagnosticsScreen} options={{ title: "Diagnostico" }} />
    </Stack.Navigator>
  );
}

/* ===========================
   MAIN NAVIGATOR
   =========================== */
export default function MainNavigator() {
  const [userData, setUserData] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [initialRouteName, setInitialRouteName] = useState(null);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ===========================
  // LOAD USER DATA (SAFE)
  // ===========================
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setUserData(null);
      setLoadingUser(false);
      return undefined;
    }

    const unsubscribe = subscribeCurrentUserProfile((result) => {
      setUserData(result.data?.userDoc || result.data?.profile || null);
      setLoadingUser(false);

      if (result.error) {
        const code = String(result.error?.code || "");
        if (code !== "unavailable") {
          logger.warn(LOG_CATEGORIES.FIREBASE, "USER_PROFILE_LOAD_FAILED", {
            code,
            error: result.error,
          });
        }
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    let mounted = true;
    runLocalMigrationsOnce().catch((error) => {
      if (!mounted) return;
      logger.warn(LOG_CATEGORIES.STORAGE || LOG_CATEGORIES.SYNC, "LOCAL_STORAGE_MIGRATION_FAILED", {
        error,
      });
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const uid = auth.currentUser?.uid || "offline";
    Promise.all([
      activeRunTrackingService.hasActiveRunSnapshot?.().catch(() => false),
      findRecoverableRunForUser(uid, { reason: "initial_route" }).catch(() => null),
    ])
      .then(([hasActiveRun, recovery]) => {
        const hasLiveRecovery = recovery?.recoverable && isLiveRecovery(recovery);
        if (mounted) setInitialRouteName(hasActiveRun || hasLiveRecovery ? "Mapa" : "Inicio");
      })
      .catch(() => {
        if (mounted) setInitialRouteName("Inicio");
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    hasCompletedOnboarding()
      .then((completed) => {
        if (!mounted) return;
        setShowOnboarding(!completed);
      })
      .catch(() => {
        if (mounted) setShowOnboarding(false);
      })
      .finally(() => {
        if (mounted) setCheckingOnboarding(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // ===========================
  // START BACKGROUND SYNC
  // ===========================
  useEffect(() => {
    if (!userData) return;

    runSyncQueueRepository.startAutoSync?.().catch((e) => {
      logger.warn(LOG_CATEGORIES.SYNC, "START_AUTO_SYNC_FAILED", { error: e });
    });
  }, [userData]);

  // ===========================
  // LOGOUT
  // ===========================
  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (e) {
      logger.warn(LOG_CATEGORIES.FIREBASE, "SIGN_OUT_FAILED", { error: e });
    }
  }

  // ===========================
  // LOADING
  // ===========================
  if (loadingUser || !initialRouteName || checkingOnboarding) {
    return (
      <View style={styles.loadingScreen}>
        <LinearGradient
          colors={[
            "rgba(0, 230, 118, 0.18)",
            "rgba(56, 217, 255, 0.08)",
            "transparent",
          ]}
          style={styles.loadingGlow}
        />

        <View style={styles.loadingCard}>
          <View style={styles.loadingLogoFrame}>
            <Image source={BRAND_LOGO} style={styles.loadingLogo} resizeMode="contain" />
          </View>

          <Text style={styles.loadingTitle}>Preparando seu Wayper</Text>
          <Text style={styles.loadingMessage}>
            Estamos carregando seu perfil, corridas e mapa. Isso leva so alguns segundos.
          </Text>

          <View style={styles.loadingStatusPill}>
            <ActivityIndicator size="small" color={WayperTheme.colors.primary} />
            <Text style={styles.loadingStatusText}>Sincronizando dados</Text>
          </View>
        </View>
      </View>
    );
  }

  if (showOnboarding && initialRouteName !== "Mapa") {
    return <OnboardingScreen onComplete={() => setShowOnboarding(false)} />;
  }

  // ===========================
  // UI
  // ===========================
  return (
    <Drawer.Navigator
      initialRouteName={initialRouteName}
      screenOptions={({ navigation }) => ({
        headerShown: true,
        headerStyle: { backgroundColor: WayperTheme.colors.background, height: 102 },
        headerShadowVisible: false,
        headerBackground: () => (
          <LinearGradient
            colors={[WayperTheme.colors.background, WayperTheme.colors.backgroundAlt]}
            style={StyleSheet.absoluteFill}
          />
        ),
        headerTintColor: WayperTheme.colors.text,
        headerLeftContainerStyle: { paddingLeft: 10 },
        headerTitleContainerStyle: { marginLeft: 18 },
        headerLeft: () => (
          <Pressable style={styles.headerMenu} onPress={() => navigation.openDrawer()}>
            <Ionicons name="menu" size={28} color={WayperTheme.colors.text} />
          </Pressable>
        ),
        headerTitle: ({ children }) => <HeaderTitle title={children} />,
        headerTitleStyle: { fontWeight: "900", fontSize: 22 },
        drawerStyle: { backgroundColor: WayperTheme.colors.background, width: 315 },
        drawerType: "front",
        overlayColor: "rgba(3, 7, 11, 0.58)",
        drawerInactiveTintColor: WayperTheme.colors.textMuted,
        drawerActiveTintColor: WayperTheme.colors.primary,
        drawerLabelStyle: { fontSize: 16, fontWeight: "700" },
      })}
      drawerContent={(props) => (
        <CustomDrawer {...props} user={userData} onSignOut={handleLogout} />
      )}
    >
      <Drawer.Screen name="Inicio" component={HomeStack} options={{ title: "Início", headerShown: false }} />
      <Drawer.Screen name="Mapa" component={MapScreen} options={{ title: "Mapa" }} />
      <Drawer.Screen name="Corridas" component={RunsStack} options={{ title: "Corridas" }} />
      <Drawer.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Drawer.Screen name="Perfil" component={ProfileScreen} options={{ title: "Meu Perfil" }} />
      <Drawer.Screen name="Ranking" component={RankingScreen} options={{ title: "Ranking" }} />
      <Drawer.Screen name="Amigos" component={FriendsStack} options={{ title: "Amigos" }} />
      <Drawer.Screen name="Grupos" component={GroupStack} options={{ title: "Grupos" }} />
      <Drawer.Screen name="Configuracoes" component={SettingsStack} options={{ title: "Configuracoes" }} />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: WayperTheme.colors.background,
    padding: WayperTheme.spacing.page,
    overflow: "hidden",
  },
  loadingGlow: {
    position: "absolute",
    width: 340,
    height: 340,
    borderRadius: 170,
    top: "24%",
    opacity: 0.78,
  },
  loadingCard: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    paddingVertical: WayperTheme.spacing.xxl,
    paddingHorizontal: WayperTheme.spacing.xl,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    ...WayperTheme.shadows.card,
  },
  loadingLogoFrame: {
    width: 122,
    height: 122,
    borderRadius: WayperTheme.radius.xxl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    marginBottom: WayperTheme.spacing.lg,
  },
  loadingLogo: {
    width: 96,
    height: 96,
    borderRadius: 22,
  },
  loadingTitle: {
    color: WayperTheme.colors.text,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: WayperTheme.spacing.sm,
  },
  loadingMessage: {
    color: WayperTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: WayperTheme.spacing.xl,
  },
  loadingStatusPill: {
    minHeight: 46,
    paddingHorizontal: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  loadingStatusText: {
    color: WayperTheme.colors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  headerTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerMenu: {
    width: 62,
    height: 62,
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
    elevation: 7,
  },
  headerLogo: {
    width: 48,
    height: 42,
    borderRadius: 10,
  },
  headerBrand: {
    color: WayperTheme.colors.text,
    fontSize: 27,
    fontWeight: "900",
  },
  headerDivider: {
    width: 1,
    height: 34,
    backgroundColor: WayperTheme.colors.borderStrong,
    marginHorizontal: 12,
  },
  headerText: {
    color: WayperTheme.colors.primary,
    fontSize: 24,
    fontWeight: "900",
  },
});
