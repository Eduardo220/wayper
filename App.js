// APP.JS — WAYPER (CLEAN, STABLE, SEM FIRULA)

import "react-native-reanimated";

import React, { useEffect, useState } from "react";
import { LogBox, View, ActivityIndicator } from "react-native";

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

// ===============================
// REACT QUERY
// ===============================
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ===============================
// CONFIG
// ===============================
LogBox.ignoreAllLogs();

const Stack = createNativeStackNavigator();
const USE_AUTH = true;

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
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
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
