// RegisterScreen.updated.js
// Versão melhorada do RegisterScreen
// - Validações sólidas, prevenção de double-submit, mensagens claras
// - Comentários em português e melhores práticas

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Keyboard,
} from "react-native";

import { signUpEmail } from "../../services/auth/authService";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// valida força mínima de senha: pelo menos 8 chars, uma letra e um número (ajusta conforme necessidade)
function isPasswordStrong(pw) {
  if (!pw || typeof pw !== "string") return false;
  return pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}

export default function RegisterScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = useCallback(async () => {
    if (loading) return;

    const mail = (email || "").trim().toLowerCase();
    const pass = (password || "").trim();
    const confirm = (confirmPassword || "").trim();

    if (!mail || !pass || !confirm) {
      Alert.alert("Erro", "Preencha todos os campos.");
      return;
    }

    if (!EMAIL_REGEX.test(mail)) {
      Alert.alert("Erro", "Digite um email válido.");
      return;
    }

    if (pass !== confirm) {
      Alert.alert("Erro", "As senhas não coincidem.");
      return;
    }

    if (!isPasswordStrong(pass)) {
      Alert.alert("Senha fraca", "Use ao menos 8 caracteres, incluindo letras e números.");
      return;
    }

    try {
      setLoading(true);
      Keyboard.dismiss();

      await signUpEmail(mail, pass);

      // sucesso: orienta o usuário a logar
      Alert.alert("Conta criada", "Sua conta foi criada com sucesso. Faça login para continuar.", [
        { text: "Ir para Login", onPress: () => navigation.replace("Main") },
      ]);
    } catch (err) {
      console.warn("Erro no registro:", err);
      let msg = "Não foi possível criar a conta. Tente novamente.";
      if (err && err.code === "auth/email-already-in-use") msg = "Este email já está em uso.";
      else if (err && err.code === "auth/invalid-email") msg = "Email inválido.";
      else if (err && err.code === "auth/weak-password") msg = "Senha muito fraca.";
      Alert.alert("Erro", msg);
    } finally {
      setLoading(false);
    }
  }, [email, password, confirmPassword, loading, navigation]);

  return (
    <View style={styles.container} accessible accessibilityLabel="Tela de registro">
      <Text style={styles.title}>Criar Conta</Text>

      <TextInput
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
        textContentType="emailAddress"
      />

      <View style={styles.inputRow}>
        <TextInput
          placeholder="Senha"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
          style={[styles.input, { flex: 1 }]}
          textContentType="newPassword"
        />

        <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.showBtn}>
          <Text style={styles.showBtnText}>{showPassword ? "Ocultar" : "Mostrar"}</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        placeholder="Confirmar senha"
        secureTextEntry={!showPassword}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        style={styles.input}
        textContentType="password"
      />

      <TouchableOpacity onPress={handleRegister} style={[styles.button, loading ? styles.buttonDisabled : null]} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Criar Conta</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()} disabled={loading}>
        <Text style={styles.backLogin}>Já tem conta? Fazer login</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: "center", backgroundColor: "#fff" },
  title: { fontSize: 26, fontWeight: "700", marginBottom: 18 },
  input: { borderWidth: 1, borderColor: "#e6e9f0", backgroundColor: "#f7f8fb", padding: 12, borderRadius: 10, marginBottom: 12 },
  inputRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  showBtn: { marginLeft: 10, paddingHorizontal: 8, paddingVertical: 10 },
  showBtnText: { color: "#555" },
  button: { backgroundColor: "#000", padding: 14, borderRadius: 10, alignItems: "center", marginTop: 6 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: "#fff", fontWeight: "700" },
  backLogin: { color: "#000", textAlign: "center", marginTop: 16 },
});