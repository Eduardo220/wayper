import React from "react";
import { View, StyleSheet, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WayperTheme } from "../../theme/wayperTheme";

export function WPScreen({ children, style, safe = true }) {
  const Wrapper = safe ? SafeAreaView : View;

  return (
    <Wrapper style={[styles.screen, style]}>
      <StatusBar barStyle="light-content" backgroundColor={WayperTheme.colors.background} />
      {children}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WayperTheme.colors.background,
  },
});
