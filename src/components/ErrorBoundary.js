import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WayperTheme } from "../theme/wayperTheme";
import { checkpointOnCaughtError } from "../services/run/runAutoSaveService.js";
import { reportError } from "../services/diagnostics/errorReporter.js";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    reportError(error, {
      event: "REACT_ERROR_BOUNDARY",
      source: "ErrorBoundary",
      screen: this.props.screen || null,
      componentStack: info?.componentStack || null,
    });
    checkpointOnCaughtError(error, {
      reason: "react_error_boundary",
      componentStack: info?.componentStack ? "captured" : null,
    });
  }

  retryRender = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.title}>Wayper preservou sua corrida</Text>
          <Text style={styles.message}>
            Tivemos um erro de tela, mas o checkpoint local foi acionado. Reabra o app para recuperar a atividade.
          </Text>
          <View style={styles.status}>
            <ActivityIndicator size="small" color={WayperTheme.colors.primary} />
            <Text style={styles.statusText}>Checkpoint local</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.retryButton}
            onPress={this.retryRender}
          >
            <Text style={styles.retryButtonText}>Tentar restaurar tela</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WayperTheme.colors.background,
    padding: WayperTheme.spacing.page,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    padding: WayperTheme.spacing.xl,
    borderRadius: WayperTheme.radius.xxl,
    backgroundColor: WayperTheme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    ...WayperTheme.shadows.card,
  },
  title: {
    color: WayperTheme.colors.text,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  message: {
    color: WayperTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    textAlign: "center",
    marginTop: WayperTheme.spacing.md,
  },
  status: {
    minHeight: 44,
    alignSelf: "center",
    paddingHorizontal: WayperTheme.spacing.lg,
    borderRadius: WayperTheme.radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: WayperTheme.spacing.sm,
    backgroundColor: WayperTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: WayperTheme.colors.primaryBorder,
    marginTop: WayperTheme.spacing.xl,
  },
  statusText: {
    color: WayperTheme.colors.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  retryButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: WayperTheme.radius.pill,
    backgroundColor: WayperTheme.colors.primary,
    marginTop: WayperTheme.spacing.md,
    paddingHorizontal: WayperTheme.spacing.lg,
  },
  retryButtonText: {
    color: WayperTheme.colors.background,
    fontSize: 14,
    fontWeight: "900",
  },
});
