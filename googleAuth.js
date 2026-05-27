import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { useEffect } from 'react';
import { auth } from './src/firebaseConfig';
import { googleAuthConfig } from './src/config/env';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { createUserIfNotExists } from './src/services/userService';

WebBrowser.maybeCompleteAuthSession();

export function useGoogleAuth() {
  const [request, response, promptAsync] = Google.useAuthRequest({
    ...(googleAuthConfig.androidClientId
      ? { androidClientId: googleAuthConfig.androidClientId }
      : {}),
    ...(googleAuthConfig.iosClientId
      ? { iosClientId: googleAuthConfig.iosClientId }
      : {}),
    ...(googleAuthConfig.webClientId
      ? { webClientId: googleAuthConfig.webClientId }
      : {}),
    ...(googleAuthConfig.expoClientId
      ? { expoClientId: googleAuthConfig.expoClientId }
      : {}),
    responseType: "id_token",
    selectAccount: true,
  });

  useEffect(() => {
    if (response?.type === "success") {
      const idToken = response.authentication?.idToken
        || response.authentication?.id_token
        || response.params?.id_token;

      if (!idToken) return;

      const credential = GoogleAuthProvider.credential(idToken);

      signInWithCredential(auth, credential)
        .then(async (userCredential) => {
          await createUserIfNotExists(userCredential.user);
        })
        .catch((err) => console.log("Erro no login:", err));
    }
  }, [response]);

  return { request, promptAsync };
}
