import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./src/firebaseConfig";

import HomeScreen from "./src/screens/HomeScreen";
import LoginScreen from "./src/screens/LoginScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import RankingScreen from "./src/screens/RankingScreen";
import FriendsScreen from "./src/screens/FriendsScreen";
import ClubsScreen from "./src/screens/ClubScreen"; // Corrigido para bater com o import
import CustomDrawer from "./src/components/CustomDrawer";

const Stack = createNativeStackNavigator();
const Drawer = createDrawerNavigator();

// 👇 Alternar pra true quando quiser exigir login
const USE_AUTH = false;

function DrawerRoutes() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawer {...props} />}
      screenOptions={{
        headerShown: true,
        drawerType: "slide",
        drawerActiveTintColor: "#00b894",
        drawerStyle: { backgroundColor: "#f9f9f9", width: 250 },
      }}
      initialRouteName="Mapa" // 🔹 Tela inicial do Drawer
    >
      <Drawer.Screen name="Mapa" component={HomeScreen} />
      <Drawer.Screen name="Perfil" component={ProfileScreen} />
      <Drawer.Screen name="Ranking" component={RankingScreen} />
      <Drawer.Screen name="Amigos" component={FriendsScreen} />
      <Drawer.Screen name="Clubes" component={ClubsScreen} />
    </Drawer.Navigator>
  );
}

export default function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!USE_AUTH) return;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
    });
    return unsubscribe;
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName={!USE_AUTH ? "Main" : user ? "Main" : "Login"} // 🔹 Define rota inicial
      >
        {!USE_AUTH ? (
          <Stack.Screen name="Main" component={DrawerRoutes} />
        ) : user ? (
          <Stack.Screen name="Main" component={DrawerRoutes} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
