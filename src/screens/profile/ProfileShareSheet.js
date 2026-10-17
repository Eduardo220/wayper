import React, { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import ViewShot from "react-native-view-shot";
import { WPBottomSheet } from "../../components/ui/WPBottomSheet";
import { saveTempImageAsync } from "../../utils/fileSystemLegacy";
import { savePngToGallery, sharePngFile } from "../../utils/shareImage";
import { WayperTheme } from "../../theme/wayperTheme";
import ProfileHeader, { ProfileButton } from "./ProfileHeader";
import { profileLink } from "../../utils/profileModel";
import styles from "./Profile.styles";

export default function ProfileShareSheet({ profile, visible, onClose }) {
  const capture = useRef(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("image");
  const link = profileLink(profile.userId);
  async function imageAction(save) {
    setBusy(true);
    try {
      const uri = await capture.current.capture();
      const file = await saveTempImageAsync(uri, `wayper-profile-${Date.now()}.png`);
      const result = save ? await savePngToGallery(file, "Wayper") : await sharePngFile(file, { visual: "profile", method: "view-shot", dialogTitle: "Compartilhar perfil" });
      if (!result.ok || save) Alert.alert(result.ok ? "Imagem salva" : "Não foi possível concluir", result.message);
    } catch { Alert.alert("Imagem indisponível", "Não foi possível gerar a imagem do perfil. Tente novamente."); }
    finally { setBusy(false); }
  }
  async function linkAction(copy) {
    if (!link) return;
    try {
      if (copy) { await Clipboard.setStringAsync(link); Alert.alert("Link copiado", "Abra o link em um dispositivo com Wayper instalado."); }
      else await Share.share({ title: "Perfil Wayper", message: link });
    } catch { Alert.alert("Não foi possível concluir", "Tente novamente."); }
  }
  return <WPBottomSheet visible={visible} onClose={busy ? undefined : onClose} maxHeight="94%">
    <ScrollView contentContainerStyle={styles.sheetContent}>
      <View style={styles.between}><Text style={styles.title}>Compartilhar perfil</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Fechar compartilhamento" disabled={busy} onPress={onClose} style={styles.iconButton}>
          <Ionicons name="close" color={WayperTheme.colors.text} size={26} />
        </Pressable></View>
      <Text style={styles.text}>Mostre sua jornada no Wayper e convide mais pessoas para correrem com você.</Text>
      <View style={styles.tabs}>{[["image", "Imagem do perfil"], ["link", "Link do perfil"]].map(([key, title]) =>
        <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: mode === key }} accessibilityLabel={title}
          disabled={busy} onPress={() => setMode(key)} style={[styles.tab, mode === key && styles.tabActive]}>
          <Text style={[styles.buttonText, mode === key && styles.activeText]}>{title}</Text></Pressable>)}</View>
      {mode === "image" ? <>
        <ViewShot ref={capture} options={{ format: "png", quality: 1, result: "tmpfile" }} style={styles.shareCard}>
          <ProfileHeader profile={profile} shareCard />
        </ViewShot>
        {busy ? <ActivityIndicator color={WayperTheme.colors.primary} accessibilityLabel="Gerando imagem do perfil" /> : null}
        <View style={styles.row}><ProfileButton label="Salvar imagem" icon="download-outline" disabled={busy} onPress={() => imageAction(true)} />
          <ProfileButton label="Compartilhar imagem" icon="share-outline" primary disabled={busy} onPress={() => imageAction(false)} /></View>
      </> : <View style={styles.card}><Text selectable style={styles.link}>{link || "Link indisponível"}</Text>
        <Text style={styles.text}>Link interno: requer o aplicativo Wayper instalado. Perfil e atividades respeitam a privacidade do atleta.</Text></View>}
      <View style={styles.row}><ProfileButton label="Copiar link" icon="link-outline" disabled={!link || busy} onPress={() => linkAction(true)} />
        <ProfileButton label="Enviar link" icon="paper-plane-outline" disabled={!link || busy} onPress={() => linkAction(false)} /></View>
    </ScrollView>
  </WPBottomSheet>;
}
