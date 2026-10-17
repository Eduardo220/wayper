export const MAIN_TABS = [
  { name: "Home", route: "Inicio", icon: "home-outline" },
  { name: "Mapa", route: "Mapa", icon: "map-outline" },
  { name: "Correr", route: "Mapa", icon: "walk-outline" },
  { name: "Ranking", route: "Ranking", icon: "podium-outline" },
  { name: "Perfil", route: "Perfil", icon: "person-outline" },
];

let requestId = 0;
export function openRunEntry(navigation) {
  requestId = Math.max(Date.now(), requestId + 1);
  navigation.navigate("Mapa", { runEntryRequestId: requestId });
}
