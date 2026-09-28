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
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { WayperTheme } from "../theme/wayperTheme";
import activeRunTrackingService from "../services/runTracking/activeRunTrackingService.js";
import {
  clearOldLogs,
  flushLogs,
  getDiagnosticStorageHealth,
  getLogs,
} from "../services/diagnostics/logStorageService.js";
import {
  summarizeRunSnapshot,
} from "../services/diagnostics/runDiagnosticsService.js";
import {
  buildLocalDiagnosticsSummary,
  buildTechnicalSummaryText,
} from "../services/diagnostics/localDiagnosticsService.js";
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
import { openAppSettings } from "../services/permissions.js";
import { LOG_CATEGORIES } from "../utils/logger.js";

const LEVELS = ["ALL", "debug", "info", "warn", "error", "fatal"];
const CATEGORIES = ["ALL", ...Object.values(LOG_CATEGORIES)];

function formatNumber(value, decimals = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toFixed(decimals);
}

function formatBoolean(value) {
  if (value === true) return "sim";
  if (value === false) return "nao";
  return "-";
}

function formatMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "-";
  return `${Math.round(number / 1000)} s`;
}

function formatStatus(value) {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return formatBoolean(value);
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const status = value.status || value.state || value.permissionStatus || null;
    const granted = value.granted != null ? formatBoolean(value.granted) : null;
    const canAskAgain = value.canAskAgain === false ? "sem perguntar" : null;
    return [status, granted, canAskAgain].filter(Boolean).join(" / ") || JSON.stringify(value).slice(0, 80);
  }
  return String(value);
}

function formatTopReasons(value = {}) {
  const entries = Object.entries(value || {});
  if (entries.length === 0) return "-";
  return entries
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
    .slice(0, 3)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(", ");
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

function DiagnosticPanel({ title, children }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
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
  const [localDiagnostics, setLocalDiagnostics] = useState(null);
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
    const [snapshot, recentLogs, storageHealth, diagnosticsSummary] = await Promise.all([
      activeRunTrackingService.getActiveRunSnapshot?.().catch(() => null),
      getLogs(filters).catch(() => []),
      getDiagnosticStorageHealth().catch(() => ({})),
      buildLocalDiagnosticsSummary({ logsLimit: 150 }).catch((error) => ({
        activeRun: { ok: false, error: { message: error?.message || String(error) } },
      })),
    ]);
    setActiveRun(snapshot || null);
    setRuntime(activeRunTrackingService.getTrackingRuntimeStatus?.() || {});
    setLogs(recentLogs.slice(-150).reverse());
    setDiagnosticStorage(storageHealth);
    setLocalDiagnostics(diagnosticsSummary || null);
    setMonitoringStatus(getMonitoringStatus());
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
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
  const diagnostics = localDiagnostics || {};
  const activeSummary = diagnostics.activeRun || {};
  const gpsSummary = diagnostics.gpsTracking || {};
  const permissionsSummary = diagnostics.permissions || {};
  const storageSummary = diagnostics.storage || {};
  const syncSummary = diagnostics.sync || {};
  const deferredQueueSummary = syncSummary.deferredQueue || {};
  const notificationSummary = diagnostics.notificationBackground || {};
  const socialSummary = diagnostics.social || {};
  const shareSummary = diagnostics.share || {};
  const territorySummary = diagnostics.territory || {};
  const profileSummary = diagnostics.profileRankingXp || {};

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

  const copyTechnicalSummary = useCallback(async () => {
    setBusyAction("copy");
    try {
      const summaryText = buildTechnicalSummaryText(
        localDiagnostics || await buildLocalDiagnosticsSummary({ logsLimit: 150 })
      );
      await Clipboard.setStringAsync(summaryText);
      Alert.alert("Resumo copiado", "O resumo tecnico foi copiado para a area de transferencia.");
    } catch (error) {
      Alert.alert("Diagnostico", `Nao foi possivel copiar o resumo.\n${error?.message || ""}`);
    } finally {
      setBusyAction(null);
    }
  }, [localDiagnostics]);

  const forceFlushLogs = useCallback(async () => {
    setBusyAction("flush");
    try {
      await flushLogs();
      await refresh();
      Alert.alert("Logs", "Buffer de logs gravado.");
    } catch (error) {
      Alert.alert("Logs", `Nao foi possivel gravar os logs.\n${error?.message || ""}`);
    } finally {
      setBusyAction(null);
    }
  }, [refresh]);

  const retryPendingSync = useCallback(async () => {
    setBusyAction("sync");
    try {
      const repository = await import("../repositories/runSyncQueueRepository.js");
      const result = await repository.retry?.();
      await refresh();
      Alert.alert(
        "Sync pendente",
        result?.error
          ? `Tentativa concluida com erro: ${result.error?.message || result.error}`
          : "Tentativa de sync pendente agendada/executada."
      );
    } catch (error) {
      Alert.alert("Sync pendente", `Nao foi possivel tentar o sync.\n${error?.message || ""}`);
    } finally {
      setBusyAction(null);
    }
  }, [refresh]);

  const processDeferredQueue = useCallback(async () => {
    setBusyAction("deferred-queue");
    try {
      const repository = await import("../repositories/runDeferredTaskQueueRepository.js");
      const result = await repository.retry?.({ trigger: "diagnostics_manual", process: true });
      if (result?.error) throw result.error;
      await refresh();
      const resetCount = result?.data?.retry?.resetCount || 0;
      const processedCount = result?.data?.process?.processed?.length || 0;
      const failedCount = result?.data?.process?.failed?.length || 0;
      Alert.alert(
        "Fila pos-corrida",
        `Tarefas reativadas: ${resetCount}\nProcessadas agora: ${processedCount}\nFalhas nesta tentativa: ${failedCount}`
      );
    } catch (error) {
      Alert.alert("Fila pos-corrida", `Nao foi possivel processar a fila.\n${error?.message || ""}`);
    } finally {
      setBusyAction(null);
    }
  }, [refresh]);

  const checkPermissions = useCallback(async () => {
    setBusyAction("permissions");
    try {
      await refresh();
      Alert.alert("Permissoes", "Resumo de permissoes atualizado.");
    } finally {
      setBusyAction(null);
    }
  }, [refresh]);

  const clearExpiredLogs = useCallback(() => {
    Alert.alert(
      "Limpar logs antigos",
      "Remove apenas pacotes de logs antigos, mantendo corridas e dados locais. Esta acao nao limpa historico de corridas.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Limpar",
          style: "destructive",
          onPress: async () => {
            setBusyAction("clear");
            try {
              const result = await clearOldLogs({ maxAgeDays: 14, keepRecentRuns: 3 });
              await refresh();
              Alert.alert("Logs antigos", `${result.removed || 0} conjunto(s) removido(s).`);
            } finally {
              setBusyAction(null);
            }
          },
        },
      ]
    );
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

      <DiagnosticPanel title="Corrida Ativa">
        <StatRow label="existe" value={formatBoolean(activeSummary.exists ?? Boolean(summary.runId))} />
        <StatRow label="status" value={activeSummary.status || summary.status || "IDLE"} />
        <StatRow label="runId" value={activeSummary.runId || summary.runId || "-"} />
        <StatRow label="localRunId" value={activeSummary.localRunId || summary.localRunId || "-"} />
        <StatRow label="inicio" value={activeSummary.startedAt || "-"} />
        <StatRow label="elapsed" value={formatMs(activeSummary.elapsedMs ?? summary.elapsedMs)} />
        <StatRow label="distancia" value={`${formatNumber(activeSummary.distanceMeters ?? summary.distance, 1)} m`} />
        <StatRow label="raw/trusted/render" value={`${activeSummary.rawPathCount ?? summary.rawPointsCount ?? 0}/${activeSummary.trustedPathCount ?? summary.trustedPointsCount ?? 0}/${activeSummary.renderPathCount ?? summary.displayPointsCount ?? 0}`} />
        <StatRow label="segments" value={activeSummary.segmentsCount ?? summary.segmentsCount ?? 0} />
        <StatRow label="route chunks" value={activeSummary.routeChunksCount ?? 0} />
        <StatRow label="ultimo checkpoint" value={activeSummary.lastCheckpointAt || activeRun?.lastUpdatedAt || activeRun?.checkpointAt || "-"} />
        <StatRow label="recovery" value={activeSummary.recoveryStatus || "-"} />
        <StatRow label="auto-save/storage" value={formatStatus(activeSummary.autoSaveStatus)} />
        <StatRow label="foreground watcher" value={activeSummary.foregroundWatcherStatus || runtime.watcherStatus || "-"} />
        <StatRow label="background watcher" value={activeSummary.backgroundTaskStatus || runtime.taskName || "-"} />
        <StatRow label="notification" value={activeSummary.notificationStatus || "-"} />
        <StatRow label="native notification" value={formatBoolean(activeSummary.nativeNotificationActive)} />
      </DiagnosticPanel>

      <DiagnosticPanel title="GPS / Tracking">
        <StatRow label="raw recebidos" value={gpsSummary.rawPointsReceived ?? 0} />
        <StatRow label="aceitos" value={gpsSummary.acceptedPoints ?? 0} />
        <StatRow label="descartados" value={gpsSummary.rejectedPoints ?? 0} />
        <StatRow label="relaxed aceitos" value={gpsSummary.acceptedByRelaxedFilter ?? "indisponível"} />
        <StatRow label="motivos descarte" value={formatTopReasons(gpsSummary.topRejectReasons)} />
        <StatRow label="ultima accuracy" value={lastPoint ? `${formatNumber(lastPoint.accuracy, 1)} m` : formatStatus(gpsSummary.lastAccuracy)} />
        <StatRow label="ultima speed" value={formatStatus(gpsSummary.lastSpeed)} />
        <StatRow label="gap raw" value={formatMs(gpsSummary.longestRawGapMs)} />
        <StatRow label="gap accepted" value={formatMs(gpsSummary.longestAcceptedGapMs)} />
        <StatRow label="raw/trusted/render" value={`${gpsSummary.rawPathCount ?? 0}/${gpsSummary.trustedPathCount ?? 0}/${gpsSummary.renderPathCount ?? 0}`} />
        <StatRow label="ultimo erro" value={gpsSummary.lastError?.reason || gpsSummary.lastError?.event || "-"} />
      </DiagnosticPanel>

      <DiagnosticPanel title="Permissoes">
        <StatRow label="foreground location" value={formatStatus(permissionsSummary.foregroundLocation)} />
        <StatRow label="background location" value={formatStatus(permissionsSummary.backgroundLocation)} />
        <StatRow label="notifications" value={formatStatus(permissionsSummary.notifications)} />
        <StatRow label="midia/galeria" value={formatStatus(permissionsSummary.mediaLibrary || permissionsSummary.imageLibrary)} />
        <StatRow label="can start run" value={formatBoolean(permissionsSummary.canStartRun)} />
        <StatRow label="onboarding completo" value={formatBoolean(permissionsSummary.onboardingCompleted)} />
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={openAppSettings}
          disabled={Boolean(busyAction)}
        >
          <Ionicons name="settings-outline" size={18} color={WayperTheme.colors.text} />
          <Text style={styles.secondaryActionText}>Abrir configuracoes do app</Text>
        </TouchableOpacity>
      </DiagnosticPanel>

      <DiagnosticPanel title="Storage Local">
        <StatRow label="runs" value={storageSummary.runsCount ?? 0} />
        <StatRow label="snapshot ativo" value={formatBoolean(storageSummary.activeSnapshotExists)} />
        <StatRow label="snapshot legacy" value={formatBoolean(storageSummary.legacyActiveSnapshotExists)} />
        <StatRow label="territories/events" value={`${storageSummary.territoriesCount ?? 0}/${storageSummary.territoryEventsCount ?? 0}`} />
        <StatRow label="stories/feed cache" value={`${storageSummary.storiesCount ?? 0}/${storageSummary.feedCacheCount ?? 0}`} />
        <StatRow label="xp events" value={storageSummary.xpEventsCount ?? 0} />
        <StatRow label="achievements" value={storageSummary.achievementsCount ?? 0} />
        <StatRow label="profile cache" value={formatBoolean(storageSummary.profileCacheExists)} />
        <StatRow label="ranking cache" value={formatBoolean(storageSummary.rankingCacheExists)} />
        <StatRow label="log backend" value={diagnosticStorage.backend || storageSummary.logs?.backend || "-"} />
        <StatRow label="pending log buffer" value={diagnosticStorage.pendingLogs ?? storageSummary.logs?.pendingLogs ?? 0} />
      </DiagnosticPanel>

      <DiagnosticPanel title="Sync">
        <StatRow label="PENDING_SYNC" value={syncSummary.pendingSync ?? 0} />
        <StatRow label="SYNC_FAILED" value={syncSummary.syncFailed ?? 0} />
        <StatRow label="SYNCING" value={syncSummary.syncing ?? 0} />
        <StatRow label="SYNCED" value={syncSummary.synced ?? 0} />
        <StatRow label="fila pendente" value={syncSummary.pendingQueueCount ?? 0} />
        <StatRow label="ultimo attempt" value={syncSummary.lastSyncAttemptAt || "-"} />
        <StatRow label="lock ativo" value={formatBoolean(syncSummary.lockActive)} />
        <StatRow label="online" value={formatBoolean(syncSummary.online)} />
        <StatRow label="ultimo erro" value={syncSummary.lastError || "-"} />
      </DiagnosticPanel>

      <DiagnosticPanel title="Fila pos-corrida">
        <StatRow label="pendentes" value={deferredQueueSummary.pending ?? syncSummary.deferredPendingCount ?? 0} />
        <StatRow label="rodando" value={deferredQueueSummary.running ?? syncSummary.deferredRunningCount ?? 0} />
        <StatRow label="retry/permanente" value={`${deferredQueueSummary.failedRetryable ?? 0}/${deferredQueueSummary.failedPermanent ?? 0}`} />
        <StatRow label="concluidas" value={deferredQueueSummary.succeeded ?? 0} />
        <StatRow label="mais antiga" value={deferredQueueSummary.oldestPendingAt || syncSummary.deferredOldestPendingAt || "-"} />
        <StatRow label="proxima tentativa" value={deferredQueueSummary.nextRunAt || syncSummary.deferredNextRunAt || "-"} />
        <StatRow label="ultimo erro" value={deferredQueueSummary.lastError?.message || syncSummary.deferredLastError?.message || "-"} />
      </DiagnosticPanel>

      <DiagnosticPanel title="Notificacao / Background">
        <StatRow label="foreground service" value={formatBoolean(notificationSummary.foregroundServiceActive)} />
        <StatRow label="notification id" value={notificationSummary.notificationId || "-"} />
        <StatRow label="notification status" value={notificationSummary.notificationStatus || "-"} />
        <StatRow label="actions" value={notificationSummary.notificationActionsRegistered || "-"} />
        <StatRow label="background task" value={notificationSummary.backgroundTaskStatus || "-"} />
        <StatRow label="foreground watcher" value={notificationSummary.foregroundWatcherStatus || "-"} />
        <StatRow label="AppState" value={notificationSummary.appState || appState || "-"} />
        <StatRow label="lifecycle events" value={notificationSummary.lifecycleEvents?.length || 0} />
      </DiagnosticPanel>

      <DiagnosticPanel title="Home Social / Stories / Feed">
        <StatRow label="stories locais" value={socialSummary.storiesCount ?? 0} />
        <StatRow label="pending story sync" value={socialSummary.pendingStorySyncCount ?? 0} />
        <StatRow label="failed story sync" value={socialSummary.failedStorySyncCount ?? 0} />
        <StatRow label="feed cache" value={socialSummary.feedCacheCount ?? 0} />
        <StatRow label="source" value={socialSummary.source || "-"} />
        <StatRow label="demo habilitado" value={formatBoolean(socialSummary.demoEnabled)} />
        <StatRow label="ultimo erro remoto" value={socialSummary.lastRemoteError || "-"} />
      </DiagnosticPanel>

      <DiagnosticPanel title="Compartilhamento">
        <StatRow label="ultimo export imagem" value={shareSummary.lastImageExportAt || "-"} />
        <StatRow label="acao" value={shareSummary.lastImageExportAction || "-"} />
        <StatRow label="ultimo PNG" value={shareSummary.lastPngExportAt || "-"} />
        <StatRow label="tamanho ultimo arquivo" value={shareSummary.lastGeneratedFileSize || "-"} />
        <StatRow label="permissao midia" value={formatStatus(shareSummary.mediaPermission)} />
        <StatRow label="story via share" value={shareSummary.storyCreatedViaShareAt || "-"} />
        <StatRow label="ultimo erro" value={shareSummary.lastError?.message || shareSummary.lastError?.event || "-"} />
      </DiagnosticPanel>

      <DiagnosticPanel title="Territorio">
        <StatRow label="territories" value={territorySummary.territoriesCount ?? 0} />
        <StatRow label="events" value={territorySummary.eventsCount ?? 0} />
        <StatRow label="leaderboards cache" value={territorySummary.leaderboardsCacheCount ?? 0} />
        <StatRow label="legacy zones" value={territorySummary.legacyZonesCount ?? 0} />
        <StatRow label="area total" value={`${formatNumber(territorySummary.totalAreaM2, 1)} m2`} />
        <StatRow label="pending sync" value={territorySummary.pendingSyncCount ?? 0} />
        <StatRow label="ultima captura" value={territorySummary.lastCaptureAt || "-"} />
        <StatRow label="ultimo erro" value={territorySummary.lastError?.reason || territorySummary.lastError?.event || "-"} />
      </DiagnosticPanel>

      <DiagnosticPanel title="Perfil / Ranking / XP">
        <StatRow label="profile source" value={profileSummary.profileSource || "-"} />
        <StatRow label="total XP" value={profileSummary.totalXp ?? 0} />
        <StatRow label="level" value={profileSummary.level ?? 1} />
        <StatRow label="achievements" value={`${profileSummary.achievementsUnlockedCount ?? 0}/${profileSummary.achievementsCount ?? 0}`} />
        <StatRow label="ranking source" value={profileSummary.rankingSource || "-"} />
        <StatRow label="ranking updatedAt" value={profileSummary.rankingCacheUpdatedAt || "-"} />
        <StatRow label="total runs" value={profileSummary.totalRuns ?? 0} />
        <StatRow label="pending/failed sync" value={`${profileSummary.pendingSyncCount ?? 0}/${profileSummary.failedSyncCount ?? 0}`} />
      </DiagnosticPanel>

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
          onPress={copyTechnicalSummary}
          disabled={Boolean(busyAction)}
        >
          <Ionicons name="copy-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.actionText}>{busyAction === "copy" ? "Copiando" : "Copiar resumo tecnico"}</Text>
        </TouchableOpacity>
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
        <TouchableOpacity style={styles.actionButton} onPress={forceFlushLogs} disabled={Boolean(busyAction)}>
          <Ionicons name="save-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.actionText}>{busyAction === "flush" ? "Gravando" : "Forcar flush de logs"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={checkPermissions} disabled={Boolean(busyAction)}>
          <Ionicons name="shield-checkmark-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.actionText}>{busyAction === "permissions" ? "Verificando" : "Verificar permissoes"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={retryPendingSync} disabled={Boolean(busyAction)}>
          <Ionicons name="sync-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.actionText}>{busyAction === "sync" ? "Sincronizando" : "Tentar sync pendente"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={processDeferredQueue} disabled={Boolean(busyAction)}>
          <Ionicons name="play-forward-outline" size={18} color={WayperTheme.colors.textInverse} />
          <Text style={styles.actionText}>{busyAction === "deferred-queue" ? "Processando" : "Processar fila pos-corrida"}</Text>
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
  secondaryButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: WayperTheme.spacing.xs,
    paddingHorizontal: WayperTheme.spacing.md,
    borderRadius: WayperTheme.radius.sm,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  actionText: {
    flex: 1,
    color: WayperTheme.colors.textInverse,
    fontSize: 13,
    fontWeight: "900",
  },
  secondaryActionText: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
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
