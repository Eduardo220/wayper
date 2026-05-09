// src/components/FriendRequestCard.js
import React, { memo } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors } from "../../theme";

function FriendRequestCard({ request, onAccept, onReject, isOutgoing }) {
  const who = isOutgoing ? request.to : request.from;
  return (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{request.message || "Pedido de amizade"}</Text>
        <Text style={styles.meta}>{isOutgoing ? `Para: ${who}` : `De: ${who}`}</Text>
      </View>

      <View style={styles.actions}>
        {!isOutgoing && (
          <>
            <TouchableOpacity style={styles.btnAccept} onPress={() => onAccept(request.id)}>
              <Text style={styles.btnText}>Aceitar</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnReject} onPress={() => onReject(request.id)}>
              <Text style={styles.btnText}>Rejeitar</Text>
            </TouchableOpacity>
          </>
        )}

        {isOutgoing && (
          <TouchableOpacity style={styles.btnCancel} onPress={() => onReject(request.id)}>
            <Text style={styles.btnText}>Cancelar</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", padding: 12, backgroundColor: "#fff", borderRadius: 12, marginBottom: 10, alignItems: "center" },
  name: { fontWeight: "700" },
  meta: { color: "#666", marginTop: 4 },
  actions: { flexDirection: "row", gap: 8 },
  btnAccept: { backgroundColor: "#00C853", padding: 8, borderRadius: 8, marginRight: 6 },
  btnReject: { backgroundColor: "#FF3D00", padding: 8, borderRadius: 8 },
  btnCancel: { backgroundColor: "#999", padding: 8, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "700" },
});

export default memo(FriendRequestCard);
