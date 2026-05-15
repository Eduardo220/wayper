import { Platform } from "react-native";

export const WayperTheme = {
  name: "Wayper NeoPulse Dark",

  colors: {
    background: "#03070B",
    backgroundAlt: "#050A10",

    surface: "#081018",
    surfaceElevated: "#0B141D",
    surfaceSoft: "#101B25",
    surfaceMuted: "#141F2A",

    primary: "#00E676",
    primaryDark: "#00B85F",
    primaryLight: "#5CFFAA",
    primarySoft: "rgba(0, 230, 118, 0.14)",
    primaryGlow: "rgba(0, 230, 118, 0.45)",
    primaryBorder: "rgba(0, 230, 118, 0.38)",

    cyan: "#38D9FF",
    cyanSoft: "rgba(56, 217, 255, 0.14)",
    cyanBorder: "rgba(56, 217, 255, 0.42)",

    danger: "#FF3347",
    dangerDark: "#CC1F31",
    dangerSoft: "rgba(255, 51, 71, 0.16)",
    dangerBorder: "rgba(255, 51, 71, 0.42)",

    warning: "#FFCC33",

    text: "#F4F7FA",
    textMuted: "#A8B0BA",
    textSubtle: "#6F7A86",
    textInverse: "#031009",

    border: "rgba(255, 255, 255, 0.08)",
    borderStrong: "rgba(255, 255, 255, 0.14)",

    blackGlass: "rgba(3, 7, 11, 0.72)",
    surfaceGlass: "rgba(11, 20, 29, 0.82)",
  },

  radius: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 18,
    xl: 24,
    xxl: 30,
    pill: 999,
  },

  spacing: {
    xxs: 2,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 22,
    xxl: 30,
    page: 22,
  },

  typography: {
    screenTitle: {
      fontSize: 34,
      fontWeight: "800",
      letterSpacing: 0.2,
      color: "#00E676",
    },
    title: {
      fontSize: 24,
      fontWeight: "800",
      letterSpacing: 0.15,
      color: "#F4F7FA",
    },
    subtitle: {
      fontSize: 18,
      fontWeight: "700",
      color: "#F4F7FA",
    },
    body: {
      fontSize: 15,
      fontWeight: "500",
      color: "#F4F7FA",
    },
    label: {
      fontSize: 13,
      fontWeight: "700",
      color: "#A8B0BA",
    },
    caption: {
      fontSize: 12,
      fontWeight: "600",
      color: "#6F7A86",
    },
    button: {
      fontSize: 16,
      fontWeight: "800",
      letterSpacing: 0.2,
    },
  },

  shadows: {
    card: Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.28,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 14 },
      },
      android: {
        elevation: 7,
      },
      default: {},
    }),

    greenGlow: Platform.select({
      ios: {
        shadowColor: "#00E676",
        shadowOpacity: 0.32,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 0 },
      },
      android: {
        elevation: 10,
      },
      default: {},
    }),

    dangerGlow: Platform.select({
      ios: {
        shadowColor: "#FF3347",
        shadowOpacity: 0.34,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 0 },
      },
      android: {
        elevation: 10,
      },
      default: {},
    }),
  },

  map: {
    routeColor: "#00E676",
    routeShadowColor: "rgba(0, 230, 118, 0.40)",
    zoneStroke: "#00E676",
    zoneFill: "rgba(0, 230, 118, 0.18)",
    userDot: "#00E676",
    userDotBorder: "#F4F7FA",
  },
};

export const wp = WayperTheme;
