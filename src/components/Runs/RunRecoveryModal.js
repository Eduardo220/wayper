import React from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WPButton } from "../ui";
import { WayperTheme } from "../../theme/wayperTheme";
import {
  RUN_RECOVERY_STATUS,
  buildRecoverySummary,
} from "../../services/run/runRecoveryService.js";
import { getFormattedPace } from "../../utils/pace";

function formatDistance(meters = 0) {
  const value = Number(meters) || 0;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
  return `${Math.round(value)} m`;
}

function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusCopy(status) {
  if (status === RUN_RECOVERY_STATUS.PAUSED) return "Ela estava pausada quando o app fechou.";
  if (status === RUN_RECOVERY_STATUS.PENDING_SYNC || status === RUN_RECOVERY_STATUS.FINISHED) {
    return "Ela ja foi finalizada no aparelho e ainda precisa sincronizar.";
  }
  return "Ela foi interrompida antes de ser finalizada.";
}

export default function RunRecoveryModal({
  visible,
  recovery,
  loading = false,
  onContinue,
  onFinish,
  onDiscard,
}) {
  const summary = buildRecoverySummary(recovery || {});
  const finished = summary.status === RUN_RECOVERY_STATUS.FINISHED || summary.status === RUN_RECOVERY_STATUS.PENDING_SYNC;
  const pace = getFormattedPace(summary.durationSeconds, summary.distanceMeters / 1000, { suffix: "/km" });

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View style={styles.iconWrap}>
              <Ionicons name="shield-checkmark-outline" size={28} color={WayperTheme.colors.primary} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>Recuperacao</Text>
              <Text style={styles.title}>Encontramos uma corrida interrompida</Text>
            </View>
          </View>

          <Text style={styles.message}>
            Ela foi salva automaticamente ate o ultimo ponto registrado. {getStatusCopy(summary.status)}
          </Text>

          <View style={styles.metricGrid}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Distancia</Text>
              <Text style={styles.metricValue}>{formatDistance(summary.distanceMeters)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Tempo</Text>
              <Text style={styles.metricValue}>{formatDuration(summary.durationSeconds)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Ritmo</Text>
              <Text style={styles.metricValue}>{pace || "--"}</Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <Ionicons name="time-outline" size={17} color={WayperTheme.colors.textMuted} />
            <Text style={styles.detailText}>Inicio: {formatDate(summary.startedAt)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="navigate-outline" size={17} color={WayperTheme.colors.textMuted} />
            <Text style={styles.detailText}>Ultimo registro: {formatDate(summary.updatedAt)}</Text>
          </View>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={WayperTheme.colors.primary} />
              <Text style={styles.loadingText}>Resolvendo corrida</Text>
            </View>
          ) : null}

          {!finished ? (
            <WPButton
              title="Continuar corrida"
              disabled={loading}
              icon={<Ionicons name="play" size={18} color={WayperTheme.colors.textInverse} />}
              onPress={onContinue}
              style={styles.action}
            />
          ) : null}
          <WPButton
            title={finished ? "Sincronizar corrida" : "Finalizar e salvar"}
            variant={finished ? "cyan" : "secondary"}
            disabled={loading}
            icon={<Ionicons name={finished ? "cloud-upload-outline" : "flag-outline"} size={18} color={finished ? WayperTheme.colors.cyan : WayperTheme.colors.text} />}
            onPress={onFinish}
            style={styles.action}
          />
          <WPButton
            title="Descartar"
            variant="ghost"
            disabled={loading}
            icon={<Ionicons name="trash-outline" size={18} color={WayperTheme.colors.text} />}
            onPress={onDiscard}
            style={styles.action}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  sheet: {
    width: "100%",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 22,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: "rgba(8, 16, 24, 0.98)",
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
  },
  handle: {
    alignSelf: "center",
    width: 48,
    height: 5,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.borderStrong,
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 24,
    fontWeight: "900",
    marginTop: 3,
  },
  message: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    marginTop: 14,
  },
  metricGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 18,
  },
  metric: {
    flex: 1,
    minHeight: 78,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: 10,
    justifyContent: "center",
  },
  metricLabel: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: "900",
  },
  metricValue: {
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 5,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  detailText: {
    flex: 1,
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  loadingRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    marginTop: 16,
  },
  loadingText: {
    color: WayperTheme.colors.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  action: {
    marginTop: 10,
  },
});
