import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../theme/wayperTheme";
import activeRunTrackingService from "../services/runTracking/activeRunTrackingService.js";
import {
  clearLogs,
  getLogs,
} from "../services/diagnostics/logStorageService.js";
import {
  exportDiagnosticsBundle,
  summarizeRunSnapshot,
} from "../services/diagnostics/runDiagnosticsService.js";
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

  const filters = useMemo(() => ({
    limit: 150,
    level: levelFilter === "ALL" ? undefined : levelFilter,
    category: categoryFilter === "ALL" ? undefined : categoryFilter,
  }), [categoryFilter, levelFilter]);

  const refresh = useCallback(async () => {
    const [snapshot, recentLogs] = await Promise.all([
      activeRunTrackingService.getActiveRunSnapshot?.().catch(() => null),
      getLogs(filters).catch(() => []),
    ]);
    setActiveRun(snapshot || null);
    setRuntime(activeRunTrackingService.getTrackingRuntimeStatus?.() || {});
    setLogs(recentLogs.slice(-150).reverse());
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

  const copyBundle = useCallback(async () => {
    setBusyAction("copy");
    try {
      const bundle = await exportDiagnosticsBundle({ limit: 300 });
      await Clipboard.setStringAsync(JSON.stringify(bundle, null, 2));
      Alert.alert("Diagnostico copiado", "O JSON de diagnostico foi copiado para a area de transferencia.");
    } catch {
      Alert.alert("Diagnostico", "Nao foi possivel copiar os logs.");
    } finally {
      setBusyAction(null);
    }
  }, []);

  const exportBundle = useCallback(async () => {
    setBusyAction("export");
    try {
      const bundle = await exportDiagnosticsBundle({ limit: 500 });
      const json = JSON.stringify(bundle, null, 2);
      const fileName = "wayper-last-run-diagnostics.json";
      const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory || "";
      if (!baseDir || typeof FileSystem.writeAsStringAsync !== "function") {
        await Clipboard.setStringAsync(json);
        Alert.alert("Diagnostico copiado", "Arquivo indisponivel; o JSON foi copiado.");
        return;
      }
      const uri = `${baseDir}${fileName}`;

      await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/json",
          dialogTitle: "Exportar diagnostico Wayper",
        });
      } else {
        await Clipboard.setStringAsync(json);
        Alert.alert("Diagnostico copiado", "Compartilhamento indisponivel; o JSON foi copiado.");
      }
    } catch {
      Alert.alert("Diagnostico", "Nao foi possivel exportar os logs.");
    } finally {
      setBusyAction(null);
    }
  }, []);

  const clearAllLogs = useCallback(async () => {
    setBusyAction("clear");
    try {
      await clearLogs();
      await refresh();
    } finally {
      setBusyAction(null);
    }
  }, [refresh]);

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
        <StatRow
          label="last point"
          value={lastPoint ? `${formatNumber(lastPoint.latitude, 3)}, ${formatNumber(lastPoint.longitude, 3)}` : "-"}
        />
        <StatRow label="last local save" value={activeRun?.lastUpdatedAt || activeRun?.checkpointAt || "-"} />
        <StatRow label="watcher" value={runtime.watcherStatus || "-"} />
        <StatRow label="background task" value={runtime.taskName || "-"} />
        <StatRow label="appState" value={appState || "-"} />
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton} onPress={copyBundle} disabled={Boolean(busyAction)}>
          <Ionicons name="copy-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.actionText}>{busyAction === "copy" ? "Copiando" : "Copiar"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={exportBundle} disabled={Boolean(busyAction)}>
          <Ionicons name="share-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.actionText}>{busyAction === "export" ? "Exportando" : "Exportar JSON"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.clearButton]} onPress={clearAllLogs} disabled={Boolean(busyAction)}>
          <Ionicons name="trash-outline" size={18} color={WayperTheme.colors.text} />
          <Text style={[styles.actionText, styles.clearText]}>{busyAction === "clear" ? "Limpando" : "Limpar"}</Text>
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
    flexDirection: "row",
    flexWrap: "wrap",
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
    color: WayperTheme.colors.textInverse,
    fontSize: 13,
    fontWeight: "900",
  },
  clearText: {
    color: WayperTheme.colors.text,
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
