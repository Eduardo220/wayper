import React, { useEffect } from "react";
import { View, Text, Button, StyleSheet, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { auth, db } from "../firebaseConfig";
import { doc, getDoc, setDoc } from "firebase/firestore";
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
    const handleLogin = async () => {
      if (response?.type === "success") {
        try {
          const { id_token } = response.params;
          const credential = GoogleAuthProvider.credential(id_token);
          const result = await signInWithCredential(auth, credential);
          const user = result.user;

          console.log("✅ Login com Google bem-sucedido:", user.email);

          // Verifica se o usuário já existe no Firestore
          const userRef = doc(db, "users", user.uid);
          const userSnap = await getDoc(userRef);

          if (!userSnap.exists()) {
            // Cria um username único (baseado no nome)
            const baseUsername =
              user.displayName?.split(" ")[0].toLowerCase() || "user";
            const uniqueSuffix = Math.floor(Math.random() * 10000);
            const username = `${baseUsername}${uniqueSuffix}`;

            // Cria novo documento no Firestore
            await setDoc(userRef, {
              name: user.displayName || "Usuário",
              email: user.email,
              photoURL: user.photoURL || "",
              username: username,
              level: 1,
              areaTotal: 0,
              friends: [],
              createdAt: new Date().toISOString(),
            });

            console.log("🆕 Novo usuário criado no Firestore:", username);
          } else {
            console.log("👤 Usuário já existe no Firestore.");
          }

          navigation.replace("Home");
        } catch (error) {
          console.error("❌ Erro no login:", error);
          Alert.alert("Erro", "Falha ao conectar com o Firebase.");
        }
      }
    };

    handleLogin();
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
