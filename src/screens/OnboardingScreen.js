import React, { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { WayperTheme } from "../theme/wayperTheme";
import { completeOnboarding } from "../services/onboarding/onboardingService";

const BRAND_LOGO = require("../../assets/logo.png");

const STEPS = [
  {
    icon: "map-outline",
    title: "Corra no mapa real",
    text: "O Wayper registra corridas e caminhadas reais para transformar rota em progresso.",
  },
  {
    icon: "flag-outline",
    title: "Conquiste territorio",
    text: "Corridas por zonas podem virar area conquistada quando a rota tiver dados suficientes.",
  },
  {
    icon: "people-outline",
    title: "Compita com amigos",
    text: "Stories, feed e ranking mostram dados reais, cacheados ou locais. Demo nao aparece como dado real.",
  },
  {
    icon: "cloud-offline-outline",
    title: "Funciona offline",
    text: "Corridas ficam preservadas no aparelho e sincronizam depois quando o remoto estiver disponivel.",
  },
];

const PERMISSIONS = [
  {
    icon: "location-outline",
    title: "Localizacao em primeiro plano",
    text: "Obrigatoria para iniciar corrida e calcular distancia, ritmo e rota.",
  },
  {
    icon: "phone-portrait-outline",
    title: "Localizacao em segundo plano",
    text: "Pedida apenas na experiencia de corrida. Sem ela, tela bloqueada pode ficar limitada.",
  },
  {
    icon: "notifications-outline",
    title: "Notificacao da corrida",
    text: "Ajuda a controlar pausa e retomada no Android. Se negar, a corrida ainda pode seguir no app.",
  },
];

export default function OnboardingScreen({ onComplete }) {
  const [saving, setSaving] = useState(false);
  const year = useMemo(() => new Date().getFullYear(), []);

  const finish = async () => {
    if (saving) return;
    setSaving(true);
    await completeOnboarding();
    onComplete?.();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient
        colors={["rgba(0,230,118,0.20)", "rgba(56,217,255,0.08)", WayperTheme.colors.background]}
        style={styles.hero}
      >
        <View style={styles.logoShell}>
          <Image source={BRAND_LOGO} style={styles.logo} resizeMode="contain" />
        </View>
        <Text style={styles.brand}>Wayper</Text>
        <Text style={styles.title}>Seu mapa vira progresso</Text>
        <Text style={styles.subtitle}>
          Registre corridas reais, conquiste zonas, compartilhe stories e continue seguro mesmo sem internet.
        </Text>
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.grid}>
          {STEPS.map((item) => (
            <View key={item.title} style={styles.featureCard}>
              <View style={styles.iconWrap}>
                <Ionicons name={item.icon} size={21} color={WayperTheme.colors.primary} />
              </View>
              <Text style={styles.featureTitle}>{item.title}</Text>
              <Text style={styles.featureText}>{item.text}</Text>
            </View>
          ))}
        </View>

        <View style={styles.permissionPanel}>
          <Text style={styles.panelTitle}>Permissoes no momento certo</Text>
          <Text style={styles.panelText}>
            O onboarding explica. O pedido nativo aparece so quando voce entra na corrida, inicia uma sessao ou usa galeria.
          </Text>
          {PERMISSIONS.map((item) => (
            <View key={item.title} style={styles.permissionRow}>
              <View style={styles.permissionIcon}>
                <Ionicons name={item.icon} size={18} color={WayperTheme.colors.cyan} />
              </View>
              <View style={styles.permissionCopy}>
                <Text style={styles.permissionTitle}>{item.title}</Text>
                <Text style={styles.permissionText}>{item.text}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.footerNote}>
          <Ionicons name="shield-checkmark-outline" size={17} color={WayperTheme.colors.primary} />
          <Text style={styles.footerText}>
            {year} - dados locais preservados primeiro. Firestore entra como sync posterior.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable style={[styles.primaryButton, saving && styles.primaryButtonDisabled]} onPress={finish}>
          <Text style={styles.primaryButtonText}>{saving ? "Entrando..." : "Comecar"}</Text>
          <Ionicons name="arrow-forward" size={19} color={WayperTheme.colors.textInverse} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
  },
  hero: {
    paddingHorizontal: WayperTheme.spacing.page,
    paddingTop: WayperTheme.spacing.xl,
    paddingBottom: WayperTheme.spacing.xl,
    alignItems: "center",
  },
  logoShell: {
    width: 104,
    height: 104,
    borderRadius: WayperTheme.radius.xxl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  logo: {
    width: 78,
    height: 78,
    borderRadius: 18,
  },
  brand: {
    marginTop: WayperTheme.spacing.md,
    color: WayperTheme.colors.primary,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    marginTop: WayperTheme.spacing.xs,
    color: WayperTheme.colors.text,
    fontSize: 29,
    lineHeight: 35,
    fontWeight: "900",
    textAlign: "center",
  },
  subtitle: {
    marginTop: WayperTheme.spacing.sm,
    color: WayperTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  content: {
    paddingBottom: 120,
  },
  grid: {
    paddingHorizontal: WayperTheme.spacing.page,
    gap: WayperTheme.spacing.md,
  },
  featureCard: {
    minHeight: 112,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    padding: WayperTheme.spacing.lg,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  featureTitle: {
    marginTop: WayperTheme.spacing.md,
    color: WayperTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  featureText: {
    marginTop: WayperTheme.spacing.xs,
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  permissionPanel: {
    marginTop: WayperTheme.spacing.xl,
    marginHorizontal: WayperTheme.spacing.page,
    padding: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surface,
    borderWidth: 1,
    borderColor: WayperTheme.colors.cyanBorder,
  },
  panelTitle: {
    color: WayperTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  panelText: {
    marginTop: WayperTheme.spacing.xs,
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  permissionRow: {
    flexDirection: "row",
    gap: WayperTheme.spacing.md,
    marginTop: WayperTheme.spacing.lg,
  },
  permissionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.cyanSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.cyanBorder,
  },
  permissionCopy: {
    flex: 1,
    minWidth: 0,
  },
  permissionTitle: {
    color: WayperTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  permissionText: {
    marginTop: 3,
    color: WayperTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  footerNote: {
    marginHorizontal: WayperTheme.spacing.page,
    marginTop: WayperTheme.spacing.xl,
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    alignItems: "center",
  },
  footerText: {
    flex: 1,
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: WayperTheme.spacing.page,
    backgroundColor: "rgba(3, 8, 11, 0.96)",
    borderTopWidth: 1,
    borderTopColor: WayperTheme.colors.border,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: WayperTheme.spacing.sm,
  },
  primaryButtonDisabled: {
    opacity: 0.72,
  },
  primaryButtonText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 16,
    fontWeight: "900",
  },
});
