import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import {
  resetPassword,
  signInEmail,
  signInWithGoogleAsync,
  useGoogleAuth,
} from "../../services/auth/authService";
import { WayperTheme } from "../../theme/wayperTheme";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BRAND_LOGO = require("../../../assets/logo.png");

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
  onFocus,
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
        onFocus={onFocus}
        style={styles.input}
      />
      {right}
    </View>
  );
}

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  const [request, response, promptAsync] = useGoogleAuth();

  const scrollToFormPosition = useCallback((y) => {
    setTimeout(() => {
      scrollRef.current?.scrollTo?.({ y, animated: true });
    }, 90);
  }, []);

  const canSubmit = useMemo(() => {
    return EMAIL_REGEX.test(email.trim().toLowerCase()) && password.trim().length >= 6;
  }, [email, password]);

  useEffect(() => {
    let mounted = true;

    async function finishGoogleLogin() {
      const googleIdToken = response?.authentication?.idToken || response?.params?.id_token;
      if (response?.type !== "success" || !googleIdToken) {
        if (response?.type === "error") setError("Nao foi possivel entrar com Google.");
        return;
      }

      try {
        setGoogleLoading(true);
        setError("");
        await signInWithGoogleAsync(googleIdToken);
        if (mounted) navigation.replace("Main");
      } catch (err) {
        if (mounted) setError(err?.message || "Nao foi possivel entrar com Google.");
      } finally {
        if (mounted) setGoogleLoading(false);
      }
    }

    finishGoogleLogin();
    return () => {
      mounted = false;
    };
  }, [navigation, response]);

  const handleLogin = useCallback(async () => {
    if (loading) return;

    const mail = email.trim().toLowerCase();
    const pass = password.trim();

    if (!mail || !pass) {
      setError("Preencha email e senha.");
      return;
    }

    if (!EMAIL_REGEX.test(mail)) {
      setError("Digite um email valido.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      Keyboard.dismiss();
      await signInEmail(mail, pass);
      navigation.replace("Main");
    } catch (err) {
      setError(err?.message || "Falha ao autenticar. Verifique suas credenciais.");
    } finally {
      setLoading(false);
    }
  }, [email, loading, navigation, password]);

  const handleForgotPassword = useCallback(async () => {
    if (loading) return;

    const mail = email.trim().toLowerCase();
    if (!mail) {
      setError("Digite seu email para receber o link.");
      return;
    }

    if (!EMAIL_REGEX.test(mail)) {
      setError("Digite um email valido.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      Keyboard.dismiss();
      await resetPassword(mail);
      Alert.alert("Email enviado", "Enviamos as instrucoes para redefinir sua senha.");
    } catch (err) {
      setError(err?.message || "Nao conseguimos enviar o email. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [email, loading]);

  const handleGoogle = useCallback(() => {
    if (loading || googleLoading) return;
    if (request) {
      promptAsync();
      return;
    }
    Alert.alert("Google Auth", "Login com Google ainda nao esta configurado neste build.");
  }, [googleLoading, loading, promptAsync, request]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
      style={styles.screen}
    >
      <LinearGradient
        colors={[WayperTheme.colors.background, WayperTheme.colors.backgroundAlt, WayperTheme.colors.surface]}
        style={styles.background}
      >
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />

        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.brandBlock}>
            <View style={styles.logoFrame}>
              <Image source={BRAND_LOGO} style={styles.logo} resizeMode="contain" />
            </View>
            <View style={styles.brandTextWrap}>
              <Text style={styles.brandName}>Wayper</Text>
              <Text style={styles.brandCaption}>Run. Capture. Evolve.</Text>
            </View>
          </View>

          <LinearGradient
            colors={["rgba(0,230,118,0.14)", "rgba(56,217,255,0.06)", WayperTheme.colors.surfaceElevated]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.card}
          >
            <View style={styles.cardHeader}>
              <View style={styles.cardIcon}>
                <Ionicons name="flash-outline" size={24} color={WayperTheme.colors.primary} />
              </View>
              <View style={styles.cardTitleWrap}>
                <Text style={styles.eyebrow}>Bem-vindo de volta</Text>
                <Text style={styles.title}>Entrar</Text>
              </View>
            </View>

            <Text style={styles.subtitle}>
              Acesse suas corridas, grupos, zonas e ranking em tempo real.
            </Text>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color={WayperTheme.colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>Email</Text>
            <AuthInput
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="voce@email.com"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              onFocus={() => scrollToFormPosition(170)}
            />

            <Text style={styles.label}>Senha</Text>
            <AuthInput
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              placeholder="Sua senha"
              secureTextEntry={!showPassword}
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              onFocus={() => scrollToFormPosition(245)}
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

            <TouchableOpacity
              activeOpacity={0.84}
              onPress={handleForgotPassword}
              disabled={loading}
              style={styles.forgotButton}
            >
              <Text style={styles.forgotText}>Esqueci minha senha</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.86}
              style={[styles.primaryButton, (!canSubmit || loading) && styles.disabledButton]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={WayperTheme.colors.textInverse} />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>Entrar</Text>
                  <Ionicons name="arrow-forward" size={21} color={WayperTheme.colors.textInverse} />
                </>
              )}
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>ou</Text>
              <View style={styles.divider} />
            </View>

            <TouchableOpacity
              activeOpacity={0.84}
              onPress={handleGoogle}
              disabled={loading || googleLoading}
              style={styles.googleButton}
            >
              {googleLoading ? (
                <ActivityIndicator color={WayperTheme.colors.text} />
              ) : (
                <>
                  <Ionicons name="logo-google" size={19} color={WayperTheme.colors.text} />
                  <Text style={styles.googleText}>Entrar com Google</Text>
                </>
              )}
            </TouchableOpacity>
          </LinearGradient>

          <TouchableOpacity
            activeOpacity={0.86}
            onPress={() => navigation.navigate("Register")}
            disabled={loading}
            style={styles.switchButton}
          >
            <Text style={styles.switchMuted}>Ainda nao tem conta?</Text>
            <Text style={styles.switchText}> Criar conta</Text>
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
    right: -80,
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: "rgba(0,230,118,0.12)",
  },
  glowBottom: {
    position: "absolute",
    bottom: -120,
    left: -100,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(56,217,255,0.08)",
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: WayperTheme.spacing.page,
    paddingVertical: 42,
    paddingBottom: 120,
  },
  brandBlock: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: WayperTheme.spacing.xl,
  },
  logoFrame: {
    width: 74,
    height: 74,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    ...WayperTheme.shadows.greenGlow,
  },
  logo: {
    width: 58,
    height: 58,
  },
  brandTextWrap: {
    marginLeft: WayperTheme.spacing.lg,
  },
  brandName: {
    color: WayperTheme.colors.text,
    fontSize: 36,
    fontWeight: "900",
  },
  brandCaption: {
    color: WayperTheme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 2,
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
  forgotButton: {
    alignSelf: "flex-end",
    paddingVertical: WayperTheme.spacing.md,
  },
  forgotText: {
    color: WayperTheme.colors.cyan,
    fontSize: 13,
    fontWeight: "900",
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
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.md,
    marginVertical: WayperTheme.spacing.lg,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: WayperTheme.colors.borderStrong,
  },
  dividerText: {
    color: WayperTheme.colors.textSubtle,
    fontSize: 12,
    fontWeight: "900",
  },
  googleButton: {
    minHeight: 56,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: WayperTheme.spacing.sm,
  },
  googleText: {
    color: WayperTheme.colors.text,
    fontSize: 14,
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
