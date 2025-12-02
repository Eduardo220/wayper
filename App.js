// APP.JS — WAYPER ULTIMATE PRO VERSION
import "react-native-reanimated";
import React, { useEffect, useState } from "react";
import { LogBox } from "react-native";
import * as FileSystem from "expo-file-system";

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./src/firebaseConfig";

import LoginScreen from "./src/screens/Auth/LoginScreen";
import RegisterScreen from "./src/screens/Auth/RegisterScreen";
import MainNavigator from "./src/navigation/MainNavigator";

// === Sync (Ultimate Pro Sync) === //
import * as Sync from "./src/utils/sync";

// ===========================================
//  OPTIONAL SENTRY INIT (auto-detect)
// ===========================================
let Sentry = null;
try {
  // eslint-disable-next-line global-require
  Sentry = require("@sentry/react-native");
  if (Sentry && Sentry.init) {
    Sentry.init({
      dsn: "YOUR_DSN_HERE", // Troque para seu DSN real
      tracesSampleRate: 1.0,
      environment: "production",
    });
  }
} catch (e) {
  Sentry = null;
}

// ===========================================
//  CONFIG
// ===========================================
LogBox.ignoreAllLogs(); // ignora warns irrelevantes
const Stack = createNativeStackNavigator();
const USE_AUTH = true;
const logFile = FileSystem.documentDirectory + "wayper_errors.txt";

// ===========================================
//  APP COMPONENT
// ===========================================
export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  /* ----------------------------------
     Init Background Sync (ONE TIME)
  ----------------------------------- */
  useEffect(() => {
    let mounted = true;

    async function initBackground() {
      try {
        await Sync.registerBackgroundSyncTask(15 * 60); // 15min
        if (Sentry) {
          Sentry.addBreadcrumb({
            message: "Background Sync Registered",
            level: "info",
          });
        } else {
          console.log("Background Sync Registered.");
        }
      } catch (e) {
        console.error("registerBackgroundSyncTask failed:", e);
      }
    }

    initBackground();

    return () => {
      mounted = false;
    };
  }, []);

  /* ----------------------------------
     LISTEN AUTH
  ----------------------------------- */
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

  /* ----------------------------------
     AVOID WHITE FLASH BEFORE AUTH READY
  ----------------------------------- */
  if (!authChecked) return null;

  /* ----------------------------------
     UI
  ----------------------------------- */
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* sem login obrigatório */}
        {!USE_AUTH && (
          <Stack.Screen name="Main" component={MainNavigator} />
        )}

        {/* logado */}
        {USE_AUTH && user && (
          <Stack.Screen name="Main" component={MainNavigator} />
        )}

        {/* deslogado */}
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

/* ============================================================
   LOG DE ERROS EM ARQUIVO (EVOLUÍDO)
   ============================================================ */
async function saveErrorToFile(prefix, err, info) {
  try {
    const timestamp = new Date().toISOString();
    const msg =
      `\n\n[${timestamp}] ${prefix}\n` +
      `ERROR: ${err?.toString?.()}\n` +
      `STACK: ${err?.stack || "no stack"}\n` +
      (info ? `INFO: ${JSON.stringify(info)}\n` : "");

    await FileSystem.writeAsStringAsync(logFile, msg, {
      encoding: FileSystem.Encoding.UTF8,
      append: true,
    });
  } catch (e) {
    console.log("Falha ao salvar log:", e);
  }
}

export async function getErrorLogFile() {
  return logFile;
}

/* ============================================================
   GLOBAL ERROR HANDLERS (JS + PROMISES)
   ============================================================ */
const originalHandler = ErrorUtils.getGlobalHandler();

ErrorUtils.setGlobalHandler((err, isFatal) => {
  saveErrorToFile("GLOBAL_ERROR", err, { isFatal });

  if (originalHandler) originalHandler(err, isFatal);

  if (Sentry && Sentry.captureException) {
    Sentry.captureException(err, { extra: { isFatal } });
  }
});

globalThis.onunhandledrejection = (event) => {
  saveErrorToFile("UNHANDLED_PROMISE", event.reason);

  if (Sentry && Sentry.captureException) {
    Sentry.captureException(event.reason, {
      extra: { type: "UNHANDLED_PROMISE" },
    });
  }
};
