import "react-native-reanimated";
import React, { useEffect, useState } from "react";

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./src/firebaseConfig";

import LoginScreen from "./src/screens/Auth/LoginScreen";
import RegisterScreen from "./src/screens/Auth/RegisterScreen";
import MainNavigator from "./src/navigation/MainNavigator";

import { LogBox } from "react-native";
import * as FileSystem from "expo-file-system";

// evita o Metro ficar espumando alerta inútil
LogBox.ignoreAllLogs();

const Stack = createNativeStackNavigator();
const logFile = FileSystem.documentDirectory + "wayper_errors.txt";

// muda pra false se quiser ignorar login
const USE_AUTH = true;

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // escuta login/logout
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

  // evita piscada branca enquanto verifica auth
  if (!authChecked) return null;

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
   LOG DE ERROS EM ARQUIVO (bom pra debugar no Android real)
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
   HANDLERS GLOBAIS (JS + Promises)
   ============================================================ */

const originalHandler = ErrorUtils.getGlobalHandler();

ErrorUtils.setGlobalHandler((err, isFatal) => {
  saveErrorToFile("GLOBAL_ERROR", err, { isFatal });

  if (originalHandler) originalHandler(err, isFatal);
});

globalThis.onunhandledrejection = (event) => {
  saveErrorToFile("UNHANDLED_PROMISE", event.reason);
};
