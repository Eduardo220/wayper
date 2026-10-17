import React, { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import HomeAvatar from "../../components/Home/HomeAvatar";
import { WayperTheme } from "../../theme/wayperTheme";
import { formatCount, formatKm } from "../../utils/profileModel";
import styles from "./Profile.styles";

const { colors: c } = WayperTheme;
export function ProfileButton({ label, icon, onPress, primary, disabled = false, style }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    accessibilityState={{ disabled }} onPress={onPress} style={[styles.button, primary && styles.primary, disabled && { opacity: 0.5 }, style]}>
    {icon ? <Ionicons name={icon} size={18} color={primary ? c.textInverse : c.text} /> : null}
    <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}

export function ProfileMetrics({ profile }) {
  return <View style={styles.metrics}>
    {[["walk-outline", formatKm(profile.distance), "Total de distância"],
      ["flag-outline", formatCount(profile.zones), "Zonas conquistadas"],
      ["stats-chart-outline", formatCount(profile.runs), "Corridas"]].map(([icon, value, label]) => <View key={label} style={styles.metric}>
        <View style={styles.metricTop}><Ionicons name={icon} size={20} color={c.primary} /><Text style={styles.metricValue}>{value}</Text></View>
        <Text style={styles.metricLabel}>{label}</Text>
      </View>)}
  </View>;
}

export default function ProfileHeader({ profile, shareCard = false, onBack, onMenu, onOpenMenu, onEdit, onShare, onFriends }) {
  const [failedCover, setFailedCover] = useState(null);
  return <View>
    <Image source={profile.cover && failedCover !== profile.cover ? { uri: profile.cover } : require("../../../assets/profile-cover.png")}
      onError={() => setFailedCover(profile.cover)} style={styles.cover} resizeMode="cover" accessible={false} />
    <LinearGradient colors={["rgba(3,8,11,0.12)", "rgba(3,8,11,0.65)", c.background]} style={styles.cover} />
    {shareCard ? <Text style={styles.shareBrand}>WAYPER</Text> : <View style={styles.topbar}>
      <Pressable accessibilityRole="button" accessibilityLabel={onBack ? "Voltar" : "Abrir menu"} onPress={onBack || onOpenMenu} style={styles.iconButton}>
        <Ionicons name={onBack ? "arrow-back" : "menu"} size={23} color={c.text} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Mais opções do perfil" onPress={onMenu} style={styles.iconButton}>
        <Ionicons name="ellipsis-horizontal" size={24} color={c.text} />
      </Pressable>
    </View>}
    <View style={styles.hero}>
      <View style={styles.identity}>
        <View style={styles.avatarWrap}>
          <HomeAvatar uri={profile.avatar} name={profile.name} size={84} />
          {profile.level != null ? <View style={styles.level}><Text style={styles.levelText}>{profile.level}</Text></View> : null}
        </View>
        <View style={styles.identityText}>
          <Text style={styles.name}>{profile.name}</Text>
          {profile.preview ? <Text style={styles.small}>PRÉVIA VISUAL • DEV</Text> : null}
          {profile.username ? <Text style={styles.username}>@{profile.username}</Text> : null}
          {profile.city ? <View style={styles.city}><Ionicons name="location" size={15} color={c.warning} /><Text style={styles.cityText}>{profile.city}</Text></View> : null}
        </View>
      </View>
      {!profile.restricted ? <View style={styles.bioRow}>
        <Text style={styles.bio}>{profile.bio || "Sua jornada no Wayper."}</Text>
        <View style={styles.league} accessibilityLabel="Liga indisponível">
          <Ionicons name="shield-outline" size={25} color={c.textMuted} /><Text style={styles.leagueText}>LIGA{"\n"}—</Text>
        </View>
      </View> : null}
      {!profile.restricted ? <ProfileMetrics profile={profile} /> : null}
      {!shareCard ? <View style={styles.socialActions}>
      {!profile.restricted ? <View style={styles.social}>
        <View><Text style={styles.socialValue}>{formatCount(profile.followers)}</Text><Text style={styles.small}>Seguidores</Text></View>
        <View><Text style={styles.socialValue}>{formatCount(profile.following)}</Text><Text style={styles.small}>Seguindo</Text></View>
      </View> : null}
      <View style={styles.actions}>
        {profile.own ? <ProfileButton label="Editar perfil" icon="create-outline" primary onPress={onEdit} />
          : <ProfileButton label="Amizades" icon="people-outline" primary onPress={onFriends} />}
        {!profile.restricted && !profile.preview ? <ProfileButton label="Compartilhar" icon="share-social-outline" onPress={onShare} /> : null}
      </View></View> : null}
    </View>
  </View>;
}
