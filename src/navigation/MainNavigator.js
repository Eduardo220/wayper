// MAIN NAVIGATOR — WAYPER (STABLE, OFFLINE-SAFE)

import React, { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";

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

// CLANS
import ClansScreen from "../screens/Clan/ClansScreen";
import ClanDetailScreen from "../screens/Clan/ClanDetailScreen";
import ClanChatScreen from "../screens/Clan/ClanChatScreen";

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
   CLAN STACK
   =========================== */
function ClanStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#0d0f12" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "900", fontSize: 20 },
      }}
    >
      <Stack.Screen name="ClansHome" component={ClansScreen} options={{ title: "Clãs" }} />
      <Stack.Screen name="ClanDetail" component={ClanDetailScreen} options={{ title: "Detalhes do Clã" }} />
      <Stack.Screen name="ClanChat" component={ClanChatScreen} options={{ title: "Chat do Clã" }} />
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
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#0b0d10",
        }}
      >
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
      <Drawer.Screen name="Clãs" component={ClanStack} options={{ title: "Clãs" }} />
    </Drawer.Navigator>
  );
}
