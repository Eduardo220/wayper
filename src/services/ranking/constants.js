export const RANK_FIELDS = {
  zones: "zones",
  area: "area",
  distance: "distance",
  km: "distance",
  xp: "xp",
  elo: "eloScore",
  runs: "totalRuns",
  speed: "topSpeed",
  weeklyPoints: "weeklyPoints",
  monthlyPoints: "monthlyPoints",
  monthlyArea: "monthlyArea",
  monthlyDistance: "monthlyDistance",
};

export const MONTHLY_MEDAL_TIERS = [
  { id: "monthly_rank_1", maxRank: 1, label: "Top 1", color: "#ffd700" },
  { id: "monthly_rank_2", maxRank: 2, label: "Top 2", color: "#d9e2ec" },
  { id: "monthly_rank_3", maxRank: 3, label: "Top 3", color: "#cd7f32" },
  { id: "monthly_rank_10", maxRank: 10, label: "Top 10", color: "#26c6da" },
  { id: "monthly_rank_50", maxRank: 50, label: "Top 50", color: "#00b894" },
  { id: "monthly_rank_100", maxRank: 100, label: "Top 100", color: "#9aa6ad" },
];

export function getMonthlyMedalForRank(rank) {
  const safeRank = Number(rank);
  if (!Number.isFinite(safeRank) || safeRank <= 0) return null;
  return MONTHLY_MEDAL_TIERS.find((tier) => safeRank <= tier.maxRank) || null;
}

export function getRankingMonthKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
