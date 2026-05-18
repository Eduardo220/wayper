import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Slider from "@react-native-community/slider";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { WPBottomSheet, WPChip, WPInput } from "../ui";
import { WayperTheme } from "../../theme/wayperTheme";
import { computeTerritoryXP } from "../../services/xp/territoryXp.js";

const TAG_OPTIONS = [
  { label: "Treino Forte", icon: "barbell-outline" },
  { label: "Ritmo Médio", icon: "trending-up-outline" },
  { label: "Recuperação", icon: "refresh-outline" },
  { label: "Longão", icon: "walk-outline" },
  { label: "Tiro", icon: "locate-outline" },
  { label: "Leve", icon: "leaf-outline" },
];

const safeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const formatArea = (areaM2 = 0) => {
  const area = Math.max(0, safeNumber(areaM2));
  if (area >= 1000000) return `${(area / 1000000).toFixed(2)} km2`;
  return `${Math.round(area).toLocaleString("pt-BR")} m2`;
};

const normalizeCaptureResult = (captureResult, runData = {}) => {
  const result = captureResult || runData.captureResult || null;
  if (!result) return null;

  const affectedUsers = Array.isArray(result.affectedUsers) ? result.affectedUsers : [];
  const becameLeaderInCells = Array.isArray(result.becameLeaderInCells) ? result.becameLeaderInCells : [];
  const conqueredTerritories = Array.isArray(result.conqueredTerritories) ? result.conqueredTerritories : [];

  return {
    ...result,
    capturedAreaM2: safeNumber(result.capturedAreaM2 ?? runData.area),
    newAreaM2: safeNumber(result.newAreaM2),
    stolenAreaM2: safeNumber(result.stolenAreaM2),
    affectedUsersCount: safeNumber(result.affectedUsersCount, affectedUsers.length),
    conqueredCount: safeNumber(result.conqueredCount, conqueredTerritories.length),
    becameLeaderCount: safeNumber(result.becameLeaderCount, becameLeaderInCells.length),
    affectedUsers,
    becameLeaderInCells,
  };
};

const getFriendlyFailure = (reason) => {
  if (reason === "not_closed_loop") return "Area nao capturada: trajeto nao fechou um loop valido.";
  if (reason === "not_enough_points") return "Area nao capturada: faltaram pontos de GPS para formar um territorio.";
  if (reason === "area_too_small") return "Area nao capturada: o loop ficou pequeno demais.";
  if (reason === "area_too_large") return "Area nao capturada: a area ficou grande demais para captura segura.";
  if (reason === "bad_gps") return "Area nao capturada: sinal de GPS insuficiente.";
  return "Area nao capturada nesta corrida.";
};

function CaptureMetric({ icon, label, value, accent = WayperTheme.colors.primary }) {
  return (
    <View style={styles.captureMetric}>
      <Ionicons name={icon} size={18} color={accent} />
      <Text style={styles.captureMetricValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.captureMetricLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

export default function RunSummaryModal({ visible, onClose, onSave, baseRunData = {}, captureResult = null, mode = "save" }) {
  const runData = useMemo(() => baseRunData || {}, [baseRunData]);
  const isZoneRun = runData.mode === "zones" || Number(runData.area || 0) > 0 || !!runData.zoneId;
  const isEditing = mode === "edit";
  const [name, setName] = useState("Minha Corrida");
  const [effort, setEffort] = useState(5);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState([]);
  const [photoUri, setPhotoUri] = useState(null);
  const [saving, setSaving] = useState(false);
  const effortPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;

    setName(runData.name || `${isZoneRun ? "Captura por zonas" : "Corrida"} ${new Date(runData.date || Date.now()).toLocaleString()}`);
    setEffort(Math.min(10, Math.max(1, Math.round(Number(runData.effort ?? 5)))));
    setNotes(runData.notes || "");
    setTags(Array.isArray(runData.tags) ? runData.tags : []);
    setPhotoUri(runData.photoUri || null);
    setSaving(false);
  }, [visible, runData, isZoneRun]);

  useEffect(() => {
    Animated.sequence([
      Animated.spring(effortPulse, { toValue: 1.08, useNativeDriver: true, speed: 28, bounciness: 7 }),
      Animated.spring(effortPulse, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 6 }),
    ]).start();
  }, [effort, effortPulse]);

  const metrics = useMemo(
    () => ({
      distance: `${((Number(runData.distance) || 0) / 1000).toFixed(2)} km`,
      duration: formatDuration(runData.duration),
      area: `${Math.round(Number(runData.area) || 0)} m2`,
    }),
    [runData]
  );
  const competitiveResult = useMemo(
    () => normalizeCaptureResult(captureResult, runData),
    [captureResult, runData]
  );
  const captureXp = useMemo(
    () => computeTerritoryXP({
      capturedAreaM2: competitiveResult?.capturedAreaM2,
      newAreaM2: competitiveResult?.newAreaM2,
      stolenAreaM2: competitiveResult?.stolenAreaM2,
      becameLeaderCount: competitiveResult?.becameLeaderCount,
      conqueredCount: competitiveResult?.conqueredCount,
      affectedUsersCount: competitiveResult?.affectedUsersCount,
    }),
    [competitiveResult]
  );
  const captureNotice = runData.territoryCaptureMessage || competitiveResult?.territoryCaptureMessage || null;
  const captureFailed = Boolean(runData.territoryCaptureFailedReason || competitiveResult?.ok === false);
  const stolenTarget = competitiveResult?.affectedUsers?.[0];

  async function pickPhoto() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permissão negada", "Permita acesso às fotos para adicionar uma imagem.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        quality: 0.7,
        allowsEditing: true,
        aspect: [4, 3],
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        setPhotoUri(res.assets[0].uri);
      }
    } catch (e) {
      console.warn("pickPhoto", e);
    }
  }

  function toggleTag(tag) {
    setTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);

    const payload = {
      ...runData,
      name,
      effort,
      notes,
      tags,
      photoUri,
    };

    try {
      await onSave(payload);
    } catch (e) {
      console.warn("RunSummaryModal.onSave failed", e);
      setSaving(false);
      return;
    }

    onClose();
  }

  return (
    <WPBottomSheet visible={visible} onClose={onClose} maxHeight="92%" contentStyle={styles.sheet}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.heroRow}>
          <View style={styles.finishBadgeOuter}>
            <View style={styles.finishBadgeMid}>
              <View style={styles.finishBadgeInner}>
                <Ionicons name="flag" size={32} color={WayperTheme.colors.primary} />
              </View>
            </View>
          </View>

          <View style={styles.heroText}>
            <Text style={styles.title}>
              {isEditing ? "Editar" : "Finalizar"} <Text style={styles.titleAccent}>{isZoneRun ? "Zonas" : "Corrida"}</Text>
            </Text>
            <View style={styles.metricsRow}>
              <MetricPill icon="location-outline" value={metrics.distance} label="Distância" />
              <MetricPill icon={isZoneRun ? "map-outline" : "timer-outline"} value={isZoneRun ? metrics.area : metrics.duration} label={isZoneRun ? "Area" : "Tempo"} />
            </View>
          </View>
        </View>

        {captureNotice ? (
          <View style={[styles.captureNotice, captureFailed && styles.captureNoticeWarning]}>
            <Ionicons
              name={captureFailed ? "alert-circle-outline" : "trophy-outline"}
              size={20}
              color={captureFailed ? WayperTheme.colors.warning : WayperTheme.colors.primary}
            />
            <Text style={styles.captureNoticeText}>{captureNotice}</Text>
          </View>
        ) : null}

        {competitiveResult?.ok ? (
          <View style={styles.captureBlock}>
            <View style={styles.captureBlockHeader}>
              <View>
                <Text style={styles.captureEyebrow}>Resultado competitivo</Text>
                <Text style={styles.captureTitle}>Territorio conquistado</Text>
              </View>
              <View style={styles.captureXpPill}>
                <Ionicons name="flash-outline" size={16} color={WayperTheme.colors.textInverse} />
                <Text style={styles.captureXpText}>+{captureXp.xp} XP</Text>
              </View>
            </View>

            <View style={styles.captureMetricGrid}>
              <CaptureMetric icon="map-outline" label="Area total" value={formatArea(competitiveResult.capturedAreaM2)} />
              <CaptureMetric icon="sparkles-outline" label="Area nova" value={formatArea(competitiveResult.newAreaM2)} accent={WayperTheme.colors.cyan} />
              <CaptureMetric icon="repeat-outline" label="Area retomada" value={formatArea(competitiveResult.stolenAreaM2)} accent={WayperTheme.colors.warning} />
              <CaptureMetric icon="flag-outline" label="Regioes lideradas" value={String(competitiveResult.becameLeaderCount || 0)} />
            </View>

            {competitiveResult.stolenAreaM2 > 0 ? (
              <Text style={styles.captureProgressText}>
                Retomou {formatArea(competitiveResult.stolenAreaM2)}
                {stolenTarget?.userName ? ` de ${stolenTarget.userName}` : ""}
                .
              </Text>
            ) : (
              <Text style={styles.captureProgressText}>
                Voce capturou {formatArea(competitiveResult.capturedAreaM2)}.
              </Text>
            )}

            {competitiveResult.becameLeaderCount > 0 ? (
              <Text style={styles.captureProgressText}>
                Virou lider em {competitiveResult.becameLeaderCount} regiao{competitiveResult.becameLeaderCount > 1 ? "es" : ""}.
              </Text>
            ) : null}

            {competitiveResult.conqueredCount > 0 ? (
              <Text style={styles.captureProgressText}>
                Assumiu {competitiveResult.conqueredCount} territorio{competitiveResult.conqueredCount > 1 ? "s" : ""} por completo.
              </Text>
            ) : null}
          </View>
        ) : captureFailed ? (
          <View style={styles.captureBlock}>
            <View style={styles.captureBlockHeader}>
              <View>
                <Text style={styles.captureEyebrow}>Captura territorial</Text>
                <Text style={styles.captureTitle}>Corrida salva</Text>
              </View>
            </View>
            <Text style={styles.captureProgressText}>
              {getFriendlyFailure(runData.territoryCaptureFailedReason || competitiveResult?.reason)}
            </Text>
            <Text style={styles.captureProgressText}>
              Tente finalizar proximo do ponto inicial para conquistar territorio.
            </Text>
          </View>
        ) : null}

        <WPInput
          label="Nome"
          value={name}
          onChangeText={setName}
          placeholder={isZoneRun ? "Ex: Zona do parque" : "Ex: Corrida matinal no centro"}
          style={styles.field}
        />

        <View style={styles.field}>
          <View style={styles.effortHeader}>
            <Text style={styles.label}>Grau de esforço (1-10)</Text>
            <Animated.View style={[styles.effortBubble, { transform: [{ scale: effortPulse }] }]}>
              <Text style={styles.effortBubbleText}>{effort}</Text>
            </Animated.View>
          </View>

          <View style={styles.sliderWrap}>
            <View pointerEvents="none" style={styles.sliderDots}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <View key={n} style={[styles.sliderDot, effort >= n && styles.sliderDotActive]} />
              ))}
            </View>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={10}
              step={1}
              value={effort}
              onValueChange={(value) => setEffort(Math.round(value))}
              minimumTrackTintColor={WayperTheme.colors.primary}
              maximumTrackTintColor={WayperTheme.colors.borderStrong}
              thumbTintColor={WayperTheme.colors.primary}
            />
          </View>

          <View style={styles.effortScaleRow}>
            <View>
              <Text style={styles.scaleNumber}>1</Text>
              <Text style={styles.scaleLabel}>Leve</Text>
            </View>
            <View style={styles.scaleEnd}>
              <Text style={styles.scaleNumber}>10</Text>
              <Text style={styles.scaleLabel}>Máximo</Text>
            </View>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Tags</Text>
          <View style={styles.tagContainer}>
            {TAG_OPTIONS.map((tag) => (
              <WPChip
                key={tag.label}
                label={tag.label}
                active={tags.includes(tag.label)}
                onPress={() => toggleTag(tag.label)}
                icon={<Ionicons name={tag.icon} size={20} color={tags.includes(tag.label) ? WayperTheme.colors.textInverse : WayperTheme.colors.primary} />}
                style={styles.tag}
              />
            ))}
          </View>
        </View>

        <WPInput
          label="Notas"
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Como foi a corrida? comentários..."
          style={styles.field}
          inputStyle={styles.notesInput}
        />

        <View style={styles.field}>
          <Text style={styles.label}>Foto opcional</Text>
          {photoUri ? (
            <View>
              <TouchableOpacity onPress={pickPhoto} activeOpacity={0.85}>
                <Image source={{ uri: photoUri }} style={styles.photo} />
              </TouchableOpacity>
              <View style={styles.photoActionRow}>
                <TouchableOpacity style={styles.photoActionButton} onPress={pickPhoto} activeOpacity={0.85}>
                  <Ionicons name="swap-horizontal-outline" size={18} color={WayperTheme.colors.primary} />
                  <Text style={styles.photoActionText}>Trocar foto</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.photoActionButton, styles.photoRemoveButton]} onPress={() => setPhotoUri(null)} activeOpacity={0.85}>
                  <Ionicons name="trash-outline" size={18} color={WayperTheme.colors.danger} />
                  <Text style={styles.photoRemoveText}>Remover</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto} activeOpacity={0.85}>
              <Ionicons name="image-outline" size={28} color={WayperTheme.colors.primary} />
              <Text style={styles.photoText}>Selecionar foto</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity activeOpacity={0.9} onPress={handleSave} disabled={saving} style={[styles.saveTouchable, saving && styles.saveDisabled]}>
          <LinearGradient
            colors={[WayperTheme.colors.primaryLight, WayperTheme.colors.primary, WayperTheme.colors.primaryDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.saveButton}
          >
            <View pointerEvents="none" style={styles.saveOrb} />
            <Ionicons name="save-outline" size={28} color={WayperTheme.colors.textInverse} />
            <Text style={styles.saveText}>
              {saving ? "Salvando..." : isEditing ? "Salvar alteracoes" : isZoneRun ? "Salvar zonas" : "Salvar corrida"}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity activeOpacity={0.75} onPress={onClose} style={styles.cancelButton}>
          <Text style={styles.cancelText}>Cancelar</Text>
        </TouchableOpacity>
      </ScrollView>
    </WPBottomSheet>
  );
}

function MetricPill({ icon, value, label }) {
  return (
    <View style={styles.metricPill}>
      <Ionicons name={icon} size={23} color={WayperTheme.colors.primary} />
      <View>
        <Text style={styles.metricValue}>{value}</Text>
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
    </View>
  );
}

function formatDuration(sec = 0) {
  const total = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: "rgba(8, 16, 24, 0.96)",
    borderColor: WayperTheme.colors.borderStrong,
  },
  content: {
    paddingBottom: WayperTheme.spacing.xl,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.lg,
  },
  finishBadgeOuter: {
    width: 118,
    height: 118,
    borderRadius: 59,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    ...WayperTheme.shadows.greenGlow,
  },
  finishBadgeMid: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: WayperTheme.colors.primary,
  },
  finishBadgeInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  heroText: {
    flex: 1,
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 34,
    fontWeight: "900",
  },
  titleAccent: {
    color: WayperTheme.colors.primary,
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.md,
    marginTop: WayperTheme.spacing.lg,
  },
  captureNotice: {
    minHeight: 48,
    borderRadius: WayperTheme.radius.lg,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    backgroundColor: WayperTheme.colors.primarySoft,
    paddingHorizontal: WayperTheme.spacing.md,
    paddingVertical: WayperTheme.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
  },
  captureNoticeWarning: {
    borderColor: WayperTheme.colors.warningBorder || WayperTheme.colors.borderStrong,
    backgroundColor: WayperTheme.colors.warningSoft || WayperTheme.colors.surfaceSoft,
  },
  captureNoticeText: {
    ...WayperTheme.typography.body,
    flex: 1,
    color: WayperTheme.colors.text,
  },
  captureBlock: {
    borderRadius: WayperTheme.radius.xl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    padding: WayperTheme.spacing.lg,
    gap: WayperTheme.spacing.md,
  },
  captureBlockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: WayperTheme.spacing.md,
  },
  captureEyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  captureTitle: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  captureXpPill: {
    minHeight: 34,
    paddingHorizontal: WayperTheme.spacing.md,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.xs,
  },
  captureXpText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 13,
    fontWeight: "900",
  },
  captureMetricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.sm,
  },
  captureMetric: {
    flexGrow: 1,
    flexBasis: "46%",
    minHeight: 78,
    borderRadius: WayperTheme.radius.lg,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    backgroundColor: WayperTheme.colors.surface,
    padding: WayperTheme.spacing.md,
    justifyContent: "center",
  },
  captureMetricValue: {
    color: WayperTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginTop: WayperTheme.spacing.xs,
  },
  captureMetricLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  captureProgressText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "800",
  },
  metricPill: {
    minHeight: 62,
    minWidth: 146,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    paddingHorizontal: WayperTheme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.md,
  },
  metricValue: {
    color: WayperTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  metricLabel: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 1,
  },
  field: {
    marginTop: WayperTheme.spacing.xl,
  },
  label: {
    ...WayperTheme.typography.label,
    fontSize: 16,
    color: "#C8D2E2",
  },
  effortHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: WayperTheme.spacing.sm,
  },
  effortBubble: {
    minWidth: 56,
    minHeight: 56,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 2,
    borderColor: WayperTheme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...WayperTheme.shadows.greenGlow,
  },
  effortBubbleText: {
    color: WayperTheme.colors.primary,
    fontSize: 27,
    fontWeight: "900",
  },
  sliderWrap: {
    height: 58,
    justifyContent: "center",
  },
  slider: {
    width: "100%",
    height: 54,
  },
  sliderDots: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 25,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sliderDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: WayperTheme.colors.textSubtle,
    opacity: 0.75,
  },
  sliderDotActive: {
    backgroundColor: WayperTheme.colors.primaryLight,
    opacity: 1,
  },
  effortScaleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  scaleEnd: {
    alignItems: "flex-end",
  },
  scaleNumber: {
    color: "#C8D2E2",
    fontSize: 28,
    fontWeight: "800",
  },
  scaleLabel: {
    color: WayperTheme.colors.primary,
    fontSize: 14,
    fontWeight: "800",
    marginTop: WayperTheme.spacing.xs,
  },
  tagContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: WayperTheme.spacing.md,
    marginTop: WayperTheme.spacing.md,
  },
  tag: {
    marginBottom: WayperTheme.spacing.xs,
  },
  notesInput: {
    paddingRight: 46,
  },
  photoBtn: {
    minHeight: 98,
    borderRadius: WayperTheme.radius.xl,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: WayperTheme.colors.borderStrong,
    backgroundColor: "rgba(16, 27, 37, 0.58)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.md,
    marginTop: WayperTheme.spacing.sm,
  },
  photoText: {
    color: WayperTheme.colors.primary,
    fontWeight: "900",
    fontSize: 16,
  },
  photo: {
    width: "100%",
    height: 170,
    borderRadius: WayperTheme.radius.xl,
    marginTop: WayperTheme.spacing.sm,
  },
  photoActionRow: {
    flexDirection: "row",
    gap: WayperTheme.spacing.md,
    marginTop: WayperTheme.spacing.md,
  },
  photoActionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: WayperTheme.radius.pill,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    backgroundColor: WayperTheme.colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
  },
  photoRemoveButton: {
    borderColor: WayperTheme.colors.dangerBorder,
    backgroundColor: WayperTheme.colors.dangerSoft,
  },
  photoActionText: {
    color: WayperTheme.colors.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  photoRemoveText: {
    color: WayperTheme.colors.danger,
    fontSize: 14,
    fontWeight: "900",
  },
  saveTouchable: {
    marginTop: WayperTheme.spacing.xl,
    borderRadius: WayperTheme.radius.xl,
    ...WayperTheme.shadows.greenGlow,
  },
  saveDisabled: {
    opacity: 0.68,
  },
  saveButton: {
    minHeight: 78,
    borderRadius: WayperTheme.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
  },
  saveOrb: {
    position: "absolute",
    width: 108,
    height: 108,
    borderRadius: 54,
    left: "34%",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  saveText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 22,
    fontWeight: "900",
  },
  cancelButton: {
    alignItems: "center",
    paddingVertical: WayperTheme.spacing.lg,
  },
  cancelText: {
    color: WayperTheme.colors.textMuted,
    fontWeight: "800",
  },
});
