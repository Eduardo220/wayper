import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { WayperTheme } from "../../theme/wayperTheme";

export function WPBottomSheet({ visible, onClose, children, maxHeight = "88%", contentStyle }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight }, contentStyle]}>
          <View style={styles.handle} />
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.62)",
  },
  sheet: {
    backgroundColor: WayperTheme.colors.surfaceElevated,
    borderTopLeftRadius: WayperTheme.radius.xxl,
    borderTopRightRadius: WayperTheme.radius.xxl,
    borderWidth: 1,
    borderColor: WayperTheme.colors.borderStrong,
    padding: WayperTheme.spacing.xl,
    ...WayperTheme.shadows.card,
  },
  handle: {
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.borderStrong,
    marginBottom: WayperTheme.spacing.lg,
  },
});
