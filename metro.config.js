import path from "node:path";
import { fileURLToPath } from "node:url";
import sentryMetro from "@sentry/react-native/metro.js";

const { getSentryExpoConfig } = sentryMetro;
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const config = getSentryExpoConfig(projectRoot);

export default config;
