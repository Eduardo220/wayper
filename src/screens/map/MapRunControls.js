import React from "react";
import { ActivityIndicator, Animated, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import PermissionNotice from "../../components/permissions/PermissionNotice";
import { WPButton } from "../../components/ui";
import { WayperTheme } from "../../theme/wayperTheme";
import formatTime from "../../utils/formatTime";
import styles from "./MapScreen.styles.js";

const HIT_SLOP = { top: 12, right: 12, bottom: 12, left: 12 };

export default function MapRunControls({ model }) {
  const {
    running, replaying, paused, mode, timeSec, distanceState, gpsQualityWarning,
    emergencyDiagnosticsLoading, onDiagnosticsPress, onDiagnosticsLongPress,
    runtimeRecovering, isFinishingRun, permissionDenied, locationPermission,
    onRequestLocation, startAuraOpacity, startPulseScale, startPressAnim, startPulseAnim,
    isRunStartBusy, openStartModal, onStartPressIn, onStartPressOut, isStartingRun,
    counting, openZonesPanel, pauseRun, resumeRun, stopRun, replaySpeedOptions,
    replaySpeed, setReplayPlaybackSpeed, stopReplay,
  } = model;

  return (
    <>
      {(running || replaying) ? (
        <View pointerEvents="box-none" style={[styles.runPanel, paused && styles.runPanelPaused]}>
          <View pointerEvents="none" style={styles.runPanelGlow} />
          <View style={styles.runHeaderRow}>
            <View style={styles.runTitleBlock}>
              <Text style={styles.runEyebrow}>{paused ? "Pausada" : running ? "Wayper live" : "Replay"}</Text>
              <Text style={styles.runTitle}>
                {running ? (mode === "zones" ? "Capturando Zonas" : "Corrida Livre") : "Reproduzindo"}
              </Text>
            </View>
            <View style={styles.runStatusActions}>
              {running ? (
                <TouchableOpacity
                  testID="emergency-diagnostics-button"
                  activeOpacity={0.86}
                  disabled={emergencyDiagnosticsLoading}
                  hitSlop={HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel="Exportar diagnostico da corrida"
                  style={[
                    styles.emergencyDiagnosticsButton,
                    emergencyDiagnosticsLoading && styles.emergencyDiagnosticsButtonBusy,
                  ]}
                  onPress={onDiagnosticsPress}
                  onLongPress={onDiagnosticsLongPress}
                >
                  {emergencyDiagnosticsLoading ? (
                    <ActivityIndicator size="small" color={WayperTheme.colors.text} />
                  ) : (
                    <Ionicons name="document-text-outline" size={16} color={WayperTheme.colors.text} />
                  )}
                  <Text style={styles.emergencyDiagnosticsText}>
                    {emergencyDiagnosticsLoading ? "Exportando" : "Diagnostico"}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <View style={[styles.runStatusPill, paused && styles.runStatusPillPaused]}>
                <View style={[styles.runStatusDot, paused && styles.runStatusDotPaused]} />
                <Text style={styles.runStatusText}>{paused ? "Pausa" : running ? "Ativa" : "Replay"}</Text>
              </View>
            </View>
          </View>
          <View style={styles.runMetricsRow}>
            <View style={styles.runMetricCard}>
              <View style={styles.runMetricIconWrap}>
                <Ionicons name="time-outline" size={17} color={WayperTheme.colors.primary} />
              </View>
              <Text style={styles.runLabel}>Tempo</Text>
              <Text style={styles.runValue}>{formatTime(timeSec)}</Text>
            </View>
            <View style={styles.runMetricCard}>
              <View style={styles.runMetricIconWrap}>
                <Ionicons name="navigate-outline" size={17} color={WayperTheme.colors.primary} />
              </View>
              <Text style={styles.runLabel}>Distância</Text>
              <Text style={styles.runValue}>{(distanceState / 1000).toFixed(2)} km</Text>
            </View>
          </View>
          {paused ? (
            <View style={styles.pausedNotice}>
              <Ionicons name="pause-circle" size={16} color={WayperTheme.colors.warning} />
              <Text style={styles.pausedNoticeText}>GPS pausado. Toque em Retomar para continuar.</Text>
            </View>
          ) : null}
          {running && !paused && gpsQualityWarning ? (
            <View style={styles.gpsNotice}>
              <Ionicons name="warning-outline" size={16} color={WayperTheme.colors.warning} />
              <Text style={styles.gpsNoticeText}>{gpsQualityWarning}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {!running && !replaying && !runtimeRecovering && !isFinishingRun ? (
        <View style={styles.menuPanel}>
          <View pointerEvents="none" style={styles.menuTopGlow} />
          {permissionDenied ? (
            <PermissionNotice
              compact
              permissionType="location"
              required={false}
              title="Mapa sem sua localização"
              description="Você pode explorar o mapa, mas precisa permitir localização para iniciar uma corrida real."
              status={locationPermission?.status}
              canAskAgain={locationPermission?.canAskAgain !== false}
              primaryAction={{
                label: locationPermission?.canAskAgain === false ? "Abrir configurações" : "Ativar localização",
                onPress: onRequestLocation,
              }}
              style={styles.mapPermissionNotice}
            />
          ) : null}
          <Animated.View pointerEvents="none" style={[
            styles.startButtonAura,
            { opacity: startAuraOpacity, transform: [{ scale: startPulseScale }] },
          ]} />
          <Animated.View style={{ transform: [{ scale: startPulseScale }] }}>
            <Animated.View style={{ transform: [{ scale: startPressAnim }] }}>
              <TouchableOpacity
                activeOpacity={0.94}
                disabled={isRunStartBusy}
                style={[styles.startMainBtn, isRunStartBusy && styles.startMainBtnDisabled]}
                onPress={openStartModal}
                onPressIn={onStartPressIn}
                onPressOut={onStartPressOut}
              >
                <Animated.View pointerEvents="none" style={[
                  styles.startMainBtnHighlight,
                  {
                    opacity: startAuraOpacity,
                    transform: [
                      { translateX: startPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [-150, 260] }) },
                      { rotate: "18deg" },
                    ],
                  },
                ]} />
                <View pointerEvents="none" style={styles.startMainBtnGloss} />
                <View style={styles.startMainBtnContent}>
                  <Text style={styles.startMainBtnTxt}>
                    {isFinishingRun ? "Finalizando..." : isStartingRun || counting ? "Iniciando..." : "Iniciar Corrida"}
                  </Text>
                  <View style={styles.startChevronCircle}>
                    <Ionicons name="chevron-forward" size={27} color={WayperTheme.colors.text} />
                  </View>
                </View>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>
          <TouchableOpacity activeOpacity={0.9} style={styles.viewZonesButton} onPress={() => openZonesPanel("mine")}>
            <Ionicons name="layers-outline" size={20} color={WayperTheme.colors.primary} />
            <Text style={styles.viewZonesButtonText}>Ver zonas</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {running ? (
        <View pointerEvents="box-none" style={styles.runActionDock}>
          <View pointerEvents="none" style={styles.runActionDockGlow} />
          <TouchableOpacity
            activeOpacity={0.9}
            hitSlop={HIT_SLOP}
            style={[styles.runControlButton, paused ? styles.resumeControlButton : styles.pauseControlButton]}
            onPress={paused ? resumeRun : pauseRun}
          >
            <Ionicons name={paused ? "play" : "pause"} size={21}
              color={paused ? WayperTheme.colors.textInverse : WayperTheme.colors.primary} />
            <Text style={[styles.runControlText, paused && styles.resumeControlText]}>
              {paused ? "Retomar" : "Pausar"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.9} hitSlop={HIT_SLOP}
            style={[styles.runControlButton, styles.finishControlButton]} onPress={stopRun}>
            <Ionicons name="stop" size={20} color={WayperTheme.colors.text} />
            <Text style={[styles.runControlText, styles.finishControlText]}>Finalizar</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {replaying ? (
        <View style={styles.replayDock}>
          <View pointerEvents="none" style={styles.runActionDockGlow} />
          <View style={styles.replaySpeedRow}>
            {replaySpeedOptions.map((speed) => {
              const selected = replaySpeed === speed;
              return (
                <TouchableOpacity key={`replay-speed-${speed}`} activeOpacity={0.88}
                  style={[styles.replaySpeedButton, selected && styles.replaySpeedButtonActive]}
                  onPress={() => setReplayPlaybackSpeed(speed)}>
                  <Text style={[styles.replaySpeedText, selected && styles.replaySpeedTextActive]}>{speed}x</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <WPButton title="Parar reproducao" variant="danger"
            icon={<Ionicons name="stop-circle-outline" size={20} color={WayperTheme.colors.text} />}
            onPress={stopReplay} style={styles.bottomAction} />
        </View>
      ) : null}
    </>
  );
}
