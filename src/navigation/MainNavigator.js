import React, { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { createStackNavigator } from "@react-navigation/stack";

import MapScreen from "../screens/MapScreen";
import RankingScreen from "../screens/RankingScreen";

// FRIENDS
import FriendsScreen from "../screens/Friends/FriendsScreen";
import FriendProfileScreen from "../screens/Friends/FriendProfileScreen";
import FriendRunsScreen from "../screens/Friends/FriendRunsScreen";

// PERFIL
import ProfileScreen from "../screens/ProfileScreen";

// CLANS
import ClansScreen from "../screens/Clan/ClansScreen";
import ClanDetailScreen from "../screens/Clan/ClanDetailScreen";
import ClanChatScreen from "../screens/Clan/ClanChatScreen";

import CustomDrawer from "../components/CustomDrawer";
import { auth, db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigation } from "@react-navigation/native";

const Drawer = createDrawerNavigator();
const Stack = createStackNavigator();

/* -------------------------------
   FRIENDS STACK
-------------------------------- */
function FriendsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#0d0f12" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "900", fontSize: 20 },
        cardStyle: { backgroundColor: "#0b0d10" },
      }}
    >
      <Stack.Screen name="FriendsHome" component={FriendsScreen} options={{ title: "Amigos" }} />
      <Stack.Screen name="FriendProfile" component={FriendProfileScreen} options={{ title: "Perfil" }} />
      <Stack.Screen name="FriendRuns" component={FriendRunsScreen} options={{ title: "Atividades" }} />
    </Stack.Navigator>
  );
}

/* -------------------------------
   CLAN STACK
-------------------------------- */
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

/* -------------------------------
   MAIN NAV
-------------------------------- */
export default function MainNavigator() {
  const navigation = useNavigation();
  const [userData, setUserData] = useState(null);

  const handleLogout = async () => {
    try {
      await signOut(auth);

      navigation.reset({
        index: 0,
        routes: [{ name: "Login" }],
      });
    } catch (e) {
      console.log("Erro ao deslogar:", e);
    }
  };

  useEffect(() => {
    const loadUser = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) setUserData(snap.data());
    };

    loadUser();
  }, []);

  if (!userData) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0b0d10" }}>
        <ActivityIndicator size="large" color="#00e676" />
      </View>
    );
  }

  return (
    <Drawer.Navigator
      initialRouteName="Mapa"
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: "#0d0f12" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "900", fontSize: 22 },
        drawerStyle: { backgroundColor: "#0d0f12", width: 280 },
        drawerInactiveTintColor: "#9aa0a6",
        drawerActiveTintColor: "#00e676",
        drawerLabelStyle: { fontSize: 16, fontWeight: "700" },
      }}
      drawerContent={(props) => (
        <CustomDrawer {...props} user={userData} onSignOut={handleLogout} />
      )}
    >
      <Drawer.Screen name="Mapa" component={MapScreen} options={{ title: "Mapa" }} />
      <Drawer.Screen name="Perfil" component={ProfileScreen} options={{ title: "Meu Perfil" }} />
      <Drawer.Screen name="Ranking" component={RankingScreen} options={{ title: "Ranking" }} />
      <Drawer.Screen name="Amigos" component={FriendsStack} options={{ title: "Amigos" }} />
      <Drawer.Screen name="Clans" component={ClanStack} options={{ title: "Clãs" }} />
    </Drawer.Navigator>
  );
}
