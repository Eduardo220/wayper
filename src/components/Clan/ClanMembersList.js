// src/components/ClanMembersList.js
import React, { useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { collection, getDocs } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { colors } from "../../theme/colors";
import { Platform } from "react-native";


export default function ClanMembersList({ clanId }) {
  const [members, setMembers] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const col = collection(db, "clans", clanId, "members");
        const snap = await getDocs(col);
        const arr = [];
        for (const docSnap of snap.docs) {
          const data = docSnap.data();
          // try get public info
          const userDoc = await (await fetchUser(data.uid));
          arr.push({ id: docSnap.id, uid: data.uid, role: data.role, joinedAt: data.joinedAt, nickname: data.nickname, user: userDoc });
        }
        if (mounted) setMembers(arr);
      } catch (e) {
        console.warn("members fetch", e);
        if (mounted) setMembers([]);
      }
    })();
    return () => mounted=false;
  }, [clanId]);

  async function fetchUser(uid) {
    try {
      const d = await getDocs(collection(db, "users")); // fallback naive; replace with getDoc(doc(...)) in production
      return null;
    } catch { return null }
  }

  if (!members) return <ActivityIndicator style={{marginTop:12}} color={colors.primary} />;

  const render = ({item}) => (
    <View style={styles.row}>
      <Image source={{uri: item.user?.avatar || "https://i.pravatar.cc/150"}} style={styles.avatar}/>
      <View style={{flex:1, marginLeft:12}}>
        <Text style={styles.name}>{item.user?.name || item.nickname || item.uid}</Text>
        <Text style={styles.small}>{item.role}</Text>
      </View>
      <Text style={styles.joined}>{new Date(item.joinedAt?.toDate?.()||Date.now()).toLocaleDateString()}</Text>
    </View>
  );

  return (
    <View style={{marginTop:12}}>
      <Text style={{color:colors.textSoft, fontWeight:"800"}}>Membros</Text>
      <FlatList data={members} keyExtractor={i=>i.id} renderItem={render} />
    </View>
  );
}

const styles = StyleSheet.create({
  row:{flexDirection:"row", alignItems:"center", backgroundColor: colors.backgroundCard, padding:10, borderRadius:10, marginTop:8},
  avatar:{width:44,height:44,borderRadius:10},
  name:{color:colors.textMain,fontWeight:"800"},
  small:{color:colors.textMuted,fontSize:12},
  joined:{color:colors.textMuted}
});
