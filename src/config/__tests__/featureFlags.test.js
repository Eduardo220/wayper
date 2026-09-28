import {
  FEATURE_FLAGS,
  isFeatureEnabled,
  normalizeFeatureFlagValue,
  resolveFeatureFlag,
} from "../featureFlags.js";

describe("featureFlags", () => {
  test.each([
    [true, true],
    [false, false],
    [1, true],
    [0, false],
    ["true", true],
    ["ON", true],
    ["enabled", true],
    ["false", false],
    ["off", false],
    ["DISABLED", false],
  ])("normalizes %p", (input, expected) => {
    expect(normalizeFeatureFlagValue(input)).toBe(expected);
  });

  test.each([undefined, null, "", "maybe", 2, -1, {}, []])(
    "rejects invalid value %p",
    (input) => {
      expect(normalizeFeatureFlagValue(input)).toBeNull();
    }
  );

  test("enables the focus run UI by safe local default", () => {
    expect(
      isFeatureEnabled(FEATURE_FLAGS.FOCUS_RUN_UI, {
        buildTimeOverride: undefined,
      })
    ).toBe(true);
    expect(
      resolveFeatureFlag(FEATURE_FLAGS.FOCUS_RUN_UI, {
        buildTimeOverride: undefined,
      }).source
    ).toBe("local_default");
  });

  test("accepts an explicit rollback override", () => {
    expect(
      resolveFeatureFlag(FEATURE_FLAGS.FOCUS_RUN_UI, { override: "false" })
    ).toEqual({
      name: FEATURE_FLAGS.FOCUS_RUN_UI,
      enabled: false,
      source: "explicit_override",
    });
  });

  test("accepts the build-time configuration without depending on CI env", () => {
    expect(
      resolveFeatureFlag(FEATURE_FLAGS.FOCUS_RUN_UI, {
        buildTimeOverride: "false",
      })
    ).toEqual({
      name: FEATURE_FLAGS.FOCUS_RUN_UI,
      enabled: false,
      source: "build_time",
    });
  });

  test("keeps unknown flags disabled", () => {
    expect(resolveFeatureFlag("unknown_feature")).toEqual({
      name: "unknown_feature",
      enabled: false,
      source: "unknown_safe_default",
    });
  });
});
