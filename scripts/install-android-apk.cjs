#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function commandName(command) {
  if (process.platform !== "win32") {
    return command;
  }

  return command === "adb" ? "adb.exe" : command;
}

function run(command, args, options = {}) {
  return spawnSync(commandName(command), args, {
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

function parseArgs(args) {
  const parsed = {
    apkPath: null,
    target: "any",
    packageName: "com.wayper.app",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--target") {
      parsed.target = args[index + 1] || parsed.target;
      index += 1;
      continue;
    }

    if (arg.startsWith("--target=")) {
      parsed.target = arg.slice("--target=".length) || parsed.target;
      continue;
    }

    if (arg === "--package") {
      parsed.packageName = args[index + 1] || parsed.packageName;
      index += 1;
      continue;
    }

    if (arg.startsWith("--package=")) {
      parsed.packageName = arg.slice("--package=".length) || parsed.packageName;
      continue;
    }

    if (!parsed.apkPath) {
      parsed.apkPath = arg;
    }
  }

  if (!parsed.apkPath) {
    console.error("Usage: node scripts/install-android-apk.cjs <apk-path> [--target any|emulator|physical]");
    process.exit(1);
  }

  if (!["any", "emulator", "physical"].includes(parsed.target)) {
    console.error(`Invalid target "${parsed.target}". Use any, emulator, or physical.`);
    process.exit(1);
  }

  return parsed;
}

function parseDevices(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices"))
    .map((line) => {
      const [id, state] = line.split(/\s+/);
      return { id, state };
    })
    .filter((device) => device.id && device.state === "device");
}

function filterDevicesByTarget(devices, target) {
  if (target === "emulator") {
    return devices.filter((device) => device.id.startsWith("emulator-"));
  }

  if (target === "physical") {
    return devices.filter((device) => !device.id.startsWith("emulator-"));
  }

  return devices;
}

function pickDevice(devices, target) {
  const requested = process.env.WAYPER_ANDROID_DEVICE || process.env.ANDROID_SERIAL;
  const matchingTarget = filterDevicesByTarget(devices, target);

  if (requested) {
    const found = matchingTarget.find((device) => device.id === requested);
    if (!found) {
      console.error(`Device "${requested}" not found for target "${target}".`);
      process.exit(1);
    }
    return found;
  }

  const device = target === "any"
    ? matchingTarget.find((item) => !item.id.startsWith("emulator-")) || matchingTarget[0]
    : matchingTarget[0];

  if (!device) {
    const label = target === "physical" ? "physical Android device" : "Android emulator";
    console.error(`No ${label} found.`);
    process.exit(1);
  }

  return device;
}

const options = parseArgs(process.argv.slice(2));
const apkPath = path.resolve(options.apkPath);

if (!fs.existsSync(apkPath)) {
  console.error(`APK not found: ${apkPath}`);
  process.exit(1);
}

const adb = run("adb", ["devices"]);
if (adb.status !== 0) {
  console.error("Could not list Android devices with adb.");
  if (adb.stderr) console.error(adb.stderr.trim());
  process.exit(adb.status || 1);
}

const devices = parseDevices(adb.stdout || "");
const device = pickDevice(devices, options.target);

console.log(`Installing ${apkPath} on ${device.id}`);

const install = run("adb", ["-s", device.id, "install", "-r", apkPath], { stdio: "inherit" });
if (install.status !== 0) {
  process.exit(install.status || 1);
}

console.log(`Launching ${options.packageName} on ${device.id}`);

const launch = run("adb", [
  "-s",
  device.id,
  "shell",
  "monkey",
  "-p",
  options.packageName,
  "-c",
  "android.intent.category.LAUNCHER",
  "1",
], { stdio: "inherit" });

process.exit(launch.status || 0);
