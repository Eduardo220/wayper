#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { loadWayperEnv } = require("./env-loader.cjs");

function commandName(command) {
  if (process.platform !== "win32") return command;
  if (["npm", "npx", "expo", "eas", "sentry-expo-upload-sourcemaps"].includes(command)) {
    return `${command}.cmd`;
  }
  return command;
}

function printUsage() {
  console.error("Usage: node scripts/with-env.cjs <development|production|.env.file> [--set KEY=VALUE] -- <command> [...args]");
}

const args = process.argv.slice(2);
const separatorIndex = args.indexOf("--");

if (args.length < 3 || separatorIndex <= 0 || separatorIndex === args.length - 1) {
  printUsage();
  process.exit(1);
}

const envInput = args[0];
const optionArgs = args.slice(1, separatorIndex);
const commandArgs = args.slice(separatorIndex + 1);
const overrides = {};

for (let index = 0; index < optionArgs.length; index += 1) {
  const option = optionArgs[index];

  if (option === "--set") {
    const assignment = optionArgs[index + 1] || "";
    const equalsIndex = assignment.indexOf("=");

    if (equalsIndex <= 0) {
      console.error(`Invalid --set assignment: ${assignment}`);
      process.exit(1);
    }

    overrides[assignment.slice(0, equalsIndex)] = assignment.slice(equalsIndex + 1);
    index += 1;
    continue;
  }

  console.error(`Unknown option: ${option}`);
  printUsage();
  process.exit(1);
}

try {
  loadWayperEnv(envInput, { rootDir: path.resolve(__dirname, "..") });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

Object.assign(process.env, overrides);

const [command, ...childArgs] = commandArgs;
const resolvedCommand = commandName(command);
const result = spawnSync(resolvedCommand, childArgs, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedCommand),
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
