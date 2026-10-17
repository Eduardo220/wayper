import { beforeEach, expect, jest, test } from "@jest/globals";
import { createRequire } from "node:module";
import { normalizeProfile, normalizeProfileUserId, PROFILE_TABS, profileLink } from "../../../utils/profileModel.js";
import * as profileModel from "../../../utils/profileModel.js";
const require = createRequire(import.meta.url);
const harness = require("./componentHarness.cjs");
const { nodes } = harness;
const path = (name) => new URL(`../${name}.js`, import.meta.url).pathname;
const theme = { colors: { text: "white", textMuted: "gray", primary: "green" } };
const native = Object.fromEntries(["View", "Text", "Image", "Pressable", "ScrollView", "ActivityIndicator", "RefreshControl"].map((n) => [n, n]));
const alert = jest.fn(), navigate = jest.fn(), goBack = jest.fn();
const own = normalizeProfile({ name: "Real", totalDistance: 5000, totalRuns: 1, longestRun: 5000 }, { userId: "me", own: true });
const publicProfile = normalizeProfile({ name: "Outro" }, { userId: "other", own: false });
const common = { "react-native": { ...native, Alert: { alert } }, "@expo/vector-icons": { Ionicons: "Ionicons" },
  "../../theme/wayperTheme": { WayperTheme: theme }, "./Profile.styles": { __esModule: true, default: {} } };
const element = (tree, label) => nodes(tree).find((n) => n.props.label === label || n.props.accessibilityLabel === label);
beforeEach(() => jest.clearAllMocks());

test("own/public Header shares composition and exposes only applicable actions", () => {
  const h = harness(path("ProfileHeader"), { ...common, "expo-linear-gradient": { LinearGradient: "Gradient" },
    "../../components/Home/HomeAvatar": { __esModule: true, default: "Avatar" },
    "../../utils/profileModel": { formatCount: (n) => n ?? "—", formatKm: (n) => n ?? "—" }, "../../../assets/profile-cover.png": 1 });
  const self = h.render({ profile: own, onEdit: navigate, onShare: goBack });
  expect(element(self, "Editar perfil")).toBeTruthy(); expect(element(self, "Compartilhar")).toBeTruthy();
  element(self, "Editar perfil").props.onPress(); expect(navigate).toHaveBeenCalled();
  const other = h.render({ profile: publicProfile });
  expect(element(other, "Editar perfil")).toBeUndefined(); expect(element(other, "Amizades")).toBeTruthy();
  expect(element(other, "Seguir")).toBeUndefined();
  expect(JSON.stringify(other)).not.toMatch(/Privacidade|sync|Fonte dos dados|Cartao para compartilhar/);
});

function screenHarness(loadProfileIdentity = jest.fn(async (identity) => ({ profile: identity.own ? own : publicProfile }))) {
  const loadProfileTab = jest.fn(async () => ({ items: [{ id: "real-run" }], error: null }));
  const unsubscribe = jest.fn();
  const subscribeProfileIdentity = jest.fn((identity, callback) => {
    Promise.resolve(loadProfileIdentity(identity)).then(callback);
    return unsubscribe;
  });
  const h = harness(path("ProfileScreen"), { ...common, "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../../firebaseConfig": { auth: { currentUser: { uid: "me" } } },
    "../../utils/profileModel": { normalizeProfileUserId, PROFILE_TABS },
    "../../repositories/profileScreenAdapter": { subscribeProfileIdentity, loadProfileTab },
    "./ProfileHeader": { __esModule: true, default: "Header", ProfileButton: "Button" },
    "./ProfilePanels": { ProfileAchievements: "Achievements", ProfileNotice: "Notice", ProfileRuns: "Runs", ProfileTerritory: "Territory" },
    "./ProfileShareSheet": { __esModule: true, default: "ShareSheet" } });
  return { h, loadProfileIdentity, loadProfileTab, subscribeProfileIdentity, unsubscribe };
}
const navigation = { navigate, goBack, canGoBack: () => true };
test.each([[{}, true], [{ userId: "other" }, false]])("canonical screen loads real identity %p", async (params, self) => {
  const { h, loadProfileIdentity } = screenHarness(); const props = { route: { name: "ProfileHome", params }, navigation };
  h.render(props); await h.flush(); const tree = h.render(props); await h.flush();
  expect(loadProfileIdentity).toHaveBeenCalledWith({ userId: self ? "me" : "other", own: self, invalid: false, preview: false });
  const header = nodes(tree).find((n) => n.type === "Header"); expect(header.props.profile.own).toBe(self);
  expect(JSON.stringify(tree)).not.toMatch(/Privacidade|Fonte dos dados|Falhas de sync/);
});
test("all three tabs render their real owner panels and run opens existing detail", async () => {
  const { h } = screenHarness(); const props = { route: { name: "ProfileHome", params: {} }, navigation };
  h.render(props); await h.flush(); h.render(props); await h.flush();
  let tree = h.render(props);
  nodes(tree).find((n) => n.type === "Runs").props.onOpen({ id: "real-run" });
  expect(navigate).toHaveBeenCalledWith("ActivityDetail", { run: { id: "real-run" }, readOnly: false });
  for (const [label, panel] of [["Território", "Territory"], ["Conquistas", "Achievements"]]) {
    element(tree, label).props.onPress(); h.render(props); await h.flush(); tree = h.render(props);
    expect(nodes(tree).some((n) => n.type === panel)).toBe(true);
  }
});
test("late profile response after unmount cannot update screen state", async () => {
  let resolve; const { h } = screenHarness(() => new Promise((r) => { resolve = r; }));
  h.render({ route: { params: {} }, navigation }); await h.flush(); h.unmount();
  resolve({ profile: own }); await h.flush(); expect(h.values[0].profile).toBeNull();
});

test("identity change hides previous user immediately and discards its late response", async () => {
  let resolve;
  const { h } = screenHarness((identity) => identity.userId === "other" ? new Promise((r) => { resolve = r; }) : Promise.resolve({ profile: own }));
  h.render({ route: { params: { userId: "other" } }, navigation }); await h.flush();
  const props = { route: { params: { userId: "me" } }, navigation };
  expect(nodes(h.render(props)).some((n) => n.type === "Header")).toBe(false);
  await h.flush(); resolve({ profile: publicProfile }); await h.flush();
  expect(nodes(h.render(props)).find((n) => n.type === "Header").props.profile.userId).toBe("me");
});

test("public privacy change closes share and hides pending activities; unmount stops subscription", async () => {
  const { h, subscribeProfileIdentity, loadProfileTab, unsubscribe } = screenHarness();
  let emit, resolve;
  subscribeProfileIdentity.mockImplementationOnce((identity, callback) => { emit = callback; return unsubscribe; });
  loadProfileTab.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const props = { route: { params: { userId: "other" } }, navigation };
  h.render(props); await h.flush(); emit({ profile: publicProfile });
  let tree = h.render(props); await h.flush();
  nodes(tree).find((n) => n.type === "Header").props.onShare();
  expect(nodes(h.render(props)).some((n) => n.type === "ShareSheet")).toBe(true);
  emit({ profile: { ...publicProfile, restricted: true, runs: null } });
  tree = h.render(props);
  expect(nodes(tree).some((n) => n.type === "ShareSheet" || n.type === "Runs")).toBe(false);
  expect(nodes(tree).some((n) => n.type === "Notice" && n.props.title === "Perfil privado")).toBe(true);
  await h.flush(); resolve({ items: [{ id: "obsolete" }] }); await h.flush();
  expect(nodes(h.render(props)).some((n) => n.type === "Runs")).toBe(false);
  emit({ profile: null, error: new Error("permission denied") }); h.render(props); await h.flush();
  h.unmount(); emit({ profile: publicProfile });
  expect(unsubscribe).toHaveBeenCalledTimes(1); expect(h.values[0].profile).toBeNull();
});

test("records and the complete achievement input render within the same panel", () => {
  const h = harness(path("ProfilePanels"), { ...common,
    "../../components/Home/RoutePreview": { __esModule: true, default: "RoutePreview" },
    "../../components/Home/ZonePreview": { __esModule: true, default: "ZonePreview" },
    "../../components/Home/previewUtils": { buildPointObjects: () => [] },
    "../../components/Map/WayperMapLibre": { __esModule: true, default: "Map" },
    "../../services/runTracking": { getRenderablePathForRun: () => [] },
    "../../services/territory/territoryGeometryService": { geometryToPreviewCoords: () => [] },
    "../../services/territory/territoryEventsService": { generateTerritoryEventMessage: () => "Conquista" },
    "../../utils/pace": { calculatePaceSecondsPerKm: () => null },
    "../../utils/profileModel": profileModel, "./ProfileHeader": { ProfileButton: "Button" } });
  const tree = h.render({ profile: own, items: [{ id: "one", title: "Conquista real", progress: 3, target: 5 }, { id: "two", title: "Concluída real", progress: 1, target: 1, unlocked: true }] }, "ProfileAchievements");
  const content = JSON.stringify(tree);
  for (const label of ["Maior corrida", "Melhor pace", "Pace médio", "Maior zona", "Tempo total", "Conquista real", "Concluída real", "Bloqueada", "Concluída"]) expect(content).toContain(label);
  const runs = h.render({ items: [], hasMore: true }, "ProfileRuns");
  expect(element(runs, "Ver mais corridas")).toBeTruthy(); expect(JSON.stringify(runs)).not.toContain("RoutePreview");
});

test("public deep-link route selects Perfil while preserving all five existing MainTabs", () => {
  const h = harness(new URL("../../../navigation/MainTabs.js", import.meta.url).pathname, { ...common,
    "react-native": { ...native, StyleSheet: { create: (s) => s } },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    "../theme/wayperTheme": { WayperTheme: theme },
    "./mainTabsRoutes.js": { MAIN_TABS: ["Home", "Mapa", "Correr", "Ranking", "Perfil"].map((name) => ({ name, route: name })), openRunEntry: navigate } });
  const tree = h.render({ navigation, state: { index: 0, routes: [{ name: "PublicProfile" }] } });
  expect(element(tree, "Perfil").props.accessibilityState.selected).toBe(true);
  expect(nodes(tree).filter((n) => n.props.testID?.startsWith("main-tab-")).map((n) => n.props.accessibilityLabel)).toEqual(["Home", "Mapa", "Correr", "Ranking", "Perfil"]);
});

test("share flow captures a real PNG and calls existing save/share helpers; link uses clipboard/system sheet", async () => {
  const capture = jest.fn(async () => "file://capture.png"), saveTempImageAsync = jest.fn(async () => "file://profile.png");
  const savePngToGallery = jest.fn(async () => ({ ok: true, message: "Salva" })), sharePngFile = jest.fn(async () => ({ ok: true }));
  const clipboard = jest.fn(), share = jest.fn();
  const h = harness(path("ProfileShareSheet"), { ...common, capture: { capture }, "react-native": { ...common["react-native"], Share: { share } },
    "expo-clipboard": { setStringAsync: clipboard }, "react-native-view-shot": { __esModule: true, default: "ViewShot" },
    "../../components/ui/WPBottomSheet": { WPBottomSheet: "Sheet" }, "../../utils/fileSystemLegacy": { saveTempImageAsync },
    "../../utils/shareImage": { savePngToGallery, sharePngFile }, "../../utils/profileModel": { profileLink },
    "./ProfileHeader": { __esModule: true, default: "Header", ProfileButton: "Button" } });
  const tree = h.render({ profile: own, visible: true, onClose: goBack });
  await element(tree, "Salvar imagem").props.onPress();
  expect(capture).toHaveBeenCalled(); expect(saveTempImageAsync).toHaveBeenCalledWith("file://capture.png", expect.stringMatching(/wayper-profile/));
  expect(savePngToGallery).toHaveBeenCalledWith("file://profile.png", "Wayper");
  await element(tree, "Compartilhar imagem").props.onPress(); expect(sharePngFile).toHaveBeenCalledWith("file://profile.png", expect.objectContaining({ visual: "profile" }));
  await element(tree, "Copiar link").props.onPress(); expect(clipboard).toHaveBeenCalledWith("wayper://profile/me");
  await element(tree, "Enviar link").props.onPress(); expect(share).toHaveBeenCalledWith({ title: "Perfil Wayper", message: "wayper://profile/me" });
  capture.mockRejectedValueOnce(new Error("native failure")); await element(tree, "Salvar imagem").props.onPress();
  expect(alert).toHaveBeenLastCalledWith("Imagem indisponível", expect.any(String));
});

test("DEV preview is labeled, has public actions and cannot share a nonexistent remote profile", () => {
  const h = harness(path("ProfileHeader"), { ...common, "expo-linear-gradient": { LinearGradient: "Gradient" },
    "../../components/Home/HomeAvatar": { __esModule: true, default: "Avatar" },
    "../../utils/profileModel": profileModel, "../../../assets/profile-cover.png": 1 });
  const tree = h.render({ profile: { ...publicProfile, preview: true } });
  expect(JSON.stringify(tree)).toContain("PRÉVIA VISUAL • DEV");
  expect(element(tree, "Editar perfil")).toBeUndefined(); expect(element(tree, "Compartilhar")).toBeUndefined();
  expect(element(tree, "Amizades")).toBeTruthy();
});
test("local visibility model restores public activities and share after Public -> Private -> Public", async () => {
  const { h, subscribeProfileIdentity } = screenHarness(); let emit;
  subscribeProfileIdentity.mockImplementationOnce((identity, callback) => { emit = callback; return jest.fn(); });
  const props = { route: { params: { userId: "other" } }, navigation };
  h.render(props); await h.flush();
  for (const isPrivate of [false, true, false]) {
    emit({ profile: normalizeProfile({ name: "Outro", isPrivate }, { userId: "other", own: false }) });
    h.render(props); await h.flush(); const tree = h.render(props);
    expect(nodes(tree).some(n => n.type === "Runs")).toBe(!isPrivate);
    expect(nodes(tree).some(n => n.type === "Notice" && n.props.title === "Perfil privado")).toBe(isPrivate);
    if (!isPrivate) { nodes(tree).find(n => n.type === "Header").props.onShare(); expect(nodes(h.render(props)).some(n => n.type === "ShareSheet")).toBe(true); }
    else expect(nodes(tree).some(n => n.type === "ShareSheet")).toBe(false);
  }
});

test("canonical Profile projects the saved cover and recovers to the Wayper asset if it cannot load", () => {
  const h = harness(path("ProfileHeader"), { ...common, "expo-linear-gradient": { LinearGradient: "Gradient" },
    "../../components/Home/HomeAvatar": { __esModule: true, default: "Avatar" },
    "../../utils/profileModel": profileModel, "../../../assets/profile-cover.png": 1 });
  const profile = normalizeProfile({ name: "Real", cover: "file://cover-real.jpg" }, { userId: "me", own: true });
  let cover = nodes(h.render({ profile })).find((n) => n.type === "Image");
  expect(cover.props.source).toEqual({ uri: "file://cover-real.jpg" });
  cover.props.onError();
  expect(nodes(h.render({ profile })).find((n) => n.type === "Image").props.source).toBe(1);
  expect(nodes(h.render({ profile: { ...profile, cover: "file://cover-new.jpg" } })).find((n) => n.type === "Image").props.source).toEqual({ uri: "file://cover-new.jpg" });
});
