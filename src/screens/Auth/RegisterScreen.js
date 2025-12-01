import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";

import { signUpEmail } from "../../services/auth/authService";

export default function RegisterScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmSenha, setConfirmSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  /* ============================================================
     REGISTRO
     ============================================================ */
  async function handleRegister() {
    if (!email.trim() || !senha.trim()) {
      Alert.alert("Erro", "Preenche isso aí direito, criatura.");
      return;
    }

    if (senha.trim() !== confirmSenha.trim()) {
      Alert.alert("Erro", "As senhas não batem, gênio.");
      return;
    }

    try {
      setLoading(true);

      await signUpEmail(email.trim(), senha.trim());

      Alert.alert("Sucesso", "Conta criada. Agora entra no app, caramba.");
      navigation.replace("Login");

    } catch (err) {
      console.log("ERRO NO REGISTRO:", err);
      let msg = "Algo deu errado, obviamente.";

      if (err.code === "auth/email-already-in-use")
        msg = "Esse email já tem dono, tenta outro.";
      else if (err.code === "auth/invalid-email")
        msg = "Esse email mal feito não existe nem no inferno.";
      else if (err.code === "auth/weak-password")
        msg = "Senha fraca demais, faz uma decente.";

      Alert.alert("Erro", msg);

    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Criar Conta</Text>

      <TextInput
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />

      <View>
        <TextInput
          placeholder="Senha"
          secureTextEntry={!showPassword}
          value={senha}
          onChangeText={setSenha}
          style={styles.input}
        />

        <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
          <Text style={styles.showPasswordText}>
            {showPassword ? "Ocultar senha" : "Mostrar senha"}
          </Text>
        </TouchableOpacity>
      </View>

      <TextInput
        placeholder="Confirmar senha"
        secureTextEntry={!showPassword}
        value={confirmSenha}
        onChangeText={setConfirmSenha}
        style={styles.input}
      />

      <TouchableOpacity
        onPress={handleRegister}
        style={styles.button}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Criar Conta</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.backLogin}>Já tem conta? Fazer login</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ============================================================
   ESTILOS
   ============================================================ */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 25,
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 12,
    borderRadius: 6,
    marginBottom: 15,
  },
  showPasswordText: {
    fontSize: 13,
    color: "#555",
    marginBottom: 10,
  },
  button: {
    backgroundColor: "#000",
    padding: 15,
    alignItems: "center",
    borderRadius: 6,
    marginBottom: 20,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
  },
  backLogin: {
    color: "#000",
    textAlign: "center",
  },
});
