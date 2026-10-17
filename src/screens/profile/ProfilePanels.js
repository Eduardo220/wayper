import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import RoutePreview from "../../components/Home/RoutePreview";
import ZonePreview from "../../components/Home/ZonePreview";
import { buildPointObjects } from "../../components/Home/previewUtils";
import WayperMapLibre from "../../components/Map/WayperMapLibre";
import { getRenderablePathForRun } from "../../services/runTracking";
import { geometryToPreviewCoords } from "../../services/territory/territoryGeometryService";
import { generateTerritoryEventMessage } from "../../services/territory/territoryEventsService";
import { WayperTheme } from "../../theme/wayperTheme";
import { calculatePaceSecondsPerKm } from "../../utils/pace";
import { formatArea, formatCount, formatDate, formatDuration, formatKm, formatPace, knownNumber } from "../../utils/profileModel";
import { ProfileButton } from "./ProfileHeader";
import styles from "./Profile.styles";

const { colors: c } = WayperTheme;
export function ProfileNotice({ title, text }) {
  return <View style={styles.card}><Text style={styles.title}>{title}</Text><Text style={styles.text}>{text}</Text></View>;
}

export function ProfileRuns({ items, onOpen, onMore, hasMore }) {
  return <>
    {!items.length ? <ProfileNotice title="Nenhuma corrida disponível" text="As atividades que você pode visualizar aparecerão aqui." /> : null}
    {items.map((run, index) => {
      const path = run.pathHidden ? [] : getRenderablePathForRun(run);
      const distance = knownNumber(run.distanceMeters ?? run.distance);
      const duration = knownNumber(run.durationSeconds ?? run.duration ?? (run.durationMs != null ? run.durationMs / 1000 : null));
      const pace = distance && duration ? calculatePaceSecondsPerKm(duration, distance / 1000) : null;
      const xp = knownNumber(run.xpEarned ?? run.xp);
      const zones = knownNumber(run.territorySummary?.capturedCount ?? run.zonesCaptured);
      return <Pressable key={run.id || run.localRunId || index} accessibilityRole="button" accessibilityLabel={`Abrir corrida: ${run.title || run.name || formatDate(run.date)}`}
        onPress={() => onOpen(run)} style={[styles.card, styles.run]}>
        <View style={styles.preview}>
          {buildPointObjects(path).length > 1 ? <RoutePreview path={path} /> : <><Ionicons name={run.pathHidden ? "lock-closed-outline" : "walk-outline"} size={28} color={c.primary} /><Text style={styles.small}>{run.pathHidden ? "Rota protegida" : "Sem traçado"}</Text></>}
        </View>
        <View style={styles.runBody}>
          <Text style={styles.runTitle}>{run.title || run.name || (run.mode === "zones" ? "Corrida por zonas" : "Corrida livre")}</Text>
          <Text style={styles.small}>{formatDate(run.finishedAt || run.date || run.createdAt)}</Text>
          <View style={styles.runStats}><Text style={styles.runValue}>{formatKm(distance)}</Text><Text style={styles.runValue}>{formatDuration(duration)}</Text></View>
          <Text style={styles.text}>{formatPace(pace)}</Text>
          <View style={styles.chips}>
            {zones != null ? <View style={styles.chip}><Text style={styles.chipText}>{formatCount(zones)} zonas</Text></View> : null}
            {xp != null ? <View style={[styles.chip, styles.xpChip]}><Text style={[styles.chipText, styles.xpText]}>+{formatCount(xp)} XP</Text></View> : null}
          </View>
        </View>
      </Pressable>;
    })}
    {hasMore ? <ProfileButton label="Ver mais corridas" onPress={onMore} /> : null}
  </>;
}

export function ProfileTerritory({ profile, items, events = [], onMap }) {
  const territories = items.filter((t) => t.geometry);
  const zones = items.filter((t) => !t.geometry && (t.zoneCoords || t.coords)?.length >= 3);
  const latest = [...items].sort((a, b) => new Date(b.capturedAt || b.createdAt || 0) - new Date(a.capturedAt || a.createdAt || 0)).slice(0, 6);
  return <>
    <View style={styles.card}>
      <View style={styles.between}><Text style={styles.title}>{profile.own ? "Meu território" : "Território"}</Text><Ionicons name="map-outline" size={24} color={c.primary} /></View>
      <Text style={styles.text}>{formatCount(profile.zones)} zonas conquistadas · {formatArea(profile.area)}</Text>
      {territories.length || zones.length ? <View style={styles.map}>
        <WayperMapLibre territories={territories} zones={zones} currentUserId={profile.userId}
          showUserLocation={false} showLeaderAreas={false} interactive={false} fitToContent
          contentPadding={{ top: 24, bottom: 24, left: 24, right: 24 }} />
      </View> : <Text style={styles.text}>Nenhuma geometria territorial disponível.</Text>}
      <ProfileButton label="Ver mapa completo" icon="expand-outline" onPress={onMap} />
    </View>
    <View style={styles.records}>
      {[["Zonas disponíveis", items.length ? formatCount(items.length) : profile.own ? "0" : "—"], ["Área dominada", formatArea(profile.area)], ["Ranking territorial", "—"]].map(([label, value]) =>
        <View key={label} style={[styles.card, styles.record]}><Text style={styles.recordValue}>{value}</Text><Text style={styles.small}>{label}</Text></View>)}
    </View>
    {profile.own ? <View style={styles.card}><Text style={styles.title}>Atividade territorial</Text>
      {events.length ? [...events].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 6).map((event, index) =>
        <View key={event.id || index}><Text style={styles.text}>{generateTerritoryEventMessage(event)}</Text><Text style={styles.small}>{formatDate(event.createdAt)}</Text></View>)
        : <Text style={styles.text}>Nenhuma atividade territorial disponível.</Text>}
    </View> : null}
    <View style={styles.card}><Text style={styles.title}>Últimas zonas conquistadas</Text>
      {!latest.length ? <Text style={styles.text}>Nenhuma zona disponível para este perfil.</Text> : latest.map((zone, index) => {
        const coords = zone.geometry ? geometryToPreviewCoords(zone.geometry) : zone.zoneCoords || zone.coords || [];
        return <View key={zone.id || index} style={styles.row}>
          {coords.length >= 3 ? <View style={{ width: 80, height: 68, overflow: "hidden", borderRadius: 8 }}><ZonePreview polygon={coords} /></View> : null}
          <View style={{ flex: 1 }}><Text style={styles.runTitle}>{zone.name || "Zona conquistada"}</Text>
            <Text style={styles.small}>{formatDate(zone.capturedAt || zone.createdAt)} · {formatArea(knownNumber(zone.areaM2 ?? zone.area))}</Text></View>
        </View>;
      })}
    </View>
  </>;
}

export function ProfileAchievements({ profile, items }) {
  const records = [["Maior corrida", formatKm(profile.longestRun), "walk-outline"], ["Melhor pace", formatPace(profile.bestPace), "stopwatch-outline"],
    ["Pace médio", formatPace(profile.averagePace), "flash-outline"], ["Maior zona", formatArea(profile.largestZone), "map-outline"],
    ["Tempo total", formatDuration(profile.totalTime), "time-outline"]];
  return <>
    <View style={styles.card}><Text style={styles.title}>Recordes</Text>
      <View style={styles.records}>{records.map(([label, value, icon]) => <View key={label} style={styles.record}>
        <Ionicons name={icon} size={23} color={c.primary} /><Text style={styles.small}>{label}</Text><Text style={styles.recordValue}>{value}</Text>
      </View>)}</View>
    </View>
    <View style={styles.card}><Text style={styles.title}>Progressão</Text><Text style={styles.text}>Nível {formatCount(profile.level)} · {formatCount(profile.xp)} XP total</Text>
      {profile.progressPct != null ? <View accessibilityLabel={`${profile.progressPct}% para o próximo nível`} style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, profile.progressPct)}%` }]} /></View> : null}
      <Text style={styles.text}>{formatCount(profile.freeRuns)} corridas livres · {formatCount(profile.zoneRuns)} por zonas · {formatCount(profile.retakes)} retomadas</Text>
    </View>
    <View style={styles.card}><View style={styles.between}><Text style={styles.title}>Conquistas</Text>
      {items.length ? <Text style={styles.small}>{items.filter((item) => item.unlocked).length} de {items.length}</Text> : null}</View>
      {!items.length ? <Text style={styles.text}>{profile.own ? "Suas conquistas aparecerão aqui." : "Conquistas públicas ainda não estão disponíveis."}</Text> : items.map((item) => {
        const target = Math.max(1, Number(item.target) || 1);
        const progress = Math.max(0, Math.min(target, Number(item.progress) || 0));
        return <View key={item.id} style={styles.achievement}>
          <Ionicons name={item.unlocked ? "medal-outline" : "lock-closed-outline"} size={30} color={item.unlocked ? c.primary : c.textMuted} />
          <View style={styles.achievementBody}><Text style={styles.runTitle}>{item.title}</Text><Text style={styles.small}>{item.description}</Text>
            <View style={styles.track}><View style={[styles.fill, { width: `${progress / target * 100}%` }]} /></View>
            <Text style={[styles.small, item.unlocked && styles.activeText]}>{item.unlocked ? "Concluída" : "Bloqueada"} · {formatCount(progress)} / {formatCount(target)}</Text>
          </View>
        </View>;
      })}
    </View>
  </>;
}
