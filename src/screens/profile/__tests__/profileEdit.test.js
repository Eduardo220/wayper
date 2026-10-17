import { beforeEach, expect, jest, test } from "@jest/globals";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const harness = require("./componentHarness.cjs");
const original = { displayName: "Nome atual", username: "imutavel", city: "Cidade atual", bio: "Bio atual", avatar: "file://old.jpg", cover: "file://cover-old.jpg", level: 3, xp: 20, nextLevelXp: 100, totalRuns: 9 };
const loadCurrentProfile = jest.fn(async () => ({ data: { profile: { ...original }, userDoc: null } }));
const updateCurrentUserProfile = jest.fn(async () => ({ data: { profile: {} } }));
const goBack = jest.fn(), alert = jest.fn();
const library = jest.fn(async () => ({ canceled: false, assets: [{ uri: "file://new.jpg" }] }));
const camera = jest.fn(async () => ({ canceled: false, assets: [{ uri: "file://camera.jpg" }] }));
const permission = jest.fn(async () => ({ granted: true }));
const native = Object.fromEntries(["View", "Text", "Image", "Pressable", "ScrollView", "ActivityIndicator", "TextInput", "KeyboardAvoidingView"].map((x) => [x, x]));
function setup() {
  const h = harness(new URL("../../ProfileScreen.js", import.meta.url).pathname, {
    "react-native": { ...native, StyleSheet: { create: (x) => x }, Platform: { OS: "android" }, Alert: { alert } },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ bottom: 12 }) },
    "expo-linear-gradient": { LinearGradient: "Gradient" },
    "expo-image-picker": { requestCameraPermissionsAsync: permission, launchCameraAsync: camera, launchImageLibraryAsync: library },
    "@expo/vector-icons": { Ionicons: "Icon" },
    "../theme/wayperTheme": { WayperTheme: { colors: {}, spacing: {}, radius: {}, typography: {} } },
    "../repositories/userProfileRepository": { loadCurrentProfile, updateCurrentUserProfile },
    "../services/permissions": { requestImageLibraryPermission: permission, openAppSettings: jest.fn() },
    "../components/Home/HomeAvatar": { __esModule: true, default: "Avatar" },
    "../components/ui/WPBottomSheet": { WPBottomSheet: "Sheet" },
    "./profile/ProfileHeader": { ProfileButton: "Button" }, "../../assets/profile-cover.png": 1,
  });
  const props = { navigation: { goBack } };
  const render = () => h.render(props);
  const expand = (tree) => {
    if (!tree || typeof tree !== "object") return [];
    if (typeof tree.type === "function") return expand(tree.type(tree.props));
    return [tree, ...(tree.props?.children || []).flatMap(expand)];
  };
  const all = () => expand(render());
  const get = (label) => all().find((n) => n.props.accessibilityLabel === label || n.props.label === label);
  return { h, render, all, get, async start() { render(); await h.flush(); } };
}
beforeEach(() => { jest.clearAllMocks(); updateCurrentUserProfile.mockResolvedValue({ data: { profile: {} } }); permission.mockResolvedValue({ granted: true }); });

test("form contains only editing, read-only username, compact XP and current cover", async () => {
  const { start, all, get } = setup(); await start();
  expect(all().filter((n) => n.type === "TextInput").map((n) => n.props.accessibilityLabel)).toEqual(["Nome de exibição", "Cidade", "Bio"]);
  expect(get("Nome de exibição").props.value).toBe("Nome atual");
  expect(get("Bio").props).toMatchObject({ value: "Bio atual", maxLength: 160, multiline: true });
  expect(get("Cidade").props.value).toBe("Cidade atual");
  const tree = JSON.stringify(all());
  expect(tree).toContain("@imutavel"); expect(tree).toContain("Username é único e não pode ser alterado.");
  for (const removed of ["Recordes", "Ranking Wayper", "Conquistas", "Cartão para compartilhar", "Compartilhar perfil", "Fonte dos dados", "sync", "Diagnóstico", "Distância", "Zonas"]) expect(tree).not.toContain(removed);
});

test("save sends only changed editable fields, multiline bio, visibility and photo; then returns", async () => {
  const { start, get } = setup(); await start();
  get("Nome de exibição").props.onChangeText("Novo nome");
  get("Cidade").props.onChangeText("Nova cidade"); get("Bio").props.onChangeText("linha 1\nlinha 2");
  get("Alterar foto").props.onPress(); await get("Escolher da galeria").props.onPress();
  get("Visibilidade do perfil").props.onPress(); get("Privado").props.onPress();
  expect(updateCurrentUserProfile).not.toHaveBeenCalled();
  await get("Salvar alterações").props.onPress();
  expect(updateCurrentUserProfile).toHaveBeenCalledWith({ name: "Novo nome", city: "Nova cidade", bio: "linha 1\nlinha 2", avatarLocalUri: "file://new.jpg", isPrivate: true, profileVisibility: "private" });
  expect(goBack).toHaveBeenCalledTimes(1);
  expect(original.username).toBe("imutavel");
});

test("cancel discards every draft edit, including photo and visibility", async () => {
  const { start, get } = setup(); await start();
  for (const label of ["Nome de exibição", "Cidade", "Bio"]) get(label).props.onChangeText("Rascunho");
  get("Alterar foto").props.onPress(); await get("Tirar foto").props.onPress();
  get("Visibilidade do perfil").props.onPress(); get("Privado").props.onPress();
  get("Cancelar").props.onPress();
  expect(goBack).toHaveBeenCalledTimes(1); expect(updateCurrentUserProfile).not.toHaveBeenCalled();
});

test("unchanged save does not mutate; failed save retains draft and allows retry", async () => {
  const { start, get } = setup(); await start();
  await get("Salvar alterações").props.onPress(); expect(updateCurrentUserProfile).not.toHaveBeenCalled();
  goBack.mockClear(); get("Cidade").props.onChangeText("Nova");
  updateCurrentUserProfile.mockRejectedValueOnce(new Error("disk full"));
  await get("Salvar alterações").props.onPress();
  expect(goBack).not.toHaveBeenCalled(); expect(get("Cidade").props.value).toBe("Nova");
  expect(alert).toHaveBeenCalledWith("Não foi possível salvar", expect.any(String));
  await get("Salvar alterações").props.onPress(); expect(goBack).toHaveBeenCalledTimes(1);
});

test("photo permission denied or picker cancelled never changes avatar", async () => {
  const { start, get, all } = setup(); await start();
  permission.mockResolvedValueOnce({ granted: false, canAskAgain: false });
  get("Alterar foto").props.onPress(); await get("Tirar foto").props.onPress();
  expect(camera).not.toHaveBeenCalled(); expect(alert).toHaveBeenCalled();
  library.mockResolvedValueOnce({ canceled: true });
  get("Alterar foto").props.onPress(); await get("Escolher da galeria").props.onPress();
  expect(all().find((n) => n.type === "Avatar").props.uri).toBe("file://old.jpg");
});

test("empty name cannot save and duplicate save taps have one mutation", async () => {
  const { start, get } = setup(); await start();
  get("Nome de exibição").props.onChangeText(" "); await get("Salvar alterações").props.onPress();
  expect(updateCurrentUserProfile).not.toHaveBeenCalled();
  get("Nome de exibição").props.onChangeText("Novo");
  let resolve; updateCurrentUserProfile.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const save = get("Salvar alterações").props.onPress;
  const pending = save(); await save(); expect(updateCurrentUserProfile).toHaveBeenCalledTimes(1);
  resolve({ data: {} }); await pending;
});

test("cover uses a landscape picker, saves only its explicit field and updates the preview", async () => {
  const { start, get, all } = setup(); await start();
  expect(all().find((n) => n.type === "Image").props.source).toEqual({ uri: "file://cover-old.jpg" });
  get("Alterar capa").props.onPress(); await get("Escolher da galeria").props.onPress();
  expect(library.mock.lastCall[0].aspect).toEqual([16, 9]);
  expect(all().find((n) => n.type === "Image").props.source).toEqual({ uri: "file://new.jpg" });
  await get("Salvar alterações").props.onPress();
  expect(updateCurrentUserProfile).toHaveBeenCalledWith({ coverLocalUri: "file://new.jpg" });
});

test("cancel does not persist a selected cover", async () => {
  const { start, get } = setup(); await start();
  get("Alterar capa").props.onPress(); await get("Tirar foto").props.onPress();
  expect(camera.mock.lastCall[0].aspect).toEqual([16, 9]);
  get("Cancelar").props.onPress();
  expect(updateCurrentUserProfile).not.toHaveBeenCalled();
});
