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
  cleanupOldShareFiles,
  generateShareImage,
  generateTransparentTracePng,
  getRenderableTraceSource,
  openNativeShare,
  saveImageToGallery,
} from "../../utils/runShareImage";
import {
  RUN_EXPORT_TEMPLATE,
  buildRunExportFilenameBase,
  getRunExportTemplateConfig,
} from "../../utils/runExportImage";
import { getRunDisplayTitle } from "../../utils/runDisplayTitle";
import { createRunStoryFromRun } from "../../repositories/socialHomeRepository";
import { openAppSettings } from "../../services/permissions";
import logger, { LOG_CATEGORIES } from "../../utils/logger";
import RunShareImageTemplate from "./RunShareImageTemplate";
import RunTracePngTemplate, { RUN_TRACE_PNG_SIZE } from "./RunTracePngTemplate";
import TransparentPreviewBackground from "./TransparentPreviewBackground";
import { RUN_SHARE_CARD_SIZE } from "./RunShareCard";

const TEMPLATE = RUN_EXPORT_TEMPLATE;

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

function ActionButton({ icon, label, onPress, loading, disabled, primary = false }) {
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      disabled={disabled || loading}
      style={[
        styles.actionButton,
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

function ShareOption({ icon, title, subtitle, children, actions, footer }) {
  return (
    <View style={styles.optionCard}>
      <View style={styles.optionHeader}>
        <View style={styles.optionIcon}>
          <Ionicons name={icon} size={20} color={WayperTheme.colors.primary} />
        </View>
        <View style={styles.optionText}>
          <Text style={styles.optionTitle}>{title}</Text>
          <Text style={styles.optionSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.optionPreview}>{children}</View>
      <View style={styles.actionsGrid}>{actions}</View>
      {footer}
    </View>
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
  segments = [],
  zoneCoords = [],
  isZone = false,
  title: titleProp,
  subtitle,
  distance,
  duration,
  pace,
  date,
  area,
  mapStyle,
}) {
  const { width } = useWindowDimensions();
  const imageRef = useRef(null);
  const traceRef = useRef(null);
  const [busyAction, setBusyAction] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setBusyAction(null);
    cleanupOldShareFiles().catch(() => null);
  }, [visible]);

  const shareData = useMemo(() => {
    const durationText = typeof duration === "string" ? duration : formatDuration(duration ?? run?.durationSeconds ?? run?.duration);
    const distanceText = deriveDistance(run, distance);
    const paceText = typeof pace === "string" ? pace : formatPace(pace ?? run?.avgPaceSecondsPerKm ?? run?.pace);
    const areaText = deriveArea(run, area);
    const dateText = typeof date === "string" ? date : formatDate(date ?? run?.date ?? run?.finishedAt ?? run?.endedAt ?? run?.createdAt);
    const runTitle = titleProp || getRunDisplayTitle(run);
    const runSubtitle = subtitle && subtitle !== runTitle
      ? subtitle
      : (isZone ? "Corrida por zonas" : "Corrida livre");

    return {
      title: runTitle,
      subtitle: runSubtitle,
      distance: distanceText,
      duration: durationText,
      pace: paceText,
      date: dateText,
      area: areaText,
    };
  }, [area, date, distance, duration, isZone, pace, run, subtitle, titleProp]);

  const traceAvailability = useMemo(() => {
    const source = getRenderableTraceSource({ path, segments, zoneCoords, isZone });
    const minPoints = source.type === "zone" ? 3 : 2;
    return {
      available: source.points.length >= minPoints,
      points: source.points.length,
      type: source.type,
    };
  }, [isZone, path, segments, zoneCoords]);

  const previewWidth = Math.min(width - 44, 350);
  const isBusy = busyAction !== null;

  const getExportFilenameBase = useCallback((template) => (
    buildRunExportFilenameBase({
      template,
      run,
      date: date ?? run?.date ?? run?.endedAt ?? run?.finishedAt ?? run?.createdAt,
      fallbackTitle: isZone ? "corrida-zonas" : "corrida-livre",
    })
  ), [date, isZone, run]);

  const showActionError = useCallback((fallback, error) => {
    logger.warn(LOG_CATEGORIES.SHARE, "WAYPER_SHARE_MODAL_ACTION_ERROR", {
      code: error?.code,
      error,
    }, { forcePersist: true });

    if (error?.code === "MEDIA_PERMISSION_DENIED") {
      Alert.alert(
        "Permissao de midia",
        error?.message || fallback,
        [
          { text: "Compartilhar depois", style: "cancel" },
          { text: "Abrir configuracoes", onPress: () => openAppSettings?.() },
        ]
      );
      return;
    }

    Alert.alert("Nao foi possivel concluir", error?.message || fallback);
  }, []);

  const ensureTraceAvailable = useCallback(() => {
    if (traceAvailability.available) return true;
    Alert.alert("Tracado indisponivel", "Tracado indisponivel para esta corrida.");
    return false;
  }, [traceAvailability.available]);

  const buildImage = useCallback(async () => (
    generateShareImage(imageRef, getExportFilenameBase(TEMPLATE.image), { waitMs: 1400 })
  ), [getExportFilenameBase]);

  const buildTrace = useCallback(async () => {
    if (!ensureTraceAvailable()) return null;
    return generateTransparentTracePng(traceRef, getExportFilenameBase(TEMPLATE.tracePng));
  }, [ensureTraceAvailable, getExportFilenameBase]);

  const runWithBusy = useCallback(async (key, task) => {
    if (busyAction) return;
    setBusyAction(key);
    try {
      await task();
    } finally {
      setBusyAction(null);
    }
  }, [busyAction]);

  const buildStoryMedia = useCallback((kind, uri, template) => ({
    type: kind === "trace" ? "trace_png" : "share_image",
    kind,
    uri,
    mimeType: "image/png",
    source: "local",
    filenameBase: getExportFilenameBase(template),
    createdAt: new Date().toISOString(),
  }), [getExportFilenameBase]);

  const assertStoryCreated = (result) => {
    if (result?.duplicate) return "duplicate";
    if (result?.data) return "created";
    const error = result?.error || new Error(result?.code || "story_not_created");
    if (result?.code && !error.code) error.code = result.code;
    throw error;
  };

  const handleImageShare = useCallback(() => {
    runWithBusy("image-share", async () => {
      try {
        const uri = await buildImage();
        await openNativeShare(uri, { dialogTitle: getRunExportTemplateConfig(TEMPLATE.image).dialogTitle });
      } catch (error) {
        showActionError("Nao foi possivel gerar a imagem para compartilhar.", error);
      }
    });
  }, [buildImage, runWithBusy, showActionError]);

  const handleImageDownload = useCallback(() => {
    runWithBusy("image-download", async () => {
      try {
        const uri = await buildImage();
        await saveImageToGallery(uri, "Wayper");
        Alert.alert("Imagem salva", getRunExportTemplateConfig(TEMPLATE.image).successMessage);
      } catch (error) {
        showActionError("Nao foi possivel baixar a imagem.", error);
      }
    });
  }, [buildImage, runWithBusy, showActionError]);

  const handleImageStory = useCallback(() => {
    runWithBusy("image-story", async () => {
      try {
        const uri = await buildImage();
        const status = assertStoryCreated(await createRunStoryFromRun(run, {
          media: buildStoryMedia("image", uri, TEMPLATE.image),
        }));
        if (status === "duplicate") {
          Alert.alert("Story ja existe", "Essa corrida ja esta no seu story local.");
          return;
        }
        Alert.alert("Story adicionado", "Story salvo localmente com sync pendente.");
      } catch (error) {
        const message = error?.code === "RUN_NOT_FINISHED" || error?.message === "run_not_finished"
          ? "Apenas corridas finalizadas podem virar story."
          : "Nao foi possivel adicionar esta corrida ao story.";
        showActionError(message, error);
      }
    });
  }, [buildImage, buildStoryMedia, run, runWithBusy, showActionError]);

  const handleTraceShare = useCallback(() => {
    runWithBusy("trace-share", async () => {
      try {
        const uri = await buildTrace();
        if (!uri) return;
        await openNativeShare(uri, { dialogTitle: getRunExportTemplateConfig(TEMPLATE.tracePng).dialogTitle });
      } catch (error) {
        showActionError("Nao foi possivel compartilhar o PNG.", error);
      }
    });
  }, [buildTrace, runWithBusy, showActionError]);

  const handleTraceDownload = useCallback(() => {
    runWithBusy("trace-download", async () => {
      try {
        const uri = await buildTrace();
        if (!uri) return;
        await saveImageToGallery(uri, "Wayper");
        Alert.alert("PNG salvo", getRunExportTemplateConfig(TEMPLATE.tracePng).successMessage);
      } catch (error) {
        showActionError("Nao foi possivel baixar o PNG.", error);
      }
    });
  }, [buildTrace, runWithBusy, showActionError]);

  const handleTraceStory = useCallback(() => {
    runWithBusy("trace-story", async () => {
      try {
        const uri = await buildTrace();
        if (!uri) return;
        const status = assertStoryCreated(await createRunStoryFromRun(run, {
          media: buildStoryMedia("trace", uri, TEMPLATE.tracePng),
          type: "run_trace_png",
        }));
        if (status === "duplicate") {
          Alert.alert("Story ja existe", "Essa corrida ja esta no seu story local.");
          return;
        }
        Alert.alert("Story adicionado", "Tracado salvo no story local com sync pendente.");
      } catch (error) {
        const message = error?.code === "RUN_NOT_FINISHED" || error?.message === "run_not_finished"
          ? "Apenas corridas finalizadas podem virar story."
          : "Nao foi possivel adicionar o tracado ao story.";
        showActionError(message, error);
      }
    });
  }, [buildStoryMedia, buildTrace, run, runWithBusy, showActionError]);

  const imagePreview = (
    <ScaledTemplate
      width={RUN_SHARE_CARD_SIZE.card.width}
      height={RUN_SHARE_CARD_SIZE.card.height}
      previewWidth={previewWidth}
    >
      <RunShareImageTemplate
        path={path}
        segments={segments}
        zoneCoords={zoneCoords}
        isZone={isZone}
        title={shareData.title}
        subtitle={shareData.subtitle}
        distance={shareData.distance}
        duration={shareData.duration}
        pace={shareData.pace}
        date={shareData.date}
        area={shareData.area}
        mapStyle={mapStyle}
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
          segments={segments}
          zoneCoords={zoneCoords}
          isZone={isZone}
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
                <Text style={styles.subtitle}>Escolha imagem completa ou tracado transparente.</Text>
              </View>
              <TouchableOpacity activeOpacity={0.84} style={styles.closeButton} onPress={onClose}>
                <Ionicons name="close" size={22} color={WayperTheme.colors.text} />
              </TouchableOpacity>
            </View>

            <ShareOption
              icon="image-outline"
              title="Imagem"
              subtitle="Mapa, rota e estatisticas da corrida."
              actions={(
                <>
                  <ActionButton
                    icon="share-social-outline"
                    label={busyAction === "image-share" ? "Compartilhando..." : "Compartilhar"}
                    loading={busyAction === "image-share"}
                    disabled={isBusy}
                    primary
                    onPress={handleImageShare}
                  />
                  <ActionButton
                    icon="download-outline"
                    label={busyAction === "image-download" ? "Baixando..." : "Baixar imagem"}
                    loading={busyAction === "image-download"}
                    disabled={isBusy}
                    onPress={handleImageDownload}
                  />
                  <ActionButton
                    icon="add-circle-outline"
                    label={busyAction === "image-story" ? "Adicionando..." : "Adicionar ao story"}
                    loading={busyAction === "image-story"}
                    disabled={isBusy}
                    onPress={handleImageStory}
                  />
                </>
              )}
            >
              {imagePreview}
            </ShareOption>

            <ShareOption
              icon="git-branch-outline"
              title="Tracado PNG"
              subtitle="PNG transparente apenas com a rota ou zona."
              actions={(
                <>
                  <ActionButton
                    icon="share-social-outline"
                    label={busyAction === "trace-share" ? "Compartilhando..." : "Compartilhar PNG"}
                    loading={busyAction === "trace-share"}
                    disabled={isBusy || !traceAvailability.available}
                    primary
                    onPress={handleTraceShare}
                  />
                  <ActionButton
                    icon="download-outline"
                    label={busyAction === "trace-download" ? "Baixando..." : "Baixar PNG"}
                    loading={busyAction === "trace-download"}
                    disabled={isBusy || !traceAvailability.available}
                    onPress={handleTraceDownload}
                  />
                  <ActionButton
                    icon="add-circle-outline"
                    label={busyAction === "trace-story" ? "Adicionando..." : "Adicionar ao story"}
                    loading={busyAction === "trace-story"}
                    disabled={isBusy || !traceAvailability.available}
                    onPress={handleTraceStory}
                  />
                </>
              )}
              footer={!traceAvailability.available ? (
                <Text style={styles.unavailableText}>Tracado indisponivel para esta corrida.</Text>
              ) : null}
            >
              {tracePreview}
            </ShareOption>
          </ScrollView>
        </View>
        <View pointerEvents="none" style={styles.captureHost}>
          <RunShareImageTemplate
            ref={imageRef}
            path={path}
            segments={segments}
            zoneCoords={zoneCoords}
            isZone={isZone}
            title={shareData.title}
            subtitle={shareData.subtitle}
            distance={shareData.distance}
            duration={shareData.duration}
            pace={shareData.pace}
            date={shareData.date}
            area={shareData.area}
            mapStyle={mapStyle}
          />
          <RunTracePngTemplate
            ref={traceRef}
            path={path}
            segments={segments}
            zoneCoords={zoneCoords}
            isZone={isZone}
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
    gap: 18,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
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
  optionCard: {
    borderRadius: 26,
    padding: 14,
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  optionHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    color: WayperTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  optionSubtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  optionPreview: {
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
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    minWidth: 120,
    minHeight: 86,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
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
