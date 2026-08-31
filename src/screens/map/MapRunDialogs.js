import React from "react";
import { Animated, Modal, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import RunSummaryModal from "../../components/Runs/RunSummaryModal";
import PermissionNotice from "../../components/permissions/PermissionNotice";
import { WayperTheme } from "../../theme/wayperTheme";
import styles from "./MapScreen.styles.js";

export default function MapRunDialogs({ model }) {
  const {
    summaryVisible, currentRunData, captureResult, closeSummary, saveRunSummary,
    selectModeVisible, isRunStartBusy, closeMode, startWithCountdown,
    permissionVisible, closePermission, locationPermission, requestLocation,
    limitationNotice, closeLimitation, requestLimitation, counting, countdown,
    startAuraOpacity, startPulseScale,
  } = model;
  return (
    <>
      <RunSummaryModal
        visible={summaryVisible}
        baseRunData={currentRunData}
        captureResult={captureResult}
        onClose={closeSummary}
        onSave={saveRunSummary}
      />

      <Modal visible={selectModeVisible} transparent animationType="fade">
        <View style={styles.modeOverlay}>
          <View style={styles.modeBox}>
            <View style={styles.modeHandle} />
            <View style={styles.modeHeaderRow}>
              <View style={styles.modeIconWrap}>
                <Ionicons name="flash-outline" size={25} color={WayperTheme.colors.primary} />
              </View>
              <View style={styles.modeTitleWrap}>
                <Text style={styles.modeEyebrow}>Wayper run</Text>
                <Text style={styles.modeTitle}>Tipo de corrida</Text>
              </View>
            </View>
            <TouchableOpacity activeOpacity={0.9} disabled={isRunStartBusy}
              style={[styles.modeOption, isRunStartBusy && styles.modeOptionDisabled]}
              onPress={() => { closeMode(); startWithCountdown("free"); }}>
              <View style={styles.modeOptionIcon}>
                <Ionicons name="walk-outline" size={23} color={WayperTheme.colors.textInverse} />
              </View>
              <View style={styles.modeOptionTextWrap}>
                <Text style={styles.modeOptionTitle}>Corrida Livre</Text>
                <Text style={styles.modeOptionSubtitle}>Registre percurso, tempo e distância.</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={WayperTheme.colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.9} disabled={isRunStartBusy}
              style={[styles.modeOption, styles.modeOptionSecondary,
                isRunStartBusy && styles.modeOptionDisabled]}
              onPress={() => { closeMode(); startWithCountdown("zones"); }}>
              <View style={[styles.modeOptionIcon, styles.modeOptionIconSecondary]}>
                <Ionicons name="map-outline" size={23} color={WayperTheme.colors.primary} />
              </View>
              <View style={styles.modeOptionTextWrap}>
                <Text style={[styles.modeOptionTitle, styles.modeOptionSecondaryTitle]}>Capturar Zonas</Text>
                <Text style={[styles.modeOptionSubtitle, styles.modeOptionSecondarySubtitle]}>
                  Transforme seu trajeto em área conquistada.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={WayperTheme.colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.85} style={styles.cancelBtn} onPress={closeMode}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={permissionVisible} transparent animationType="fade" onRequestClose={closePermission}>
        <View style={styles.permissionOverlay}>
          <PermissionNotice
            permissionType="location"
            required
            title="Permissão de localização necessária"
            description="O Wayper precisa da sua localização para registrar sua rota, calcular distância, ritmo e conquistar zonas no mapa."
            status={locationPermission?.status}
            canAskAgain={locationPermission?.canAskAgain !== false}
            primaryAction={{
              label: locationPermission?.canAskAgain === false ? "Abrir configurações" : "Permitir localização",
              onPress: requestLocation,
            }}
            secondaryAction={{ label: "Voltar", onPress: closePermission }}
            style={styles.permissionNoticeModal}
          />
        </View>
      </Modal>

      <Modal visible={Boolean(limitationNotice)} transparent animationType="fade" onRequestClose={closeLimitation}>
        <View style={styles.permissionOverlay}>
          <PermissionNotice
            permissionType={limitationNotice?.type === "notification" ? "notification" : "background"}
            required={false}
            title={limitationNotice?.title || "Corrida com limitacao"}
            description={limitationNotice?.description ||
              "A corrida continua preservada no aparelho, mas este recurso pode ficar limitado."}
            status={limitationNotice?.status}
            canAskAgain={limitationNotice?.canAskAgain !== false}
            primaryAction={{
              label: limitationNotice?.canAskAgain === false ? "Abrir configuracoes" : "Permitir agora",
              onPress: requestLimitation,
            }}
            secondaryAction={{ label: "Continuar no app", onPress: closeLimitation }}
            style={styles.permissionNoticeModal}
          />
        </View>
      </Modal>

      {counting ? (
        <View style={styles.countdownOverlay}>
          <LinearGradient pointerEvents="none"
            colors={["rgba(0,230,118,0.10)", "rgba(3,7,11,0.86)", "rgba(3,7,11,0.94)"]}
            style={styles.countdownBackdrop} />
          <Animated.View style={[styles.countdownAura,
            { opacity: startAuraOpacity, transform: [{ scale: startPulseScale }] }]} />
          <Animated.View style={[styles.countdownBox, { transform: [{ scale: startPulseScale }] }]}>
            <View style={styles.countdownRingOuter}>
              <View style={styles.countdownRingMiddle}>
                <View style={styles.countdownRingInner}>
                  <Text style={styles.countdownLabel}>{countdown > 0 ? "Prepare-se" : "Agora"}</Text>
                  <Text style={styles.countdownNumber}>{countdown > 0 ? countdown : "VAI"}</Text>
                  <Text style={styles.countdownHint}>GPS ativo • Wayper Run</Text>
                </View>
              </View>
            </View>
          </Animated.View>
        </View>
      ) : null}
    </>
  );
}
