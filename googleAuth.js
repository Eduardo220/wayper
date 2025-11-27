import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { useEffect } from 'react';
import { auth } from '../firebaseConfig';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { createUserIfNotExists } from '../services/firestore/userService';

WebBrowser.maybeCompleteAuthSession();

export function useGoogleAuth() {
  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: "TEU_CLIENT_ID_ANDROID.apps.googleusercontent.com",
    iosClientId: "TEU_CLIENT_ID_IOS.apps.googleusercontent.com",
    expoClientId: "TEU_CLIENT_ID_EXPO.apps.googleusercontent.com",
  });

  useEffect(() => {
    if (response?.type === "success") {
      const { id_token } = response.authentication;
      const credential = GoogleAuthProvider.credential(id_token);

      signInWithCredential(auth, credential)
        .then(async (userCredential) => {
          await createUserIfNotExists(userCredential.user);
        })
        .catch((err) => console.log("Erro no login:", err));
    }
  }, [response]);

  return { request, promptAsync };
}
