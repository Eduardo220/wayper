import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
} from "react-native";
import { signUpEmail } from "../../services/auth/authService";

export default function RegisterScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmSenha, setConfirmSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleRegister = async () => {
    if (!email || !senha) {
      Alert.alert("Erro", "Preenche essa porcaria direito.");
      return;
    }

    if (senha !== confirmSenha) {
      Alert.alert("Erro", "As senhas não batem, gênio.");
      return;
    }

    try {
      await signUpEmail(email, senha);
      Alert.alert("Sucesso", "Conta criada. Vai logar logo.");
      navigation.replace("Login");

    } catch (err) {
      console.log("ERRO NO REGISTRO:", err);

      let msg = "Algo deu errado.";

      if (err.code === "auth/email-already-in-use")
        msg = "Esse email já tem dono, tenta outro.";
      if (err.code === "auth/invalid-email")
        msg = "Esse email parece um lixo, digita direito.";
      if (err.code === "auth/weak-password")
        msg = "Senha fraca, coloca uma decente.";

      Alert.alert("Erro", msg);
    }
  };

  return (
    <View style={{ flex: 1, padding: 20, justifyContent: "center" }}>
      <Text style={{ fontSize: 24, fontWeight: "bold", marginBottom: 20 }}>
        Criar Conta
      </Text>

      <TextInput
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          marginBottom: 15,
          padding: 12,
          borderRadius: 6,
        }}
      />

      <View>
        <TextInput
          placeholder="Senha"
          secureTextEntry={!showPassword}
          value={senha}
          onChangeText={setSenha}
          style={{
            borderWidth: 1,
            borderColor: "#ccc",
            padding: 12,
            borderRadius: 6,
            marginBottom: 10,
          }}
        />

        <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
          <Text style={{ fontSize: 13, color: "#555", marginBottom: 15 }}>
            {showPassword ? "Ocultar senha" : "Mostrar senha"}
          </Text>
        </TouchableOpacity>
      </View>

      <TextInput
        placeholder="Confirmar senha"
        secureTextEntry={!showPassword}
        value={confirmSenha}
        onChangeText={setConfirmSenha}
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          padding: 12,
          borderRadius: 6,
          marginBottom: 20,
        }}
      />

      <TouchableOpacity
        onPress={handleRegister}
        style={{
          backgroundColor: "black",
          padding: 15,
          alignItems: "center",
          borderRadius: 6,
          marginBottom: 20,
        }}
      >
        <Text style={{ color: "white", fontSize: 16 }}>Criar Conta</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={{ color: "black", textAlign: "center" }}>
          Já tem conta? Fazer login
        </Text>
      </TouchableOpacity>
    </View>
  );
}
