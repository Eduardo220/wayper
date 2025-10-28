import React, { useEffect } from "react";
import { View, Text, Button, StyleSheet, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { auth } from "../firebaseConfig";
import { makeRedirectUri } from "expo-auth-session";

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen({ navigation }) {
  const [request, response, promptAsync] = Google.useAuthRequest({
    expoClientId: "939798440028-ksjtv6nhlqsm3jfnf78stffbu6aq3u1f.apps.googleusercontent.com",
    androidClientId: "939798440028-ksjtv6nhlqsm3jfnf78stffbu6aq3u1f.apps.googleusercontent.com",
    iosClientId: "939798440028-ksjtv6nhlqsm3jfnf78stffbu6aq3u1f.apps.googleusercontent.com",
    redirectUri: makeRedirectUri({ useProxy: true }),
  });

  useEffect(() => {
    if (response?.type === "success") {
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);

      signInWithCredential(auth, credential)
        .then(() => {
          console.log("✅ Login com Google bem-sucedido!");
          navigation.replace("Home");
        })
        .catch((error) => {
          console.error("❌ Erro no login com Firebase:", error);
          Alert.alert("Erro", "Falha ao conectar com o Firebase.");
        });
    }
  }, [response]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Wayper 🏃‍♂️</Text>
      <Button
        title="Entrar com Google"
        onPress={() => promptAsync()}
        disabled={!request}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 32, fontWeight: "bold", marginBottom: 20 },
});
