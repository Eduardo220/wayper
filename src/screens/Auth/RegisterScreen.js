import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { signUpEmail } from "../../services/auth/authService";
import { WayperTheme } from "../../theme/wayperTheme";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BRAND_LOGO = require("../../../assets/logo.png");

function isPasswordStrong(password) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}

function AuthInput({
  icon,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize = "none",
  textContentType,
  returnKeyType,
  onSubmitEditing,
  right,
}) {
  return (
    <View style={styles.inputShell}>
      <Ionicons name={icon} size={19} color={WayperTheme.colors.primary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={WayperTheme.colors.textSubtle}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        textContentType={textContentType}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        style={styles.input}
      />
      {right}
    </View>
  );
}

function StrengthPill({ active, label }) {
  return (
    <View style={[styles.strengthPill, active && styles.strengthPillActive]}>
      <Text style={[styles.strengthText, active && styles.strengthTextActive]}>{label}</Text>
    </View>
  );
}

export default function RegisterScreen({ navigation }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();
  const pass = password.trim();
  const confirm = confirmPassword.trim();

  const hasMinLength = pass.length >= 8;
  const hasLetter = /[A-Za-z]/.test(pass);
  const hasNumber = /[0-9]/.test(pass);

  const canSubmit = useMemo(() => {
    return (
      cleanUsername.length >= 3 &&
      EMAIL_REGEX.test(cleanEmail) &&
      isPasswordStrong(pass) &&
      pass === confirm
    );
  }, [cleanEmail, cleanUsername.length, confirm, pass]);

  const handleRegister = useCallback(async () => {
    if (loading) return;

    if (!cleanUsername || !cleanEmail || !pass || !confirm) {
      setError("Preencha todos os campos.");
      return;
    }

    if (cleanUsername.length < 3) {
      setError("Use um nome de atleta com pelo menos 3 caracteres.");
      return;
    }

    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError("Digite um email valido.");
      return;
    }

    if (pass !== confirm) {
      setError("As senhas nao coincidem.");
      return;
    }

    if (!isPasswordStrong(pass)) {
      setError("Use ao menos 8 caracteres, com letras e numeros.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      Keyboard.dismiss();

      await signUpEmail(cleanEmail, pass, cleanUsername);

      Alert.alert("Conta criada", "Seu perfil Wayper esta pronto.", [
        { text: "Comecar", onPress: () => navigation.replace("Main") },
      ]);
    } catch (err) {
      setError(err?.message || "Nao foi possivel criar a conta. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [cleanEmail, cleanUsername, confirm, loading, navigation, pass]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <LinearGradient
        colors={[WayperTheme.colors.background, WayperTheme.colors.backgroundAlt, WayperTheme.colors.surface]}
        style={styles.background}
      >
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.topRow}>
            <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
              <Ionicons name="chevron-back" size={24} color={WayperTheme.colors.text} />
            </Pressable>

            <View style={styles.brandMini}>
              <Image source={BRAND_LOGO} style={styles.logoMini} resizeMode="contain" />
              <Text style={styles.brandMiniText}>Wayper</Text>
            </View>
          </View>

          <LinearGradient
            colors={["rgba(0,230,118,0.16)", "rgba(56,217,255,0.07)", WayperTheme.colors.surfaceElevated]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.card}
          >
            <View style={styles.cardHeader}>
              <View style={styles.cardIcon}>
                <Ionicons name="rocket-outline" size={24} color={WayperTheme.colors.primary} />
              </View>
              <View style={styles.cardTitleWrap}>
                <Text style={styles.eyebrow}>Nova jornada</Text>
                <Text style={styles.title}>Criar conta</Text>
              </View>
            </View>

            <Text style={styles.subtitle}>
              Crie seu perfil para salvar corridas, capturar zonas e participar de grupos.
            </Text>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color={WayperTheme.colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>Nome de atleta</Text>
            <AuthInput
              icon="person-outline"
              value={username}
              onChangeText={setUsername}
              placeholder="Ex: Parkew"
              textContentType="nickname"
              returnKeyType="next"
              autoCapitalize="words"
            />

            <Text style={styles.label}>Email</Text>
            <AuthInput
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="voce@email.com"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
            />

            <Text style={styles.label}>Senha</Text>
            <AuthInput
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              placeholder="Minimo 8 caracteres"
              secureTextEntry={!showPassword}
              textContentType="newPassword"
              returnKeyType="next"
              right={
                <Pressable
                  onPress={() => setShowPassword((current) => !current)}
                  style={styles.eyeButton}
                >
                  <Feather
                    name={showPassword ? "eye-off" : "eye"}
                    size={19}
                    color={WayperTheme.colors.textMuted}
                  />
                </Pressable>
              }
            />

            <View style={styles.strengthRow}>
              <StrengthPill active={hasMinLength} label="8+" />
              <StrengthPill active={hasLetter} label="Letra" />
              <StrengthPill active={hasNumber} label="Numero" />
            </View>

            <Text style={styles.label}>Confirmar senha</Text>
            <AuthInput
              icon="shield-checkmark-outline"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Repita sua senha"
              secureTextEntry={!showPassword}
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={handleRegister}
            />

            <TouchableOpacity
              activeOpacity={0.86}
              style={[styles.primaryButton, (!canSubmit || loading) && styles.disabledButton]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={WayperTheme.colors.textInverse} />
              ) : (
                <>
                  <Ionicons name="person-add-outline" size={20} color={WayperTheme.colors.textInverse} />
                  <Text style={styles.primaryButtonText}>Criar conta</Text>
                </>
              )}
            </TouchableOpacity>
          </LinearGradient>

          <TouchableOpacity
            activeOpacity={0.86}
            onPress={() => navigation.goBack()}
            disabled={loading}
            style={styles.switchButton}
          >
            <Text style={styles.switchMuted}>Ja tem conta?</Text>
            <Text style={styles.switchText}> Entrar</Text>
          </TouchableOpacity>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
  },
  background: {
    flex: 1,
  },
  glowTop: {
    position: "absolute",
    top: -90,
    left: -70,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(0,230,118,0.12)",
  },
  glowBottom: {
    position: "absolute",
    bottom: -120,
    right: -100,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(56,217,255,0.08)",
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: WayperTheme.spacing.page,
    paddingVertical: 36,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: WayperTheme.spacing.xl,
  },
  backButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  brandMini: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoMini: {
    width: 48,
    height: 48,
  },
  brandMiniText: {
    color: WayperTheme.colors.text,
    fontSize: 24,
    fontWeight: "900",
    marginLeft: WayperTheme.spacing.sm,
  },
  card: {
    borderRadius: WayperTheme.radius.xxl,
    padding: WayperTheme.spacing.xl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    overflow: "hidden",
    ...WayperTheme.shadows.card,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginRight: WayperTheme.spacing.md,
  },
  cardTitleWrap: {
    flex: 1,
  },
  eyebrow: {
    color: WayperTheme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 31,
    fontWeight: "900",
    marginTop: 2,
  },
  subtitle: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    marginTop: WayperTheme.spacing.md,
    marginBottom: WayperTheme.spacing.lg,
  },
  errorBox: {
    minHeight: 46,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.dangerSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.dangerBorder,
    paddingHorizontal: WayperTheme.spacing.md,
    paddingVertical: WayperTheme.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
    marginBottom: WayperTheme.spacing.md,
  },
  errorText: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  label: {
    color: WayperTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: WayperTheme.spacing.xs,
    marginTop: WayperTheme.spacing.sm,
  },
  inputShell: {
    minHeight: 58,
    borderRadius: WayperTheme.radius.xl,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    paddingHorizontal: WayperTheme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "700",
    paddingVertical: 12,
    marginLeft: WayperTheme.spacing.sm,
  },
  eyeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  strengthRow: {
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.sm,
    marginBottom: WayperTheme.spacing.xs,
  },
  strengthPill: {
    minHeight: 32,
    borderRadius: WayperTheme.radius.pill,
    paddingHorizontal: WayperTheme.spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
  },
  strengthPillActive: {
    backgroundColor: WayperTheme.colors.primarySoft,
    borderColor: WayperTheme.colors.primaryBorder,
  },
  strengthText: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: "900",
  },
  strengthTextActive: {
    color: WayperTheme.colors.primary,
  },
  primaryButton: {
    minHeight: 60,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
    marginTop: WayperTheme.spacing.xl,
    ...WayperTheme.shadows.greenGlow,
  },
  disabledButton: {
    opacity: 0.64,
  },
  primaryButtonText: {
    color: WayperTheme.colors.textInverse,
    fontSize: 16,
    fontWeight: "900",
  },
  switchButton: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: WayperTheme.spacing.xl,
  },
  switchMuted: {
    color: WayperTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "800",
  },
  switchText: {
    color: WayperTheme.colors.primary,
    fontSize: 14,
    fontWeight: "900",
  },
});
