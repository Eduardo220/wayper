import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator
} from "react-native";

import { signInEmail, resetPassword } from "../../services/auth/authService";
import Icon from "react-native-vector-icons/Feather";

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  /* ============================================================
     LOGIN
     ============================================================ */
  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError("Preenche esse troço direito, criatura.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      await signInEmail(email.trim(), password);

      navigation.replace("Main");
    } catch (err) {
      let msg = "Email ou senha errado, animal.";

      if (err.code === "auth/invalid-email") msg = "Esse email tá errado.";
      if (err.code === "auth/user-not-found") msg = "Esse usuário nem existe.";
      if (err.code === "auth/wrong-password") msg = "Senha errada, esperto.";

      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  /* ============================================================
     RESETAR SENHA
     ============================================================ */
  async function handleForgotPassword() {
    if (!email.trim()) {
      setError("Coloca o email, jumento.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      await resetPassword(email.trim());
      setError("Pronto. Te mandei um email. Vai lá ler.");
    } catch (err) {
      let msg = "Não consegui enviar essa merda.";

      if (err.code === "auth/invalid-email")
        msg = "Esse email tá errado, tenta digitar certo.";
      if (err.code === "auth/user-not-found")
        msg = "Esse email nem cadastro tem.";

      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Entrar</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TextInput
        placeholder="Email"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
      />

      <View style={styles.passwordContainer}>
        <TextInput
          placeholder="Senha"
          style={styles.passwordInput}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
        />

        <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
          <Icon name={showPassword ? "eye-off" : "eye"} size={22} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Login</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate("Register")}>
        <Text style={styles.link}>Criar conta</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleForgotPassword}>
        <Text style={styles.forgot}>Esqueci minha senha</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 25,
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  title: { fontSize: 28, fontWeight: "bold", marginBottom: 20 },
  input: {
    backgroundColor: "#eee",
    padding: 12,
    marginBottom: 10,
    borderRadius: 8,
  },
  passwordContainer: {
    backgroundColor: "#eee",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 12,
  },
  button: {
    backgroundColor: "#00b894",
    padding: 15,
    borderRadius: 8,
    marginTop: 10,
    alignItems: "center",
  },
  buttonText: { color: "#fff", textAlign: "center", fontWeight: "bold" },
  link: {
    textAlign: "center",
    marginTop: 15,
    color: "#00b894",
    fontWeight: "600",
  },
  forgot: { textAlign: "center", marginTop: 10, color: "#555" },
  error: { color: "red", marginBottom: 10 },
});
