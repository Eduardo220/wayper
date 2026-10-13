// Apenas apresentação DEV. IDs correspondem às linhas de rankingPreviewData.
const profiles = {
  "preview-km-0": ["Ryn", "Brasil", 42, 8020, 42.6, 368, 91, 26, 82400],
  "preview-km-1": ["DarkeSan", "Japão", 38, 7974, 38.2, 341, 82, 18, 79340],
  "preview-km-2": ["Picachuz", "Chile", 35, 7842, 35.1, 332, 75, 16, 76120],
  "preview-km-3": ["Piber", "Brasil", 31, 6922, 29.8, 303, 67, 13, 68400],
  "preview-km-4": ["Lipzz", "Portugal", 29, 6692, 27.2, 287, 60, 11, 64600],
  "preview-km-5": ["Mimica", "México", 27, 6434, 24.4, 261, 55, 10, 61800],
  "preview-km-6": ["Antonia", "Argentina", 25, 6350, 22.8, 250, 50, 9, 60200],
  "preview-zones-0": ["HM", "Brasil", 42, 5400, 364.8, 320, 48, 24, 82400],
  "preview-zones-1": ["Elite Legends", "Argentina", 39, 5120, 339.4, 301, 40, 20, 78000],
  "preview-zones-2": ["CaryH", "Brasil", 36, 4800, 312.4, 284, 36, 17, 73200],
  "preview-zones-3": ["Absout", "Uruguai", 33, 4350, 284.2, 262, 34, 15, 69900],
  "preview-zones-4": ["Top Brasil", "Brasil", 30, 4160, 277.8, 245, 32, 14, 65500],
  "preview-zones-5": ["BRA Boss", "Brasil", 28, 3920, 265.2, 232, 30, 12, 62600],
  "preview-zones-6": ["Storm", "Brasil", 25, 3750, 256.8, 220, 28, 10, 59100],
  "preview-me-km": ["eduardo.weissheimer22", null, 2, 92.4, 15.3, 5, 12, 3, 2840],
  "preview-me-zones": ["eduardo.weissheimer22", null, 2, 92.4, 15.3, 5, 12, 3, 2840],
};

export function playerProfilePreviewData(playerId) {
  const values = profiles[playerId];
  if (!values) return null;
  const [username, country, level, totalKm, areaKm2, runs, zonesCaptured, retakes, totalXp] = values;
  return {
    id: playerId, username, country, level, totalKm, areaKm2, runs,
    zonesCaptured, retakes, totalXp,
    ...(playerId.startsWith("preview-me-") ? { groupName: "Selvagens" } : {}),
  };
}
