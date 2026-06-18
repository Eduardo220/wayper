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

const LocationMock = {
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: "undetermined", granted: false, canAskAgain: true })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true, canAskAgain: true })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: "denied", granted: false, canAskAgain: true })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: "denied", granted: false, canAskAgain: true })),
};

const PermissionsAndroidMock = {
  PERMISSIONS: {
    POST_NOTIFICATIONS: "android.permission.POST_NOTIFICATIONS",
  },
  RESULTS: {
    GRANTED: "granted",
    DENIED: "denied",
    NEVER_ASK_AGAIN: "never_ask_again",
  },
  check: jest.fn(async () => false),
  request: jest.fn(async () => "denied"),
};

const PlatformMock = {
  OS: "android",
  Version: 33,
};

const openSettings = jest.fn(async () => true);
const recordRunEvent = jest.fn();

await jest.unstable_mockModule("@react-native-async-storage/async-storage", () => ({
  default: AsyncStorageMock,
  ...AsyncStorageMock,
}));

await jest.unstable_mockModule("react-native", () => ({
  Linking: {
    openSettings,
  },
  PermissionsAndroid: PermissionsAndroidMock,
  Platform: PlatformMock,
}));

await jest.unstable_mockModule("expo-location", () => LocationMock);

await jest.unstable_mockModule("expo-image-picker", () => ({
  getMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: "undetermined", granted: false, canAskAgain: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true, canAskAgain: true })),
}));

await jest.unstable_mockModule("../../utils/logger.js", () => ({
  default: {
    debug: jest.fn(),
    warn: jest.fn(),
  },
  LOG_CATEGORIES: {
    PERMISSION: "permission",
  },
}));

await jest.unstable_mockModule("../diagnostics/runDiagnosticsService.js", () => ({
  recordRunEvent,
}));

const permissions = await import("../permissions.js");

describe("permissions facade", () => {
  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
    PlatformMock.OS = "android";
    PlatformMock.Version = 33;
    LocationMock.getForegroundPermissionsAsync.mockResolvedValue({ status: "undetermined", granted: false, canAskAgain: true });
    LocationMock.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted", granted: true, canAskAgain: true });
    LocationMock.getBackgroundPermissionsAsync.mockResolvedValue({ status: "denied", granted: false, canAskAgain: true });
    LocationMock.requestBackgroundPermissionsAsync.mockResolvedValue({ status: "denied", granted: false, canAskAgain: true });
    PermissionsAndroidMock.check.mockResolvedValue(false);
    PermissionsAndroidMock.request.mockResolvedValue("denied");
  });

  test("normaliza estados principais de permissao", () => {
    expect(permissions.normalizePermissionStatus("granted")).toBe("granted");
    expect(permissions.normalizePermissionStatus("limited")).toBe("limited");
    expect(permissions.normalizePermissionStatus("denied", { canAskAgain: false })).toBe("blocked");
    expect(permissions.normalizePermissionStatus("notDetermined")).toBe("undetermined");
    expect(permissions.normalizePermissionStatus("restricted")).toBe("unavailable");
  });

  test("foreground bloqueada nao dispara request nativo no start guard", async () => {
    LocationMock.getForegroundPermissionsAsync.mockResolvedValue({
      status: "denied",
      granted: false,
      canAskAgain: false,
    });

    const result = await permissions.ensureLocationForRun();

    expect(result.action).toBe("blocked");
    expect(result.status).toBe("blocked");
    expect(LocationMock.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  test("foreground granted permite iniciar corrida", async () => {
    LocationMock.getForegroundPermissionsAsync.mockResolvedValue({
      status: "granted",
      granted: true,
      canAskAgain: true,
    });

    const result = await permissions.ensureLocationForRun();

    expect(result.action).toBe("granted");
    expect(result.granted).toBe(true);
    expect(LocationMock.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  test("background negada registra request e nao repete prompt nativo", async () => {
    LocationMock.getForegroundPermissionsAsync.mockResolvedValue({
      status: "granted",
      granted: true,
      canAskAgain: true,
    });

    const first = await permissions.requestBackgroundLocation();
    const second = await permissions.requestBackgroundLocation();

    expect(first.granted).toBe(false);
    expect(second.promptedBefore).toBe(true);
    expect(LocationMock.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  test("notificacao negada nao quebra e nao repete prompt nativo", async () => {
    PermissionsAndroidMock.check.mockResolvedValue(false);
    PermissionsAndroidMock.request.mockResolvedValue("denied");

    const first = await permissions.requestNotificationPermission();
    const second = await permissions.requestNotificationPermission();

    expect(first.granted).toBe(false);
    expect(first.status).toBe("denied");
    expect(second.promptedBefore).toBe(true);
    expect(PermissionsAndroidMock.request).toHaveBeenCalledTimes(1);
  });

  test("blocked/canAskAgain false sinaliza abrir configuracoes", async () => {
    PermissionsAndroidMock.check.mockResolvedValue(false);
    PermissionsAndroidMock.request.mockResolvedValue("never_ask_again");

    const result = await permissions.requestNotificationPermission();

    expect(result.status).toBe("blocked");
    expect(result.canAskAgain).toBe(false);
  });

  test("educacao aparece uma vez por permissao", async () => {
    LocationMock.getBackgroundPermissionsAsync.mockResolvedValue({
      status: "denied",
      granted: false,
      canAskAgain: true,
    });

    const before = await permissions.shouldShowPermissionEducation(permissions.PermissionName.LOCATION_BACKGROUND);
    await permissions.markPermissionEducationSeen(permissions.PermissionName.LOCATION_BACKGROUND);
    const after = await permissions.shouldShowPermissionEducation(permissions.PermissionName.LOCATION_BACKGROUND);

    expect(before).toBe(true);
    expect(after).toBe(false);
  });

  test("summary diferencia permissao obrigatoria e limitacoes opcionais", async () => {
    LocationMock.getForegroundPermissionsAsync.mockResolvedValue({
      status: "granted",
      granted: true,
      canAskAgain: true,
    });
    LocationMock.getBackgroundPermissionsAsync.mockResolvedValue({
      status: "denied",
      granted: false,
      canAskAgain: true,
    });
    PermissionsAndroidMock.check.mockResolvedValue(false);

    const summary = await permissions.getPermissionSummary({ includeMedia: false });

    expect(summary.canStartRun).toBe(true);
    expect(summary.backgroundLimited).toBe(true);
    expect(summary.notificationLimited).toBe(true);
    expect(summary.foregroundLocation.permissionName).toBe(permissions.PermissionName.LOCATION_FOREGROUND);
  });
});
