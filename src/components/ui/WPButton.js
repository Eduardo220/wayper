import React, { useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { WayperTheme } from "../../theme/wayperTheme";

export function WPButton({
  title,
  onPress,
  variant = "primary",
  icon,
  rightIcon,
  disabled = false,
  compact = false,
  style,
  textStyle,
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 28,
      bounciness: 4,
    }).start();
  };

  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 24,
      bounciness: 5,
    }).start();
  };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        disabled={disabled}
        onPress={disabled ? undefined : onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={[styles.button, compact && styles.compact, styles[variant], disabled && styles.disabled]}
      >
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        <Text style={[styles.text, styles[`${variant}Text`], textStyle]}>{title}</Text>
        {rightIcon ? <View style={styles.rightIcon}>{rightIcon}</View> : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 58,
    borderRadius: WayperTheme.radius.pill,
    paddingHorizontal: WayperTheme.spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    borderWidth: 1,
  },
  compact: {
    minHeight: 44,
    paddingHorizontal: WayperTheme.spacing.lg,
  },
  primary: {
    backgroundColor: WayperTheme.colors.primary,
    borderColor: WayperTheme.colors.primaryLight,
    ...WayperTheme.shadows.greenGlow,
  },
  secondary: {
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderColor: WayperTheme.colors.borderStrong,
  },
  ghost: {
    backgroundColor: "transparent",
    borderColor: WayperTheme.colors.border,
  },
  cyan: {
    backgroundColor: WayperTheme.colors.cyanSoft,
    borderColor: WayperTheme.colors.cyanBorder,
  },
  danger: {
    backgroundColor: WayperTheme.colors.danger,
    borderColor: WayperTheme.colors.dangerBorder,
    ...WayperTheme.shadows.dangerGlow,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    ...WayperTheme.typography.button,
  },
  primaryText: {
    color: WayperTheme.colors.textInverse,
  },
  secondaryText: {
    color: WayperTheme.colors.text,
  },
  ghostText: {
    color: WayperTheme.colors.text,
  },
  cyanText: {
    color: WayperTheme.colors.cyan,
  },
  dangerText: {
    color: WayperTheme.colors.text,
  },
  icon: {
    marginRight: WayperTheme.spacing.sm,
  },
  rightIcon: {
    marginLeft: WayperTheme.spacing.sm,
  },
});
