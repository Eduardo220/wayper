import React, { useState } from "react";
import { StyleSheet, TextInput, View, Text } from "react-native";
import { WayperTheme } from "../../theme/wayperTheme";

export function WPInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  style,
  inputStyle,
  ...props
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={style}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        {...props}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={WayperTheme.colors.textSubtle}
        multiline={multiline}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        style={[styles.input, multiline && styles.multiline, focused && styles.focused, inputStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...WayperTheme.typography.label,
    marginBottom: WayperTheme.spacing.sm,
  },
  input: {
    minHeight: 54,
    borderRadius: WayperTheme.radius.lg,
    backgroundColor: WayperTheme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.border,
    paddingHorizontal: WayperTheme.spacing.lg,
    color: WayperTheme.colors.text,
    fontSize: 15,
    fontWeight: "500",
  },
  multiline: {
    minHeight: 112,
    paddingTop: WayperTheme.spacing.lg,
    textAlignVertical: "top",
  },
  focused: {
    borderColor: WayperTheme.colors.primaryBorder,
    backgroundColor: WayperTheme.colors.surfaceElevated,
  },
});
