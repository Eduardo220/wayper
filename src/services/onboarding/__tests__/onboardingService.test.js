import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const storage = new Map();

const AsyncStorageMock = {
  getItem: jest.fn(async (key) => storage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => {
    storage.set(key, String(value));
  }),
  removeItem: jest.fn(async (key) => {
    storage.delete(key);
  }),
};

await jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: AsyncStorageMock,
  ...AsyncStorageMock,
}));

const onboarding = await import("../onboardingService.js");

describe("onboardingService", () => {
  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
  });

  test("usuario novo ve onboarding enquanto nao concluiu", async () => {
    await expect(onboarding.hasCompletedOnboarding()).resolves.toBe(false);
  });

  test("onboarding pode ser concluido e nao reaparece", async () => {
    await onboarding.completeOnboarding();

    await expect(onboarding.hasCompletedOnboarding()).resolves.toBe(true);
    expect(AsyncStorageMock.setItem).toHaveBeenCalledWith(onboarding.ONBOARDING_STORAGE_KEY, "1");
  });

  test("reset de teste permite simular app limpo", async () => {
    await onboarding.completeOnboarding();
    await onboarding.resetOnboardingForTests();

    await expect(onboarding.hasCompletedOnboarding()).resolves.toBe(false);
  });
});
