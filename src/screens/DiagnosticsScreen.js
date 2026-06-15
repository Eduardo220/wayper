import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../theme/wayperTheme";
import activeRunTrackingService from "../services/runTracking/activeRunTrackingService.js";
import {
  clearOldLogs,
  getDiagnosticStorageHealth,
  getLogs,
} from "../services/diagnostics/logStorageService.js";
import {
  summarizeRunSnapshot,
} from "../services/diagnostics/runDiagnosticsService.js";
import {
  createDiagnosticsArchive,
  DIAGNOSTIC_EXPORT_SCOPE,
} from "../services/diagnostics/diagnosticExportService.js";
import {
  isDiagnosticUploadConfigured,
  uploadDiagnosticsArchive,
} from "../services/diagnostics/diagnosticUploadService.js";
import { getDiagnosticsConfig } from "../config/diagnosticsConfig.js";
import { setPreciseLocationDiagnosticsEnabled } from "../services/diagnostics/diagnosticsPreferencesService.js";
import {
  flushMonitoring,
  getMonitoringStatus,
  isMonitoringTestAvailable,
  sendMonitoringTestEvent,
} from "../services/monitoring/sentryService.js";
import { LOG_CATEGORIES } from "../utils/logger.js";

const LEVELS = ["ALL", "debug", "info", "warn", "error", "fatal"];
const CATEGORIES = ["ALL", ...Object.values(LOG_CATEGORIES)];

function formatNumber(value, decimals = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toFixed(decimals);
}

function getLastPoint(snapshot = {}) {
  const points = snapshot.trustedPath || snapshot.points || snapshot.path || [];
  return Array.isArray(points) ? points[points.length - 1] || null : null;
}

function StatRow({ label, value }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value ?? "-"}</Text>
    </View>
  );
}

function FilterChip({ active, label, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      style={[styles.filterChip, active && styles.filterChipActive]}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function DiagnosticsScreen() {
  const [loading, setLoading] = useState(true);
  const [activeRun, setActiveRun] = useState(null);
  const [runtime, setRuntime] = useState({});
  const [logs, setLogs] = useState([]);
  const [levelFilter, setLevelFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [appState, setAppState] = useState(AppState.currentState);
  const [busyAction, setBusyAction] = useState(null);
  const [diagnosticStorage, setDiagnosticStorage] = useState({});
  const [preciseLocationEnabled, setPreciseLocationEnabled] = useState(
    getDiagnosticsConfig().allowPreciseLocationLogs === true
  );
  const [monitoringStatus, setMonitoringStatus] = useState(getMonitoringStatus());

  const filters = useMemo(() => ({
    limit: 150,
    level: levelFilter === "ALL" ? undefined : levelFilter,
    category: categoryFilter === "ALL" ? undefined : categoryFilter,
  }), [categoryFilter, levelFilter]);

  const refresh = useCallback(async () => {
    const [snapshot, recentLogs, storageHealth] = await Promise.all([
      activeRunTrackingService.getActiveRunSnapshot?.().catch(() => null),
      getLogs(filters).catch(() => []),
      getDiagnosticStorageHealth().catch(() => ({})),
    ]);
    setActiveRun(snapshot || null);
    setRuntime(activeRunTrackingService.getTrackingRuntimeStatus?.() || {});
    setLogs(recentLogs.slice(-150).reverse());
    setDiagnosticStorage(storageHealth);
    setMonitoringStatus(getMonitoringStatus());
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1500);
    const sub = AppState.addEventListener("change", setAppState);
    return () => {
      clearInterval(timer);
      sub?.remove?.();
    };
  }, [refresh]);

  const summary = summarizeRunSnapshot(activeRun || {}, {
    appState,
    watcherStatus: runtime.watcherStatus,
    backgroundTaskStatus: runtime.taskName,
  });
  const lastPoint = getLastPoint(activeRun || {});

  const exportArchive = useCallback(async (scope, actionName) => {
    setBusyAction(actionName);
    try {
      const archive = await createDiagnosticsArchive({ scope });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(archive.uri, {
          mimeType: "application/zip",
          dialogTitle: "Exportar diagnostico Wayper",
        });
      } else {
        Alert.alert("Diagnostico salvo", `Arquivo criado em:\n${archive.uri}`);
      }
    } catch (error) {
      Alert.alert("Diagnostico", `Nao foi possivel exportar os logs.\n${error?.message || ""}`);
    } finally {
      setBusyAction(null);
    }
  }, []);

  const clearExpiredLogs = useCallback(async () => {
    setBusyAction("clear");
    try {
      const result = await clearOldLogs({ maxAgeDays: 14, keepRecentRuns: 3 });
      await refresh();
      Alert.alert("Logs antigos", `${result.removed || 0} conjunto(s) removido(s).`);
    } finally {
      setBusyAction(null);
    }
  }, [refresh]);

  const sendLastRun = useCallback(async () => {
    if (!isDiagnosticUploadConfigured()) {
      Alert.alert(
        "Envio nao configurado",
        "O backend de diagnostico nao esta habilitado. A exportacao local continua disponivel."
      );
      return;
    }
    setBusyAction("send");
    try {
      const archive = await createDiagnosticsArchive({ scope: DIAGNOSTIC_EXPORT_SCOPE.LAST_RUN });
      await uploadDiagnosticsArchive(archive);
      Alert.alert("Diagnostico enviado", "O arquivo foi enviado e o resumo foi registrado.");
    } catch (error) {
      Alert.alert("Falha no envio", error?.message || "Nao foi possivel enviar o diagnostico.");
    } finally {
      setBusyAction(null);
    }
  }, []);

  const updatePreciseLocation = useCallback((enabled) => {
    if (!enabled) {
      setPreciseLocationDiagnosticsEnabled(false)
        .then(setPreciseLocationEnabled)
        .catch(() => {});
      return;
    }
    Alert.alert(
      "Coordenadas exatas",
      "Ative somente para uma corrida de teste. O arquivo exportado podera revelar seu trajeto exato.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Ativar",
          onPress: () => {
            setPreciseLocationDiagnosticsEnabled(true)
              .then(setPreciseLocationEnabled)
              .catch(() => {});
          },
        },
      ]
    );
  }, []);

  const sendSentryTest = useCallback(async () => {
    setBusyAction("sentry-test");
    try {
      const eventId = sendMonitoringTestEvent();
      if (!eventId) {
        Alert.alert("Sentry inativo", "Configure o DSN e habilite o ambiente para enviar o teste.");
        return;
      }
      const flushed = await flushMonitoring(2500);
      Alert.alert(
        "Evento de teste enviado",
        flushed
          ? `ID do evento: ${eventId}`
          : `Evento enfileirado: ${eventId}`
      );
    } finally {
      setBusyAction(null);
      setMonitoringStatus(getMonitoringStatus());
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={WayperTheme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Diagnostico</Text>
        <Text style={styles.subtitle}>Corrida ativa, recovery, storage, mapa e sync</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Corrida Ativa</Text>
        <StatRow label="runId" value={summary.runId || "-"} />
        <StatRow label="localRunId" value={summary.localRunId || "-"} />
        <StatRow label="status" value={summary.status || "IDLE"} />
        <StatRow label="segments" value={summary.segmentsCount} />
        <StatRow label="raw points" value={summary.rawPointsCount} />
        <StatRow label="trusted points" value={summary.trustedPointsCount} />
        <StatRow label="display points" value={summary.displayPointsCount} />
        <StatRow label="distance" value={`${formatNumber(summary.distance, 1)} m`} />
        <StatRow label="elapsed" value={`${Math.round(Number(summary.elapsedMs || 0) / 1000)} s`} />
        <StatRow label="last location" value={summary.lastLocationAt || "-"} />
        <StatRow label="last point accuracy" value={lastPoint ? `${formatNumber(lastPoint.accuracy, 1)} m` : "-"} />
        <StatRow label="last local save" value={activeRun?.lastUpdatedAt || activeRun?.checkpointAt || "-"} />
        <StatRow label="watcher" value={runtime.watcherStatus || "-"} />
        <StatRow label="background task" value={runtime.taskName || "-"} />
        <StatRow label="appState" value={appState || "-"} />
        <StatRow label="log backend" value={diagnosticStorage.backend || "-"} />
        <StatRow label="pending log buffer" value={diagnosticStorage.pendingLogs || 0} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Sentry</Text>
        <StatRow label="status" value={monitoringStatus.enabled ? "ativo" : "inativo"} />
        <StatRow label="ambiente" value={monitoringStatus.environment} />
        <StatRow label="DSN configurado" value={monitoringStatus.dsnConfigured ? "sim" : "nao"} />
        <StatRow label="release" value={monitoringStatus.release || "-"} />
        <StatRow label="dist" value={monitoringStatus.dist || "-"} />
        {isMonitoringTestAvailable() ? (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={sendSentryTest}
            disabled={Boolean(busyAction)}
          >
            <Ionicons name="bug-outline" size={18} color={WayperTheme.colors.textInverse} />
            <Text style={styles.actionText}>
              {busyAction === "sentry-test" ? "Enviando" : "Enviar erro de teste para Sentry"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.panel}>
        <View style={styles.preferenceRow}>
          <View style={styles.preferenceBody}>
            <Text style={styles.panelTitle}>Coordenadas exatas</Text>
            <Text style={styles.preferenceText}>Desligado por padrao. Ative antes de uma corrida de teste.</Text>
          </View>
          <Switch
            value={preciseLocationEnabled}
            onValueChange={updatePreciseLocation}
            trackColor={{
              false: WayperTheme.colors.surfaceSoft,
              true: WayperTheme.colors.primarySoft,
            }}
            thumbColor={preciseLocationEnabled ? WayperTheme.colors.primary : WayperTheme.colors.textMuted}
          />
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => exportArchive(DIAGNOSTIC_EXPORT_SCOPE.LAST_RUN, "last")}
          disabled={Boolean(busyAction)}
        >
          <Ionicons name="share-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.actionText}>{busyAction === "last" ? "Exportando" : "Exportar ultima corrida"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => exportArchive(DIAGNOSTIC_EXPORT_SCOPE.ACTIVE_RUN, "active")}
          disabled={Boolean(busyAction)}
        >
          <Ionicons name="share-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.actionText}>{busyAction === "active" ? "Exportando" : "Exportar corrida ativa"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => exportArchive(DIAGNOSTIC_EXPORT_SCOPE.RECENT, "recent")}
          disabled={Boolean(busyAction)}
        >
          <Ionicons name="albums-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.actionText}>{busyAction === "recent" ? "Exportando" : "Exportar logs recentes"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={sendLastRun} disabled={Boolean(busyAction)}>
          <Ionicons name="cloud-upload-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.actionText}>{busyAction === "send" ? "Enviando" : "Enviar ultima corrida"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.clearButton]} onPress={clearExpiredLogs} disabled={Boolean(busyAction)}>
          <Ionicons name="trash-outline" size={18} color={WayperTheme.colors.text} />
          <Text style={[styles.actionText, styles.clearText]}>{busyAction === "clear" ? "Limpando" : "Limpar logs antigos"}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Filtros</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {LEVELS.map((level) => (
            <FilterChip key={level} label={level} active={levelFilter === level} onPress={() => setLevelFilter(level)} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {CATEGORIES.map((category) => (
            <FilterChip
              key={category}
              label={category}
              active={categoryFilter === category}
              onPress={() => setCategoryFilter(category)}
            />
          ))}
        </ScrollView>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Ultimos Logs</Text>
        {logs.length === 0 ? (
          <Text style={styles.emptyText}>Nenhum log encontrado.</Text>
        ) : logs.map((log) => (
          <View key={log.id} style={styles.logRow}>
            <View style={styles.logHeader}>
              <Text style={[styles.logLevel, styles[`level_${log.level}`]]}>{log.level}</Text>
              <Text style={styles.logCategory}>{log.category}</Text>
            </View>
            <Text style={styles.logEvent}>{log.event}</Text>
            <Text style={styles.logTime}>{log.timestamp}</Text>
            {log.context?.reason ? <Text style={styles.logContext}>reason: {String(log.context.reason)}</Text> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
  },
  content: {
    padding: WayperTheme.spacing.lg,
    paddingBottom: WayperTheme.spacing.xxl,
    gap: WayperTheme.spacing.lg,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.background,
  },
  header: {
    gap: WayperTheme.spacing.xs,
  },
  title: {
    color: WayperTheme.colors.primary,
    fontSize: 30,
    fontWeight: "900",
  },
  subtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  panel: {
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    backgroundColor: WayperTheme.colors.surface,
    borderRadius: WayperTheme.radius.sm,
    padding: WayperTheme.spacing.lg,
    gap: WayperTheme.spacing.sm,
  },
  panelTitle: {
    color: WayperTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: WayperTheme.spacing.xs,
  },
  statRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: WayperTheme.spacing.md,
  },
  statLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },
  statValue: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "right",
  },
  actions: {
    flexDirection: "column",
    gap: WayperTheme.spacing.sm,
  },
  actionButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: WayperTheme.spacing.xs,
    paddingHorizontal: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.sm,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
  },
  clearButton: {
    backgroundColor: WayperTheme.colors.dangerSoft,
    borderColor: WayperTheme.colors.dangerBorder,
  },
  actionText: {
    flex: 1,
    color: WayperTheme.colors.textInverse,
    fontSize: 13,
    fontWeight: "900",
  },
  clearText: {
    color: WayperTheme.colors.text,
  },
  preferenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.md,
  },
  preferenceBody: {
    flex: 1,
    gap: WayperTheme.spacing.xs,
  },
  preferenceText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  filterRow: {
    gap: WayperTheme.spacing.sm,
    paddingVertical: WayperTheme.spacing.xs,
  },
  filterChip: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: WayperTheme.spacing.md,
    borderRadius: WayperTheme.radius.sm,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    backgroundColor: WayperTheme.colors.surfaceSoft,
  },
  filterChipActive: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primaryLight,
  },
  filterChipText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  filterChipTextActive: {
    color: WayperTheme.colors.textInverse,
  },
  emptyText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  logRow: {
    paddingVertical: WayperTheme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: WayperTheme.colors.border,
    gap: WayperTheme.spacing.xs,
  },
  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
  },
  logLevel: {
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  level_debug: { color: WayperTheme.colors.textSubtle },
  level_info: { color: WayperTheme.colors.cyan },
  level_warn: { color: WayperTheme.colors.warning },
  level_error: { color: WayperTheme.colors.danger },
  level_fatal: { color: WayperTheme.colors.danger },
  logCategory: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  logEvent: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  logTime: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: "700",
  },
  logContext: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
});
