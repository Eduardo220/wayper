import { formatRankingMetric } from "../rankingHomeModel";

export function visibleRanking(realRows, preview, devEnabled) {
  return devEnabled && realRows.length === 0
    ? { rows: preview.rows, preview: true, me: preview.me }
    : { rows: realRows, preview: false, me: null };
}

export function badgeVariant(rank) {
  return ["gold", "silver", "bronze"][rank - 1] || "neutral";
}

export function rankingContext(selection, city, monthKey, preview = false) {
  const [year, month] = monthKey.split("-").map(Number);
  const monthName = new Date(year, month - 1).toLocaleDateString("pt-BR", { month: "long" });
  const monthLabel = `${monthName[0].toUpperCase()}${monthName.slice(1)} ${year}`;
  const region = selection.scope === "regional" ? (city || (preview ? "Santa Maria, RS" : "Cidade indisponível")) : null;
  return {
    scope: selection.scope === "regional" ? "RANKING REGIONAL" : "RANKING GLOBAL",
    title: selection.mode === "km" ? "KM PERCORRIDOS" : "ZONAS DOMINADAS",
    period: `${selection.period === "monthly" ? "Mensal" : "Geral"} • ${region ? `${region} • ` : ""}${selection.period === "monthly" ? monthLabel : "Todo o período"}`,
  };
}

export function rankingSecondary(row, preview) {
  if (preview) return row.secondary;
  const level = Number(row.raw?.level ?? row.level);
  return [row.city, Number.isFinite(level) && level > 0 ? `Nível ${level}` : null].filter(Boolean).join(" • ");
}

export function rankingMetric(row, mode) {
  if (!row || !Number.isFinite(row.metric)) return "—";
  if (mode === "km" && row.metric % 1000 === 0) return `${(row.metric / 1000).toLocaleString("pt-BR")} km`;
  return formatRankingMetric(row.metric, mode);
}

export function rankingZoneCount(row, preview, period) {
  if (!row || (!preview && period === "monthly")) return null;
  const count = Number(row.zones ?? row.raw?.totalZones ?? row.raw?.zones);
  return Number.isFinite(count) && count > 0 ? `${count} ${count === 1 ? "zona" : "zonas"}` : null;
}
