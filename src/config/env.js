function cleanEnv(value, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

export const appEnv = cleanEnv(process.env.EXPO_PUBLIC_APP_ENV, "development");

export const firebaseClientConfig = {
  apiKey: cleanEnv(
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    "AIzaSyDMEuHH1fq9qlGL6cfIK6jA9UvqD4YFS6Y"
  ),
  authDomain: cleanEnv(
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    "wayper-3ee61.firebaseapp.com"
  ),
  projectId: cleanEnv(
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    "wayper-3ee61"
  ),
  storageBucket: cleanEnv(
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    "wayper-3ee61.appspot.com"
  ),
  messagingSenderId: cleanEnv(
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    "284903184569"
  ),
  appId: cleanEnv(
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    "1:284903184569:web:956fb1d235443d002f2368"
  ),
  measurementId: cleanEnv(
    process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
    "G-DQLGQ44YBV"
  ),
};

export const googleAuthConfig = {
  androidClientId: cleanEnv(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID),
  iosClientId: cleanEnv(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
  webClientId: cleanEnv(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
  expoClientId: cleanEnv(process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID),
};

export const isGoogleAuthConfigured = Object.values(googleAuthConfig).some(Boolean);
