// APP.JS — WAYPER PRO EDITION (Optimized, Clean, Stable)
import "react-native-reanimated";

import React, { useEffect, useState, useRef } from "react";
import { LogBox, AppState } from "react-native";
import * as FileSystem from "expo-file-system";

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

// Screens
import LoginScreen from "./src/screens/Auth/LoginScreen";
import RegisterScreen from "./src/screens/Auth/RegisterScreen";
import MainNavigator from "./src/navigation/MainNavigator";

// Utilities
import * as Sync from "./src/utils/sync";

// ===============================
//  SENTRY WRAPPED + SAFE INIT
// ===============================
let Sentry = null;
try {
  Sentry = require("@sentry/react-native");
  Sentry?.init?.({
    dsn: "YOUR_DSN_HERE",
    tracesSampleRate: 1.0,
    environment: "production",
  });
} catch {
  Sentry = null;
}

// ===============================
//  REACT-QUERY + ASYNC STORAGE PERSIST
// ===============================
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";

// Presence Hook
import usePresence from "./src/hooks/usePresence";

// Ignore all warnings for production smoothness
LogBox.ignoreAllLogs();

const Stack = createNativeStackNavigator();
const USE_AUTH = true;
const LOG_FILE = FileSystem.documentDirectory + "wayper_errors.txt";

// ===============================
// QUERY CLIENT (Optimized)
// ===============================
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnReconnect: "always",
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

// Persist React Query cache
const persister = createAsyncStoragePersister({ storage: AsyncStorage });

persistQueryClient({
  queryClient,
  persister,
});

// ===============================
// APP (PRO VERSION)
// ===============================
export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const appState = useRef(AppState.currentState);

  // Presence system – reacts to user ID
  usePresence(user);

  // ============================
  // BACKGROUND SYNC
  // ============================
  useEffect(() => {
    async function init() {
      try {
        await Sync.registerBackgroundSyncTask(15 * 60);
        Sentry?.addBreadcrumb?.({
          message: "Background Sync Registered",
          level: "info",
        });
      } catch (e) {
        console.error("Background sync failed:", e);
      }
    }

    init();
  }, []);

  // ============================
  // AUTH STATE LISTENER
  // ============================
  useEffect(() => {
    if (!USE_AUTH) {
      setAuthChecked(true);
      return;
    }

    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser || null);
      setAuthChecked(true);
    });

    return unsub;
  }, []);

  // ============================
  // Avoid white flash — wait until auth is checked
  // ============================
  if (!authChecked) return null;

  // ============================
  // UI
  // ============================
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!USE_AUTH && <Stack.Screen name="Main" component={MainNavigator} />}

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

// =======================================================================
// ADVANCED ERROR LOGGING SYSTEM
// =======================================================================
async function saveErrorToFile(prefix, err, info) {
  try {
    const timestamp = new Date().toISOString();

    const msg =
      `\n\n[${timestamp}] ${prefix}\n` +
      `ERROR: ${err?.toString?.()}\n` +
      `STACK: ${err?.stack || "no stack"}\n` +
      (info ? `INFO: ${JSON.stringify(info)}\n` : "");

    await FileSystem.writeAsStringAsync(LOG_FILE, msg, {
      encoding: FileSystem.Encoding.UTF8,
      append: true,
    });
  } catch (e) {
    console.log("Falha ao salvar log:", e);
  }
}

export async function getErrorLogFile() {
  return LOG_FILE;
}

// =======================================================================
// GLOBAL JS ERROR HANDLERS (SAFE + SENTRY)
// =======================================================================
const originalHandler = ErrorUtils.getGlobalHandler();

ErrorUtils.setGlobalHandler((err, isFatal) => {
  saveErrorToFile("GLOBAL_ERROR", err, { isFatal });

  originalHandler?.(err, isFatal);

  Sentry?.captureException?.(err, { extra: { isFatal } });
});

globalThis.onunhandledrejection = (event) => {
  saveErrorToFile("UNHANDLED_PROMISE", event.reason);

  Sentry?.captureException?.(event.reason, {
    extra: { type: "UNHANDLED_PROMISE" },
  });
};
