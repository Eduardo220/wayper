// Apenas apresentação DEV. Nunca passar estas linhas ao repository ou ao cache.
const km = [
  ["Ryn", "Brasil • Nível 42", 4010],
  ["DarkeSan", "Japão • Nível 38", 3987],
  ["Picachuz", "Chile • Nível 35", 3921],
  ["Piber", "Brasil • Nível 31", 3461],
  ["Lipzz", "Portugal • Nível 29", 3346],
  ["Mimica", "México • Nível 27", 3217],
  ["Antonia", "Argentina • Nível 25", 3175],
];

const zones = [
  ["HM", "Brasil • Nível 42", 182.4, 24],
  ["Elite Legends", "Argentina • Nível 39", 169.7, 20],
  ["CaryH", "Brasil • Nível 36", 156.2, 18],
  ["Absout", "Uruguai • Nível 33", 142.1, 17],
  ["Top Brasil", "Brasil • Nível 30", 138.9, 16],
  ["BRA Boss", "Brasil • Nível 28", 132.6, 15],
  ["Storm", "Brasil • Nível 25", 128.4, 14],
];

export function rankingPreviewData(selection) {
  const general = selection.period === "allTime";
  const multiplier = general ? 2 : 1;
  const isKm = selection.mode === "km";
  const entries = isKm ? km : zones;
  const rows = entries.map(([name, secondary, value, count], index) => ({
    id: `preview-${selection.mode}-${index}`,
    rank: index + 1,
    name,
    secondary,
    metric: Math.round(value * multiplier * (isKm ? 1000 : 1_000_000)),
    ...(isKm ? {} : { zones: general ? count * 2 : count }),
  }));
  const me = {
    id: `preview-me-${selection.mode}`,
    rank: isKm ? 355 : 28,
    name: "eduardo.weissheimer22",
    secondary: "Você",
    metric: Math.round((isKm ? 46.2 : 15.3) * multiplier * (isKm ? 1000 : 1_000_000)),
    ...(isKm ? {} : { zones: general ? 10 : 5 }),
  };
  return { rows, me };
}
