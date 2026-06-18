import AsyncStorage from "@react-native-async-storage/async-storage";

export const ONBOARDING_STORAGE_KEY = "wayper:onboarding:v1:completed";

export async function hasCompletedOnboarding() {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY)) === "1";
  } catch {
    return true;
  }
}

export async function completeOnboarding() {
  try {
    await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export async function resetOnboardingForTests() {
  try {
    await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {}
}

export default {
  ONBOARDING_STORAGE_KEY,
  completeOnboarding,
  hasCompletedOnboarding,
  resetOnboardingForTests,
};
