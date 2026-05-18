import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { WayperTheme } from "../../theme/wayperTheme";
import {
  copyPngToClipboard,
  generateShareImage,
  generateTransparentTracePng,
  getRenderableTraceSource,
  openNativeShare,
  saveImageToGallery,
} from "../../utils/runShareImage";
import RunShareImageTemplate from "./RunShareImageTemplate";
import RunTracePngTemplate, { RUN_TRACE_PNG_SIZE } from "./RunTracePngTemplate";
import TransparentPreviewBackground from "./TransparentPreviewBackground";
import { RUN_SHARE_CARD_SIZE } from "./RunShareCard";

const TEMPLATE = {
  image: "image",
  tracePng: "tracePng",
};

const safeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const formatDuration = (seconds = 0) => {
  const total = Math.max(0, Math.round(safeNumber(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const formatDate = (value) => {
  try {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "";
  }
};

const formatPace = (secondsPerKm) => {
  const seconds = safeNumber(secondsPerKm, 0);
  if (seconds <= 0) return "--:--/km";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}/km`;
};

const deriveDistance = (run, explicitDistance) => {
  if (typeof explicitDistance === "string") return explicitDistance;
  const explicit = safeNumber(explicitDistance, NaN);
  const meters = Number.isFinite(explicit)
    ? explicit
    : safeNumber(run?.distanceMeters ?? run?.distance ?? run?.totalDistance, 0);
  const km = meters > 100 ? meters / 1000 : meters;
  return `${km.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
};

const deriveArea = (run, explicitArea) => {
  if (typeof explicitArea === "string") return explicitArea;
  const value = safeNumber(explicitArea ?? run?.areaM2 ?? run?.area, 0);
  return `${Math.round(value).toLocaleString("pt-BR")} m2`;
};

function ActionButton({ icon, label, onPress, loading, disabled, primary = false, wide = false }) {
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      disabled={disabled || loading}
      style={[
        styles.actionButton,
        wide && styles.actionButtonWide,
        primary && styles.actionButtonPrimary,
        (disabled || loading) && styles.actionButtonDisabled,
      ]}
      onPress={onPress}
    >
      <View style={[styles.actionIcon, primary && styles.actionIconPrimary]}>
        {loading ? (
          <ActivityIndicator size="small" color={primary ? WayperTheme.colors.textInverse : WayperTheme.colors.primary} />
        ) : (
          <Ionicons
            name={icon}
            size={20}
            color={primary ? WayperTheme.colors.textInverse : WayperTheme.colors.primary}
          />
        )}
      </View>
      <Text style={[styles.actionLabel, primary && styles.actionLabelPrimary]} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function TemplateTab({ selected, title, subtitle, icon, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      style={[styles.templateTab, selected && styles.templateTabSelected]}
      onPress={onPress}
    >
      <View style={[styles.templateIcon, selected && styles.templateIconSelected]}>
        <Ionicons name={icon} size={20} color={selected ? WayperTheme.colors.textInverse : WayperTheme.colors.primary} />
      </View>
      <View style={styles.templateTextWrap}>
        <Text style={[styles.templateTitle, selected && styles.templateTitleSelected]}>{title}</Text>
        <Text style={styles.templateSubtitle}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

function ScaledTemplate({ width, height, previewWidth, transparent = false, children }) {
  const scale = previewWidth / width;
  const previewHeight = Math.round(height * scale);
  const left = (previewWidth - width) / 2;
  const top = (previewHeight - height) / 2;

  return (
    <View style={[styles.scaledFrame, transparent && styles.scaledFrameTransparent, { width: previewWidth, height: previewHeight }]}>
      <View
        pointerEvents="none"
        style={[
          styles.scaledContent,
          {
            width,
            height,
            left,
            top,
            transform: [{ scale }],
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function RunShareModal({
  visible,
  onClose,
  run,
  path = [],
  zoneCoords = [],
  isZone = false,
  title,
  subtitle,
  distance,
  duration,
  pace,
  date,
  area,
}) {
  const { width } = useWindowDimensions();
  const imageRef = useRef(null);
  const traceRef = useRef(null);
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATE.image);
  const [busyAction, setBusyAction] = useState(null);

  useEffect(() => {
    if (visible) {
      setSelectedTemplate(TEMPLATE.image);
      setBusyAction(null);
    }
  }, [visible]);

  const shareData = useMemo(() => {
    const durationText = typeof duration === "string" ? duration : formatDuration(duration ?? run?.duration);
    const distanceText = deriveDistance(run, distance);
    const paceText = typeof pace === "string" ? pace : formatPace(pace ?? run?.avgPaceSecondsPerKm ?? run?.pace);
    const areaText = deriveArea(run, area);
    const dateText = typeof date === "string" ? date : formatDate(date ?? run?.date ?? run?.createdAt);
    const runTitle = title || (isZone ? "Wayper Zone" : "Wayper Run");
    const runSubtitle = subtitle || run?.name || run?.title || "Wayper Run";

    return {
      title: runTitle,
      subtitle: runSubtitle,
      distance: distanceText,
      duration: durationText,
      pace: paceText,
      date: dateText,
      area: areaText,
      filenameBase: `wayper-run-${run?.id || run?.runId || Date.now()}`,
    };
  }, [area, date, distance, duration, isZone, pace, run, subtitle, title]);

  const traceAvailability = useMemo(() => {
    const source = getRenderableTraceSource({ path, zoneCoords, isZone });
    const minPoints = source.type === "zone" ? 3 : 2;
    return {
      available: source.points.length >= minPoints,
      points: source.points.length,
      type: source.type,
    };
  }, [isZone, path, zoneCoords]);

  const previewWidth = Math.min(width - 44, 350);
  const isBusy = busyAction !== null;

  const showActionError = useCallback((fallback, error) => {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.log("[WAYPER_SHARE_MODAL_ACTION_ERROR]", {
        code: error?.code,
        message: error?.message,
        stack: error?.stack,
      });
    }
    Alert.alert("Não foi possível concluir", error?.message || fallback);
  }, []);

  const ensureTraceAvailable = useCallback(() => {
    if (traceAvailability.available) return true;
    Alert.alert("Traçado indisponível", "Traçado indisponível para esta corrida.");
    return false;
  }, [traceAvailability.available]);

  const buildImage = useCallback(async () => (
    generateShareImage(imageRef, `${shareData.filenameBase}-imagem`)
  ), [shareData.filenameBase]);

  const buildTrace = useCallback(async () => {
    if (!ensureTraceAvailable()) return null;
    return generateTransparentTracePng(traceRef, `${shareData.filenameBase}-tracado`);
  }, [ensureTraceAvailable, shareData.filenameBase]);

  const runWithBusy = useCallback(async (key, task) => {
    if (busyAction) return;
    setBusyAction(key);
    try {
      await task();
    } finally {
      setBusyAction(null);
    }
  }, [busyAction]);

  const handleImageShare = useCallback((key, dialogTitle) => {
    runWithBusy(key, async () => {
      try {
        const uri = await buildImage();
        await openNativeShare(uri, { dialogTitle });
      } catch (error) {
        showActionError("Não foi possível gerar a imagem para compartilhar.", error);
      }
    });
  }, [buildImage, runWithBusy, showActionError]);

  const handleTraceCopy = useCallback(() => {
    runWithBusy("trace-copy", async () => {
      try {
        const uri = await buildTrace();
        if (!uri) return;
        const result = await copyPngToClipboard(uri, { fallbackShare: true });
        if (result?.ok) {
          Alert.alert("PNG copiado", "PNG copiado para a área de transferência.");
        }
      } catch (error) {
        showActionError("Não foi possível copiar o PNG.", error);
      }
    });
  }, [buildTrace, runWithBusy, showActionError]);

  const handleTraceDownload = useCallback(() => {
    runWithBusy("trace-download", async () => {
      try {
        const uri = await buildTrace();
        if (!uri) return;
        await saveImageToGallery(uri, "Wayper");
        Alert.alert("PNG salvo", "O traçado PNG foi salvo.");
      } catch (error) {
        showActionError("Não foi possível baixar o PNG.", error);
      }
    });
  }, [buildTrace, runWithBusy, showActionError]);

  const handleTraceShare = useCallback((key) => {
    runWithBusy(key, async () => {
      try {
        const uri = await buildTrace();
        if (!uri) return;
        await openNativeShare(uri, { dialogTitle: "Compartilhar traçado Wayper" });
      } catch (error) {
        showActionError("Não foi possível compartilhar o PNG.", error);
      }
    });
  }, [buildTrace, runWithBusy, showActionError]);

  const imagePreview = (
    <ScaledTemplate
      width={RUN_SHARE_CARD_SIZE.card.width}
      height={RUN_SHARE_CARD_SIZE.card.height}
      previewWidth={previewWidth}
    >
      <RunShareImageTemplate
        path={path}
        zoneCoords={zoneCoords}
        isZone={isZone}
        title={shareData.title}
        subtitle={shareData.subtitle}
        distance={shareData.distance}
        duration={shareData.duration}
        pace={shareData.pace}
        date={shareData.date}
        area={shareData.area}
      />
    </ScaledTemplate>
  );

  const tracePreview = (
    <TransparentPreviewBackground style={[styles.tracePreviewBackground, { width: previewWidth, height: previewWidth }]}>
      <ScaledTemplate
        width={RUN_TRACE_PNG_SIZE.width}
        height={RUN_TRACE_PNG_SIZE.height}
        previewWidth={previewWidth}
        transparent
      >
        <RunTracePngTemplate
          path={path}
          zoneCoords={zoneCoords}
          isZone={isZone}
          title={isZone ? "Zona PNG" : "Traçado PNG"}
          distance={shareData.distance}
          duration={shareData.duration}
          pace={shareData.pace}
          area={shareData.area}
        />
      </ScaledTemplate>
    </TransparentPreviewBackground>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            removeClippedSubviews={false}
          >
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.eyebrow}>Wayper share</Text>
                <Text style={styles.title}>Compartilhar corrida</Text>
                <Text style={styles.subtitle}>Escolha o visual para enviar ou baixar.</Text>
              </View>
              <TouchableOpacity activeOpacity={0.84} style={styles.closeButton} onPress={onClose}>
                <Ionicons name="close" size={22} color={WayperTheme.colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.previewShell}>
              <View style={styles.previewHeader}>
                <Text style={styles.previewTitle}>
                  {selectedTemplate === TEMPLATE.image ? "Imagem completa" : "PNG transparente"}
                </Text>
                <Text style={styles.previewHint}>
                  {selectedTemplate === TEMPLATE.image ? "Mapa, traçado e estatísticas" : "Somente traçado e stats"}
                </Text>
              </View>
              <View style={styles.previewBody}>
                {selectedTemplate === TEMPLATE.image ? imagePreview : tracePreview}
              </View>
            </View>

            <View style={styles.tabs}>
              <TemplateTab
                selected={selectedTemplate === TEMPLATE.image}
                title="Imagem"
                subtitle="Mapa + stats"
                icon="image-outline"
                onPress={() => setSelectedTemplate(TEMPLATE.image)}
              />
              <TemplateTab
                selected={selectedTemplate === TEMPLATE.tracePng}
                title="Traçado PNG"
                subtitle="Fundo transparente"
                icon="git-branch-outline"
                onPress={() => setSelectedTemplate(TEMPLATE.tracePng)}
              />
            </View>

            <View style={styles.actionsSection}>
              <Text style={styles.actionsTitle}>
                Ações
              </Text>

              {selectedTemplate === TEMPLATE.image ? (
                <View style={styles.actionsGrid}>
                  <ActionButton
                    icon="share-social-outline"
                    label="Compartilhar imagem"
                    loading={busyAction === "image-share"}
                    disabled={isBusy}
                    primary
                    wide
                    onPress={() => handleImageShare("image-share", "Compartilhar imagem Wayper")}
                  />
                </View>
              ) : (
                <View style={styles.actionsGrid}>
                  <ActionButton
                    icon="share-social-outline"
                    label="Compartilhar"
                    loading={busyAction === "trace-share"}
                    disabled={isBusy || !traceAvailability.available}
                    primary
                    onPress={() => handleTraceShare("trace-share")}
                  />
                  <ActionButton
                    icon="copy-outline"
                    label="Copiar"
                    loading={busyAction === "trace-copy"}
                    disabled={isBusy || !traceAvailability.available}
                    onPress={handleTraceCopy}
                  />
                  <ActionButton
                    icon="download-outline"
                    label="Baixar"
                    loading={busyAction === "trace-download"}
                    disabled={isBusy || !traceAvailability.available}
                    onPress={handleTraceDownload}
                  />
                </View>
              )}

              {selectedTemplate === TEMPLATE.tracePng && !traceAvailability.available ? (
                <Text style={styles.unavailableText}>Traçado indisponível para esta corrida.</Text>
              ) : null}
            </View>
          </ScrollView>

        </View>
        <View pointerEvents="none" style={styles.captureHost}>
          <RunShareImageTemplate
            ref={imageRef}
            path={path}
            zoneCoords={zoneCoords}
            isZone={isZone}
            title={shareData.title}
            subtitle={shareData.subtitle}
            distance={shareData.distance}
            duration={shareData.duration}
            pace={shareData.pace}
            date={shareData.date}
            area={shareData.area}
          />
          <RunTracePngTemplate
            ref={traceRef}
            path={path}
            zoneCoords={zoneCoords}
            isZone={isZone}
            title={isZone ? "Zona PNG" : "Traçado PNG"}
            distance={shareData.distance}
            duration={shareData.duration}
            pace={shareData.pace}
            area={shareData.area}
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
    backgroundColor: "rgba(0, 0, 0, 0.72)",
  },
  sheet: {
    maxHeight: "92%",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: "hidden",
    backgroundColor: WayperTheme.colors.background,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    ...WayperTheme.shadows.greenGlow,
  },
  handle: {
    alignSelf: "center",
    width: 56,
    height: 5,
    borderRadius: 999,
    marginTop: 12,
    backgroundColor: "rgba(244, 247, 245, 0.22)",
  },
  content: {
    padding: 22,
    paddingBottom: 34,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 18,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 28,
    fontWeight: "900",
    marginTop: 4,
  },
  subtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 6,
  },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  previewShell: {
    borderRadius: 26,
    padding: 14,
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  previewHeader: {
    marginBottom: 12,
  },
  previewTitle: {
    color: WayperTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  previewHint: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  previewBody: {
    alignItems: "center",
  },
  scaledFrame: {
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: WayperTheme.colors.background,
  },
  scaledFrameTransparent: {
    backgroundColor: "transparent",
  },
  scaledContent: {
    position: "absolute",
  },
  tracePreviewBackground: {
    borderRadius: 22,
  },
  tabs: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  templateTab: {
    flex: 1,
    minHeight: 76,
    borderRadius: 22,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  templateTabSelected: {
    borderColor: WayperTheme.colors.borderStrong,
    backgroundColor: WayperTheme.colors.primarySoft,
  },
  templateIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  templateIconSelected: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primary,
  },
  templateTextWrap: {
    flex: 1,
  },
  templateTitle: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  templateTitleSelected: {
    color: WayperTheme.colors.primary,
  },
  templateSubtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  actionsSection: {
    marginTop: 18,
  },
  actionsTitle: {
    color: WayperTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 12,
  },
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  actionButton: {
    width: "31.8%",
    minHeight: 96,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  actionButtonWide: {
    width: "100%",
    minHeight: 86,
  },
  actionButtonPrimary: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primary,
  },
  actionButtonDisabled: {
    opacity: 0.52,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    backgroundColor: WayperTheme.colors.surface,
  },
  actionIconPrimary: {
    backgroundColor: "rgba(3, 16, 9, 0.14)",
  },
  actionLabel: {
    color: WayperTheme.colors.text,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  actionLabelPrimary: {
    color: WayperTheme.colors.textInverse,
  },
  unavailableText: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 12,
    textAlign: "center",
  },
  captureHost: {
    position: "absolute",
    left: -12000,
    top: 0,
    width: RUN_SHARE_CARD_SIZE.card.width,
    minHeight: RUN_SHARE_CARD_SIZE.card.height + RUN_TRACE_PNG_SIZE.height + 80,
  },
});

export default RunShareModal;
