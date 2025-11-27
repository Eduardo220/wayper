// src/screens/ClansScreen.js
import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet
} from "react-native";
import { collection, query, where, getDocs, onSnapshot, orderBy } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { colors } from "../../theme/colors";
import { Ionicons } from "@expo/vector-icons";
import CreateClanModal from "../../components/Clan/CreateClanModal";
import { Platform } from "react-native";


export default function ClansScreen({ navigation }) {
  const [clans, setClans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "clans"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      setClans(arr);
      setLoading(false);
    }, (err) => {
      console.warn("clans snap err", err);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const filtered = clans.filter(c => !search.trim() || c.name.toLowerCase().includes(search.toLowerCase()) || (c.tag||"").toLowerCase().includes(search.toLowerCase()));

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.card} onPress={() =>
  navigation.navigate("Clans", {
    screen: "ClanDetail",
    params: { clanId: item.id }
  })
}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={styles.avatarPlaceholder}><Text style={{color: colors.white}}>{(item.tag||"").slice(0,2).toUpperCase()}</Text></View>
        <View style={{ marginLeft: 12 }}>
          <Text style={styles.clanName}>{item.name} <Text style={styles.tag}>#{item.tag}</Text></Text>
          <Text style={styles.desc}>{item.description || ""}</Text>
        </View>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.small}>Membros</Text>
        <Text style={styles.count}>{item.membersCount||0}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Clans</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)} style={styles.createBtn}>
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={{color:colors.white, marginLeft:8}}>Criar</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Procurar clan ou tag" placeholderTextColor={colors.textMuted} style={styles.searchInput} />
      </View>

      {loading ? <ActivityIndicator style={{marginTop:20}}/> :
        <FlatList data={filtered} keyExtractor={i=>i.id} renderItem={renderItem} contentContainerStyle={{paddingVertical:12}} />
      }

      <CreateClanModal visible={showCreate} onClose={() => setShowCreate(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container:{flex:1, backgroundColor: colors.background, padding:16, paddingTop: Platform.OS==="ios"?56:20},
  title:{fontSize:22, fontWeight:"900", color:colors.textMain},
  headerRow:{flexDirection:"row", justifyContent:"space-between", alignItems:"center"},
  createBtn:{flexDirection:"row", alignItems:"center", backgroundColor:colors.primary, padding:10, borderRadius:10},
  searchRow:{flexDirection:"row", alignItems:"center", backgroundColor: colors.backgroundCard, padding:10, borderRadius:10, marginTop:12},
  searchInput:{flex:1, marginLeft:8, color:colors.textMain},
  card:{backgroundColor: colors.backgroundCard, padding:12, borderRadius:12, marginBottom:12, flexDirection:"row", justifyContent:"space-between", alignItems:"center", borderColor: colors.border, borderWidth:1},
  avatarPlaceholder:{width:48,height:48,borderRadius:10, backgroundColor: colors.primary, justifyContent:"center", alignItems:"center"},
  clanName:{color:colors.textMain, fontWeight:"800"},
  tag:{color:colors.textMuted, fontWeight:"700"},
  desc:{color:colors.textMuted, fontSize:12, maxWidth:250},
  small:{color:colors.textMuted, fontSize:12},
  count:{color:colors.textMain, fontWeight:"900"}
});
