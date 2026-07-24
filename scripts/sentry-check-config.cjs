#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  loadWayperEnv,
  parseEnvText,
  readEnvFile,
} = require("./env-loader.cjs");

const root = process.cwd();
const args = process.argv.slice(2);
const committedSecretKeys = new Set(["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT", "EXPO_PUBLIC_SENTRY_DSN"]);
let hasFailure = false;

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

function readText(file) {
  try {
    return fs.readFileSync(path.join(root, file), "utf8");
  } catch {
    return "";
  }
}

function getArgValue(name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);

  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function hasSentryExpoPlugin(appJson) {
  const plugins = appJson?.expo?.plugins || [];
  return plugins.some((plugin) => {
    if (plugin === "@sentry/react-native/expo") return true;
    return Array.isArray(plugin) && plugin[0] === "@sentry/react-native/expo";
  });
}

function getSentryExpoPluginOptions(appJson) {
  const plugins = appJson?.expo?.plugins || [];
  const plugin = plugins.find((entry) => Array.isArray(entry) && entry[0] === "@sentry/react-native/expo");
  return plugin?.[1] || {};
}

function statusLine(ok, label, detail = "", level = "WARN") {
  const marker = ok ? "OK" : level;
  console.log(`${marker} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok && level === "FAIL") hasFailure = true;
}

function maskPresence(value) {
  return value ? "configured" : "not configured";
}

const envInput = getArgValue("--env") || getArgValue("--env-file");
if (envInput) {
  try {
    const result = loadWayperEnv(envInput, { rootDir: root });
    statusLine(true, "Wayper env loaded", result.loadedFiles.map((file) => path.relative(root, file)).join(", "));
  } catch (error) {
    statusLine(false, "Wayper env loaded", error.message, "FAIL");
  }
}

const packageJson = readJson("package.json");
const appJson = readJson("app.json");
const easJson = readJson("eas.json");
const metroConfig = readText("metro.config.js");
const appEntry = readText("App.js");
const androidBuildGradle = readText("android/app/build.gradle");
const sentryPluginOptions = getSentryExpoPluginOptions(appJson);
const env = process.env;

const deps = {
  ...(packageJson.dependencies || {}),
  ...(packageJson.devDependencies || {}),
};

const sentryPackage = deps["@sentry/react-native"];
const legacySentryExpo = deps["sentry-expo"];

statusLine(Boolean(sentryPackage), "@sentry/react-native dependency", sentryPackage || "missing");
statusLine(!legacySentryExpo, "legacy sentry-expo dependency", legacySentryExpo ? "present" : "not present");
statusLine(hasSentryExpoPlugin(appJson), "Expo Sentry config plugin", "@sentry/react-native/expo");
statusLine(
  metroConfig.includes("getSentryExpoConfig"),
  "Metro Sentry config",
  metroConfig.includes("getSentryExpoConfig") ? "getSentryExpoConfig found" : "missing"
);
statusLine(
  androidBuildGradle.includes("@sentry/react-native") && androidBuildGradle.includes("sentry.gradle"),
  "Android Gradle Sentry step",
  androidBuildGradle.includes("sentry.gradle") ? "sentry.gradle found" : "missing"
);
statusLine(
  appEntry.includes("initializeMonitoring("),
  "App runtime Sentry initialization",
  appEntry.includes("initializeMonitoring(") ? "initializeMonitoring found" : "missing",
  "FAIL"
);
statusLine(
  appEntry.includes("wrapWithMonitoring("),
  "App Sentry component wrapper",
  appEntry.includes("wrapWithMonitoring(") ? "wrapWithMonitoring found" : "missing",
  "WARN"
);

for (const envFile of [".env.development", ".env.production", ".env.example"]) {
  const filePath = path.join(root, envFile);
  const exists = fs.existsSync(filePath);
  statusLine(exists, `${envFile} exists`, exists ? "found" : "missing", envFile === ".env.example" ? "FAIL" : "WARN");

  if (!exists) continue;

  const values = readEnvFile(filePath);
  if (envFile === ".env.example") {
    for (const key of committedSecretKeys) {
      if (values[key]) {
        statusLine(false, `${envFile} ${key}`, "value must stay out of committed example env", "FAIL");
      }
    }
  }
}

const exampleValues = parseEnvText(readText(".env.example"));
for (const key of [
  "EXPO_PUBLIC_SENTRY_DSN",
  "EXPO_PUBLIC_SENTRY_ENABLED",
  "EXPO_PUBLIC_SENTRY_ENABLE_DEV",
  "EXPO_PUBLIC_SENTRY_TEST_ENABLED",
  "EXPO_PUBLIC_SENTRY_DEBUG",
  "EXPO_PUBLIC_APP_ENV",
  "EXPO_PUBLIC_BUILD_PROFILE",
  "EXPO_PUBLIC_APP_VARIANT",
  "EXPO_PUBLIC_APPLICATION_ID",
  "EXPO_PUBLIC_EAS_UPDATE_CHANNEL",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
]) {
  statusLine(Object.prototype.hasOwnProperty.call(exampleValues, key), `.env.example ${key}`, "documented");
}

for (const [profile, config] of Object.entries(easJson.build || {})) {
  const appEnv = config?.env?.EXPO_PUBLIC_APP_ENV;
  const buildProfile = config?.env?.EXPO_PUBLIC_BUILD_PROFILE;
  const appVariant = config?.env?.EXPO_PUBLIC_APP_VARIANT;
  const applicationId = config?.env?.EXPO_PUBLIC_APPLICATION_ID;
  const updateChannel = config?.env?.EXPO_PUBLIC_EAS_UPDATE_CHANNEL;
  statusLine(Boolean(appEnv), `EAS ${profile} EXPO_PUBLIC_APP_ENV`, appEnv || "missing");
  statusLine(Boolean(buildProfile), `EAS ${profile} EXPO_PUBLIC_BUILD_PROFILE`, buildProfile || "missing");
  statusLine(Boolean(appVariant), `EAS ${profile} EXPO_PUBLIC_APP_VARIANT`, appVariant || "missing");
  statusLine(Boolean(applicationId), `EAS ${profile} EXPO_PUBLIC_APPLICATION_ID`, applicationId || "missing");
  statusLine(Boolean(updateChannel), `EAS ${profile} EXPO_PUBLIC_EAS_UPDATE_CHANNEL`, updateChannel || "missing");
}

const appEnv = env.EXPO_PUBLIC_APP_ENV || "not configured";
const appVariant = env.EXPO_PUBLIC_APP_VARIANT || "not configured";
const applicationId = env.EXPO_PUBLIC_APPLICATION_ID || "not configured";
const sentryEnabled = env.EXPO_PUBLIC_SENTRY_ENABLED !== "false";
const sentryDsnConfigured = Boolean(env.EXPO_PUBLIC_SENTRY_DSN);

statusLine(Boolean(env.EXPO_PUBLIC_APP_ENV), "runtime EXPO_PUBLIC_APP_ENV", appEnv);
statusLine(Boolean(env.EXPO_PUBLIC_APP_VARIANT), "runtime EXPO_PUBLIC_APP_VARIANT", appVariant);
statusLine(Boolean(env.EXPO_PUBLIC_APPLICATION_ID), "runtime EXPO_PUBLIC_APPLICATION_ID", applicationId);
statusLine(sentryDsnConfigured, "runtime DSN env", maskPresence(env.EXPO_PUBLIC_SENTRY_DSN));
statusLine(
  !(sentryEnabled && appEnv === "production" && !sentryDsnConfigured),
  "production runtime Sentry readiness",
  sentryEnabled && appEnv === "production" && !sentryDsnConfigured
    ? "set EXPO_PUBLIC_SENTRY_DSN in EAS env or .env.production.local"
    : "not blocking"
);
statusLine(Boolean(env.SENTRY_ORG || sentryPluginOptions.organization), "SENTRY_ORG", env.SENTRY_ORG ? "configured in env" : sentryPluginOptions.organization ? "using app config" : "not present in this shell");
statusLine(Boolean(env.SENTRY_PROJECT || sentryPluginOptions.project), "SENTRY_PROJECT", env.SENTRY_PROJECT ? "configured in env" : sentryPluginOptions.project ? "using app config" : "not present in this shell");
statusLine(Boolean(env.SENTRY_AUTH_TOKEN), "SENTRY_AUTH_TOKEN", env.SENTRY_AUTH_TOKEN ? "configured in env" : "not present in this shell");

if (args.includes("--test-event")) {
  console.log("");
  console.log("Runtime test event is sent inside the app from Configuracoes > Diagnostico > Enviar erro de teste para Sentry.");
  console.log("This script does not print tokens and does not send an event by itself.");
}

process.exit(hasFailure ? 1 : 0);
