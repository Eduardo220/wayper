// LoginScreen.updated.js
// Versão melhorada do LoginScreen
// - Validações, mensagens amigáveis, proteção contra double-submit
// - Suporte a login por email/senha e Google (expo-auth-session hook exposto pelo authService)
// - Comentários em português e boas práticas de performance

import React, { useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  Alert,
  Platform,
} from "react-native";
import { Feather as Icon } from "@expo/vector-icons";

import {
  signInEmail,
  resetPassword,
  useGoogleAuth,
  signInWithGoogleAsync,
} from "../../services/auth/authService";

// regex simples para validar email (suficiente para UX)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// mensagens padrão para mapeamento de erros firebase (pode ser estendido)
const ERROR_MAP = {
  "auth/invalid-email": "Formato de email inválido.",
  "auth/user-not-found": "Usuário não encontrado. Verifique o email.",
  "auth/wrong-password": "Senha incorreta.",
  "auth/too-many-requests": "Muitas tentativas. Tente novamente mais tarde.",
};

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Hook para Google (expo-auth-session) — vindo do authService
  const [request, response, promptAsync] = useGoogleAuth();

  useEffect(() => {
    // quando o response do Google chegar, pegar o id_token e efetuar login
    let mounted = true;
    (async () => {
      try {
        const googleIdToken = response?.authentication?.idToken || response?.params?.id_token;
        if (response?.type === "success" && googleIdToken) {
          setLoading(true);
          setError("");
          await signInWithGoogleAsync(googleIdToken);
          if (mounted) navigation.replace("Main");
        } else if (response?.type === "error") {
          setError("Falha no login com Google.");
        }
      } catch (e) {
        setError("Erro ao logar com Google.");
      } finally {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [response, navigation]);

  const handleLogin = useCallback(async () => {
    // protege contra múltiplos submits
    if (loading) return;

    // limpeza e validação básica
    const mail = (email || "").trim().toLowerCase();
    const pass = (password || "").trim();

    if (!mail || !pass) {
      setError("Preencha email e senha.");
      return;
    }
    if (!EMAIL_REGEX.test(mail)) {
      setError("Digite um e‑mail válido.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      Keyboard.dismiss();

      await signInEmail(mail, pass);

      // navega para tela principal substituindo a stack (não permite voltar ao login)
      navigation.replace("Main");
    } catch (err) {
      // tenta mapear erro conhecido
      const msg = (err && (err.code && ERROR_MAP[err.code])) ? ERROR_MAP[err.code] : "Falha ao autenticar. Verifique suas credenciais.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [email, password, loading, navigation]);

  const handleForgotPassword = useCallback(async () => {
    if (loading) return;

    const mail = (email || "").trim().toLowerCase();
    if (!mail) {
      setError("Coloque seu email para receber o link.");
      return;
    }
    if (!EMAIL_REGEX.test(mail)) {
      setError("Digite um e‑mail válido.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      await resetPassword(mail);

      // feedback amigável
      Alert.alert("Enviado", "Enviamos um email com instruções para resetar sua senha.");
    } catch (err) {
      const msg = (err && err.code === "auth/user-not-found") ? "Email não encontrado." : "Não conseguimos enviar o email. Tente novamente.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [email, loading]);

  return (
    <View style={styles.container} accessible accessibilityLabel="Tela de login">
      <Text style={styles.title}>Entrar</Text>

      {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}

      <TextInput
        placeholder="Email"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => { /* foco no próximo campo */ }}
      />

      <View style={styles.passwordContainer} accessible accessibilityLabel="campo senha">
        <TextInput
          placeholder="Senha"
          style={styles.passwordInput}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          textContentType="password"
          returnKeyType="done"
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity
          onPress={() => setShowPassword((v) => !v)}
          accessibilityLabel={showPassword ? "Ocultar senha" : "Mostrar senha"}
          accessibilityRole="button"
          style={styles.iconButton}
        >
          <Icon name={showPassword ? "eye-off" : "eye"} size={20} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.button, loading ? styles.buttonDisabled : null]}
        onPress={handleLogin}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Entrar"
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Entrar</Text>}
      </TouchableOpacity>

      <View style={styles.row}>
        <TouchableOpacity onPress={() => navigation.navigate("Register")} disabled={loading}>
          <Text style={styles.link}>Criar conta</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleForgotPassword} disabled={loading}>
          <Text style={styles.forgot}>Esqueci minha senha</Text>
        </TouchableOpacity>
      </View>

      {/* botão de login com Google (se configurado) */}
      <View style={{ marginTop: 20, alignItems: "center" }}>
        <TouchableOpacity
          onPress={() => {
            // caso o request esteja presente, abre o fluxo do Google
            if (request) promptAsync();
            else Alert.alert("Google Auth", "Autenticação Google não configurada.");
          }}
          style={styles.googleBtn}
          disabled={loading}
        >
          <Text style={styles.googleTxt}>Entrar com Google</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: "center", backgroundColor: "#fff" },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 20 },
  input: { backgroundColor: "#f5f6fb", padding: 12, marginBottom: 12, borderRadius: 10, borderWidth: 1, borderColor: "#e6e9f0" },
  passwordContainer: { backgroundColor: "#f5f6fb", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "#e6e9f0", marginBottom: 12 },
  passwordInput: { flex: 1, paddingVertical: 12 },
  iconButton: { padding: 8 },
  button: { backgroundColor: "#00b894", padding: 14, borderRadius: 10, alignItems: "center" },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: "#fff", fontWeight: "700" },
  link: { color: "#00b894", fontWeight: "600" },
  forgot: { color: "#777" },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  error: { color: "#c62828", marginBottom: 10 },
  googleBtn: { backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "#ddd" },
  googleTxt: { color: "#444" },
});
