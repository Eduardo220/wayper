const fs = require("node:fs");
const path = require("node:path");

const VALID_ENVIRONMENTS = new Set(["development", "production"]);

function stripInlineComment(value) {
  let quote = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];

    if ((char === "\"" || char === "'") && previous !== "\\") {
      quote = quote === char ? null : quote || char;
    }

    if (char === "#" && !quote && /\s/.test(previous || " ")) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
}

function unquoteValue(value) {
  const trimmed = stripInlineComment(value.trim());
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];

  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
    const inner = trimmed.slice(1, -1);
    return first === "\""
      ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, "\"")
      : inner.replace(/\\'/g, "'");
  }

  return trimmed;
}

function parseEnvText(content) {
  const parsed = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalized.indexOf("=");

    if (equalsIndex <= 0) continue;

    const key = normalized.slice(0, equalsIndex).trim();
    const value = normalized.slice(equalsIndex + 1);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    parsed[key] = unquoteValue(value);
  }

  return parsed;
}

function readEnvFile(filePath) {
  return parseEnvText(fs.readFileSync(filePath, "utf8"));
}

function normalizeEnvironment(input) {
  const normalized = String(input || "").trim().toLowerCase();

  if (["dev", "development"].includes(normalized)) return "development";
  if (["prod", "production", "release"].includes(normalized)) return "production";

  return null;
}

function envFileForInput(rootDir, input) {
  const normalized = String(input || "").trim();

  if (!normalized) return null;

  if (normalized.startsWith(".env")) {
    return path.resolve(rootDir, normalized);
  }

  const environment = normalizeEnvironment(normalized);
  return environment ? path.join(rootDir, `.env.${environment}`) : path.resolve(rootDir, normalized);
}

function inferEnvironmentFromFile(filePath) {
  const name = path.basename(filePath).toLowerCase();

  if (name.includes("development")) return "development";
  if (name.includes("production")) return "production";

  return null;
}

function inferEnvironmentFromArgs(args = []) {
  const text = args.join(" ").toLowerCase();

  if (text.includes("prod")) return "production";
  if (text.includes("dev")) return "development";
  if (text.includes("release") || text.includes("bundle")) return "production";
  if (text.includes("debug")) return "development";

  return null;
}

function applyEnv(values, { override = true } = {}) {
  for (const [key, value] of Object.entries(values)) {
    if (override || process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function loadWayperEnv(input, options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, "..");
  const envFile = envFileForInput(rootDir, input || process.env.WAYPER_ENV || "development");
  const environment = normalizeEnvironment(input) || inferEnvironmentFromFile(envFile);
  const loadedFiles = [];
  const missingFiles = [];

  for (const filePath of [envFile, `${envFile}.local`]) {
    if (!fs.existsSync(filePath)) {
      missingFiles.push(filePath);
      continue;
    }

    applyEnv(readEnvFile(filePath), { override: true });
    loadedFiles.push(filePath);
  }

  if (environment && options.setNodeEnv !== false) {
    process.env.NODE_ENV = environment === "production" ? "production" : "development";
  }

  if (environment && !process.env.EXPO_PUBLIC_APP_ENV) {
    process.env.EXPO_PUBLIC_APP_ENV = environment;
  }

  process.env.WAYPER_ENV_FILE = path.relative(rootDir, envFile);
  process.env.WAYPER_ENV_FILES_LOADED = loadedFiles.map((filePath) => path.relative(rootDir, filePath)).join(",");

  if (!loadedFiles.length && options.required !== false) {
    throw new Error(`No Wayper env file loaded for "${input}". Expected ${path.relative(rootDir, envFile)}.`);
  }

  return {
    environment,
    envFile,
    loadedFiles,
    missingFiles,
  };
}

module.exports = {
  VALID_ENVIRONMENTS,
  inferEnvironmentFromArgs,
  loadWayperEnv,
  normalizeEnvironment,
  parseEnvText,
  readEnvFile,
};
