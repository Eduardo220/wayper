import "react-native-reanimated";
import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./src/firebaseConfig";
import RegisterScreen from "./src/screens/Auth/RegisterScreen";

import MapScreen from "./src/screens/MapScreen";
import LoginScreen from "./src/screens/Auth/LoginScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import RankingScreen from "./src/screens/RankingScreen";
import FriendsScreen from "./src/screens/FriendsScreen";
import ClubsScreen from "./src/screens/ClubScreen";
import CustomDrawer from "./src/components/CustomDrawer";

// NÃO DUPLICA IMPORT, PELO AMOR DO CÉREBRO
// import MapScreen from "./src/screens/MapScreen";

const Stack = createNativeStackNavigator();
const Drawer = createDrawerNavigator();

// alterna pra false quando quiser rodar sem login
const USE_AUTH = true;

function DrawerRoutes() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawer {...props} />}
      screenOptions={{
        headerShown: true,
        drawerType: "slide",
        drawerActiveTintColor: "#00b894",
        drawerStyle: { backgroundColor: "#f9f9f9", width: 250 }
      }}
      initialRouteName="Mapa"
    >
      <Drawer.Screen name="Mapa" component={MapScreen} />
      <Drawer.Screen name="Perfil" component={ProfileScreen} />
      <Drawer.Screen name="Ranking" component={RankingScreen} />
      <Drawer.Screen name="Amigos" component={FriendsScreen} />
      <Drawer.Screen name="Clubes" component={ClubsScreen} />
    </Drawer.Navigator>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // verifica login só uma vez
  useEffect(() => {
    if (!USE_AUTH) {
      setAuthChecked(true);
      return;
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthChecked(true);
    });

    return unsub;
  }, []);

  // evita piscar tela
  if (!authChecked) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        
        {/* sem login obrigatório */}
        {!USE_AUTH && (
          <Stack.Screen name="Main" component={DrawerRoutes} />
        )}

        {/* login obrigatório + logado */}
        {USE_AUTH && user && (
          <Stack.Screen name="Main" component={DrawerRoutes} />
        )}

        {/* login obrigatório + deslogado */}
        {USE_AUTH && !user && (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}

      </Stack.Navigator>
    </NavigationContainer>
  );
}
