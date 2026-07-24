// APP.JS — WAYPER (CLEAN, STABLE, SEM FIRULA)

import "react-native-reanimated";
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from "react-native-reanimated";

import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Image, StyleSheet, Text, Linking } from "react-native";
import ErrorBoundary from "./src/components/ErrorBoundary";
import {
  installGlobalRunErrorHandlers,
  startActiveRunAutoCheckpointing,
  stopActiveRunAutoCheckpointing,
} from "./src/services/run/runAutoSaveService.js";
import { installGlobalErrorReporter } from "./src/services/diagnostics/errorReporter.js";
import {
  startPerformanceDiagnostics,
  stopPerformanceDiagnostics,
} from "./src/services/diagnostics/performanceDiagnosticsService.js";
import { initializeDiagnosticsPreferences } from "./src/services/diagnostics/diagnosticsPreferencesService.js";
import {
  finishAppStartSpan,
  initializeMonitoring,
  setMonitoringAuthState,
  setMonitoringScreen,
  setMonitoringUser,
  wrapWithMonitoring,
} from "./src/services/monitoring/sentryService.js";
import logger, { LOG_CATEGORIES } from "./src/utils/logger.js";
import {
  startRunNotificationCoordinator,
  stopRunNotificationCoordinator,
} from "./src/services/run/runNotificationService.js";
import {
  flushPendingNavigation,
  handleNavigationUrl,
  navigationRef,
} from "./src/navigation/rootNavigation.js";

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

const Stack = createNativeStackNavigator();
const USE_AUTH = true;
const BRAND_LOGO = require("./assets/logo.png");

initializeMonitoring();

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
function App() {
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
        setMonitoringAuthState(firebaseUser ? "authenticated" : "anonymous");
        setMonitoringUser(firebaseUser || null);
        setAuthChecked(true);
      },
      (error) => {
        logger.error(LOG_CATEGORIES.FIREBASE, "AUTH_STATE_ERROR", { error });
        setUser(null);
        setMonitoringAuthState("anonymous");
        setMonitoringUser(null);
        setAuthChecked(true);
      }
    );

    return unsub;
  }, []);

  useEffect(() => {
    initializeDiagnosticsPreferences().catch(() => false);
    installGlobalRunErrorHandlers();
    installGlobalErrorReporter();
    startPerformanceDiagnostics();
    startActiveRunAutoCheckpointing();
    startRunNotificationCoordinator();
    return () => {
      stopRunNotificationCoordinator();
      stopActiveRunAutoCheckpointing();
      stopPerformanceDiagnostics();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    Linking.getInitialURL()
      .then((url) => {
        if (mounted) handleNavigationUrl(url);
      })
      .catch(() => {});

    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleNavigationUrl(url);
    });

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (!authChecked || !user) return;
    const handle = setTimeout(flushPendingNavigation, 0);
    return () => clearTimeout(handle);
  }, [authChecked, user]);

  useEffect(() => {
    if (authChecked) finishAppStartSpan("ready");
  }, [authChecked]);

  const syncMonitoringScreen = () => {
    const route = navigationRef.getCurrentRoute?.();
    if (route?.name) setMonitoringScreen(route.name);
  };

  // ============================
  // SPLASH / LOADING
  // ============================
  if (!authChecked) {
    return (
      <View style={styles.bootScreen}>
        <View style={styles.bootCard}>
          <Image source={BRAND_LOGO} style={styles.bootLogo} resizeMode="contain" />
          <Text style={styles.bootTitle}>Wayper</Text>
          <Text style={styles.bootMessage}>Conectando sua conta e preparando o app.</Text>
          <View style={styles.bootStatusPill}>
            <ActivityIndicator size="small" color={WayperTheme.colors.primary} />
            <Text style={styles.bootStatusText}>Carregando</Text>
          </View>
        </View>
      </View>
    );
  }

  // ============================
  // UI
  // ============================
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <NavigationContainer
          ref={navigationRef}
          onReady={() => {
            flushPendingNavigation();
            syncMonitoringScreen();
          }}
          onStateChange={syncMonitoringScreen}
        >
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
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

export default wrapWithMonitoring(App);

const styles = StyleSheet.create({
  bootScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.background,
    padding: WayperTheme.spacing.page,
  },
  bootCard: {
    width: "100%",
    maxWidth: 330,
    alignItems: "center",
    paddingVertical: WayperTheme.spacing.xxl,
    paddingHorizontal: WayperTheme.spacing.xl,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    ...WayperTheme.shadows.card,
  },
  bootLogo: {
    width: 124,
    height: 124,
    marginBottom: WayperTheme.spacing.lg,
    borderRadius: 28,
  },
  bootTitle: {
    color: WayperTheme.colors.text,
    fontSize: 30,
    fontWeight: "900",
    marginBottom: WayperTheme.spacing.sm,
  },
  bootMessage: {
    color: WayperTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: WayperTheme.spacing.xl,
  },
  bootStatusPill: {
    minHeight: 44,
    paddingHorizontal: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  bootStatusText: {
    color: WayperTheme.colors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
});
