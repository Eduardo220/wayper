// APP.JS — WAYPER (CLEAN, STABLE, SEM FIRULA)

import "react-native-reanimated";
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from "react-native-reanimated";

import React, { useEffect, useState } from "react";
import { LogBox, View, ActivityIndicator, Image, StyleSheet, Text } from "react-native";

// ===============================
// NAVIGATION
// ===============================
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

// ===============================
// FIREBASE AUTH
// ===============================
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./src/firebaseConfig";

// ===============================
// SCREENS
// ===============================
import LoginScreen from "./src/screens/Auth/LoginScreen";
import RegisterScreen from "./src/screens/Auth/RegisterScreen";
import MainNavigator from "./src/navigation/MainNavigator";
import { WayperTheme } from "./src/theme/wayperTheme";

// ===============================
// REACT QUERY
// ===============================
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ===============================
// CONFIG
// ===============================
configureReanimatedLogger({
  level: ReanimatedLogLevel.error,
  strict: false,
});

LogBox.ignoreAllLogs();

const Stack = createNativeStackNavigator();
const USE_AUTH = true;
const BRAND_LOGO = require("./assets/logo.png");

// ===============================
// QUERY CLIENT
// ===============================
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

// ===============================
// APP
// ===============================
export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // ============================
  // AUTH LISTENER (SAFE)
  // ============================
  useEffect(() => {
    if (!USE_AUTH) {
      setAuthChecked(true);
      return;
    }

    const unsub = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        setUser(firebaseUser || null);
        setAuthChecked(true);
      },
      (error) => {
        console.error("Auth error:", error);
        setUser(null);
        setAuthChecked(true);
      }
    );

    return unsub;
  }, []);

  // ============================
  // SPLASH / LOADING
  // ============================
  if (!authChecked) {
    return (
      <View style={styles.bootScreen}>
        <Image source={BRAND_LOGO} style={styles.bootLogo} resizeMode="contain" />
        <Text style={styles.bootTitle}>Wayper</Text>
        <ActivityIndicator size="large" color={WayperTheme.colors.primary} />
      </View>
    );
  }

  // ============================
  // UI
  // ============================
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!USE_AUTH && (
            <Stack.Screen name="Main" component={MainNavigator} />
          )}

          {USE_AUTH && user && (
            <Stack.Screen name="Main" component={MainNavigator} />
          )}

          {USE_AUTH && !user && (
            <>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Register" component={RegisterScreen} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  bootScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.background,
    padding: 24,
  },
  bootLogo: {
    width: 150,
    height: 150,
    marginBottom: 18,
    borderRadius: 32,
  },
  bootTitle: {
    color: WayperTheme.colors.text,
    fontSize: 30,
    fontWeight: "900",
    marginBottom: 24,
  },
});
