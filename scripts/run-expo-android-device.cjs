#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { inferEnvironmentFromArgs, loadWayperEnv } = require("./env-loader.cjs");

function commandName(command) {
  if (process.platform !== "win32") {
    return command;
  }

  if (command === "npx") {
    return "npx.cmd";
  }

  if (command === "adb") {
    return "adb.exe";
  }

  return command;
}

function run(command, args, options = {}) {
  return spawnSync(commandName(command), args, {
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

function cleanAdbLine(line) {
  return line.replace(/\r/g, "").trim();
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

function getAdbValue(deviceId, args) {
  const result = run("adb", ["-s", deviceId, ...args]);
  if (result.status !== 0) {
    return null;
  }

  return (result.stdout || "")
    .split(/\r?\n/)
    .map(cleanAdbLine)
    .find((line) => line && line !== "OK") || null;
}

function resolveExpoDeviceName(deviceId) {
  if (deviceId.startsWith("emulator-")) {
    return getAdbValue(deviceId, ["emu", "avd", "name"]) || deviceId;
  }

  return getAdbValue(deviceId, ["shell", "getprop", "ro.product.model"]) || deviceId;
}

function parseArgs(args) {
  let target = "any";
  const expoArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--target") {
      target = args[index + 1] || target;
      index += 1;
      continue;
    }

    if (arg.startsWith("--target=")) {
      target = arg.slice("--target=".length) || target;
      continue;
    }

    expoArgs.push(arg);
  }

  if (!["any", "emulator", "physical"].includes(target)) {
    console.error(`Invalid target "${target}". Use any, emulator, or physical.`);
    process.exit(1);
  }

  return { target, expoArgs };
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
    const found = matchingTarget.find((device) => device.id === requested || device.expoName === requested);
    if (!found) {
      console.error(`Device "${requested}" not found for target "${target}".`);
      console.error("Available matching devices:");
      matchingTarget.forEach((device) => console.error(`- ${device.id} (${device.expoName})`));
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
    console.error(target === "physical"
      ? "Connect your phone with USB debugging enabled, then run adb devices again."
      : "Start an Android emulator, then run adb devices again.");
    process.exit(1);
  }

  return device;
}

const { target, expoArgs } = parseArgs(process.argv.slice(2));
const inferredEnvironment = process.env.WAYPER_ENV || inferEnvironmentFromArgs(expoArgs);

if (inferredEnvironment) {
  try {
    loadWayperEnv(inferredEnvironment, { rootDir: path.resolve(__dirname, "..") });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const adb = run("adb", ["devices"]);

if (adb.status !== 0) {
  console.error("Could not list Android devices with adb.");
  if (adb.stderr) console.error(adb.stderr.trim());
  process.exit(adb.status || 1);
}

const devices = parseDevices(adb.stdout || "").map((device) => ({
  ...device,
  expoName: resolveExpoDeviceName(device.id),
}));

if (devices.length === 0) {
  console.error("No Android device found.");
  console.error("Connect your phone with USB debugging enabled, or start an emulator, then run this command again.");
  process.exit(1);
}

const device = pickDevice(devices, target);
const args = ["expo", "run:android", "--device", device.expoName, ...expoArgs];

console.log(`Using Android device: ${device.id} (${device.expoName})`);

const expo = run("npx", args, { stdio: "inherit" });
process.exit(expo.status || 0);
