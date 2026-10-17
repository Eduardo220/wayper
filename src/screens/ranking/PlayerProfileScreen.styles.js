import { StyleSheet } from "react-native";
import { WayperTheme } from "../../theme/wayperTheme";

const { colors, radius } = WayperTheme;

export default StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  back: { width: 40, height: 40, justifyContent: "center" },
  headerEnd: { width: 40 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 30 },
  preview: { color: colors.textSubtle, fontSize: 10, fontWeight: "800", textAlign: "center", marginTop: 8, letterSpacing: 0.8 },
  identity: { alignItems: "center", paddingTop: 16, paddingBottom: 24 },
  username: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 14, textAlign: "center" },
  secondary: { color: colors.textMuted, fontSize: 13, marginTop: 5, textAlign: "center" },
  you: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.3, marginTop: 7 },
  level: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 15 },
  progressTrack: { width: "68%", height: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, marginTop: 9, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.primary },
  tabs: { height: 42, flexDirection: "row", padding: 3, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  tabSelected: { backgroundColor: colors.primary },
  tabText: { color: colors.textMuted, fontSize: 11, fontWeight: "900", letterSpacing: 0.4 },
  tabTextSelected: { color: colors.textInverse },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10, marginTop: 16 },
  statCard: { width: "48.5%", minHeight: 91, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceElevated, paddingHorizontal: 12, paddingVertical: 15, justifyContent: "space-between" },
  statValue: { fontSize: 22, fontWeight: "900" },
  statLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 0.5, marginTop: 5 },
  achievements: { alignItems: "center", justifyContent: "center", minHeight: 230, paddingHorizontal: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  stateTitle: { color: colors.text, fontSize: 16, fontWeight: "800", textAlign: "center", marginTop: 12 },
  stateText: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 7, lineHeight: 20 },
  retry: { backgroundColor: colors.primary, borderRadius: radius.md, marginTop: 20, paddingHorizontal: 20, paddingVertical: 12 },
  retryText: { color: colors.textInverse, fontSize: 12, fontWeight: "900" },
});
