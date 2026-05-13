// MAIN NAVIGATOR — WAYPER (STABLE, OFFLINE-SAFE)

import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Image, StyleSheet, Text } from "react-native";

import { createDrawerNavigator } from "@react-navigation/drawer";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

// FIREBASE
import { auth, db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";

// SCREENS
import MapScreen from "../screens/MapScreen";
import RankingScreen from "../screens/RankingScreen";
import ProfileScreen from "../screens/ProfileScreen";

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

// UI
import CustomDrawer from "../components/CustomDrawer";

// SYNC
import * as sync from "../utils/sync";

const Drawer = createDrawerNavigator();
const Stack = createNativeStackNavigator();
const BRAND_LOGO = require("../../assets/logo.png");

function HeaderTitle({ title }) {
  return (
    <View style={styles.headerTitle}>
      <Image source={BRAND_LOGO} style={styles.headerLogo} resizeMode="contain" />
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
        headerStyle: { backgroundColor: "#0d0f12" },
        headerTintColor: "#fff",
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
        headerStyle: { backgroundColor: "#0d0f12" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "900", fontSize: 20 },
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
        headerStyle: { backgroundColor: "#0d0f12" },
        headerTintColor: "#fff",
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
   MAIN NAVIGATOR
   =========================== */
export default function MainNavigator() {
  const [userData, setUserData] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // ===========================
  // LOAD USER DATA (SAFE)
  // ===========================
  useEffect(() => {
    const loadUser = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setLoadingUser(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", uid));
        setUserData(snap.exists() ? snap.data() : null);
      } catch (err) {
        console.log("Erro ao carregar usuário:", err);
        setUserData(null);
      } finally {
        setLoadingUser(false);
      }
    };

    loadUser();
  }, []);

  // ===========================
  // START BACKGROUND SYNC
  // ===========================
  useEffect(() => {
    if (!userData) return;

    try {
      if (typeof sync.startAutoSync === "function") {
        sync.startAutoSync();
      }
    } catch (e) {
      console.warn("startAutoSync failed:", e);
    }
  }, [userData]);

  // ===========================
  // LOGOUT
  // ===========================
  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (e) {
      console.log("Erro ao deslogar:", e);
    }
  }

  // ===========================
  // LOADING
  // ===========================
  if (loadingUser) {
    return (
      <View style={styles.loadingScreen}>
        <Image source={BRAND_LOGO} style={styles.loadingLogo} resizeMode="contain" />
        <ActivityIndicator size="large" color="#00e676" />
      </View>
    );
  }

  // ===========================
  // UI
  // ===========================
  return (
    <Drawer.Navigator
      initialRouteName="Mapa"
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: "#0d0f12" },
        headerTintColor: "#fff",
        headerTitle: ({ children }) => <HeaderTitle title={children} />,
        headerTitleStyle: { fontWeight: "900", fontSize: 22 },
        drawerStyle: { backgroundColor: "#0d0f12", width: 300 },
        drawerInactiveTintColor: "#9aa0a6",
        drawerActiveTintColor: "#00e676",
        drawerLabelStyle: { fontSize: 16, fontWeight: "700" },
      }}
      drawerContent={(props) => (
        <CustomDrawer {...props} user={userData} onSignOut={handleLogout} />
      )}
    >
      <Drawer.Screen name="Mapa" component={MapScreen} options={{ title: "Mapa" }} />
      <Drawer.Screen name="Corridas" component={RunsStack} options={{ title: "Corridas" }} />
      <Drawer.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Drawer.Screen name="Perfil" component={ProfileScreen} options={{ title: "Meu Perfil" }} />
      <Drawer.Screen name="Ranking" component={RankingScreen} options={{ title: "Ranking" }} />
      <Drawer.Screen name="Amigos" component={FriendsStack} options={{ title: "Amigos" }} />
      <Drawer.Screen name="Grupos" component={GroupStack} options={{ title: "Grupos" }} />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#05070a",
  },
  loadingLogo: {
    width: 120,
    height: 120,
    borderRadius: 26,
    marginBottom: 18,
  },
  headerTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerLogo: {
    width: 34,
    height: 34,
    borderRadius: 8,
  },
  headerText: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
  },
});
