export const INITIAL_RANKING_SELECTION = Object.freeze({
  mode: "km",
  scope: "global",
  period: "monthly",
});

export function rankingRequest(selection, city) {
  return {
    scope: selection.scope,
    city: selection.scope === "regional" ? city?.trim() || null : null,
    mode: selection.mode === "km" ? "distance" : "area",
    period: selection.period === "monthly" ? "monthly" : "all",
    limitTo: 300,
  };
}

function metricValue(item, selection, monthKey) {
  if (selection.period === "monthly" && !item.localOnly && item.raw?.rankingMonth !== monthKey) return 0;
  const field = selection.mode === "km" ? "Distance" : "Area";
  const value = selection.period === "monthly"
    ? item.raw && !item.localOnly ? item.raw[`monthly${field}`] : item[`monthly${field}`]
    : item[field.toLowerCase()];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function rankingRows(rows, selection, city, monthKey) {
  const region = selection.scope === "regional" ? city?.trim().toLocaleLowerCase("pt-BR") : null;
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => !region || String(item.city || "").trim().toLocaleLowerCase("pt-BR") === region)
    .map((item) => ({
      ...item,
      avatar: item.avatar || item.photoURL || null,
      name: item.name || item.displayName || item.username || "Atleta",
      metric: metricValue(item, selection, monthKey),
    }))
    .filter((item) => item.metric > 0)
    .sort((a, b) => b.metric - a.metric)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function formatRankingMetric(value, mode) {
  if (mode === "km") return `${(value / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km²`;
  return `${Math.round(value).toLocaleString("pt-BR")} m²`;
}

export const hasCurrentPosition = (source, row) => source === "remote" && !!row && !row.localOnly;
