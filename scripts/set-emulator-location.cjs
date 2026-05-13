#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const https = require("node:https");

function commandName(command) {
  if (process.platform !== "win32") {
    return command;
  }

  if (command === "adb") {
    return "adb.exe";
  }

  if (command === "powershell") {
    return "powershell.exe";
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

function parseArgs(args) {
  const parsed = {
    optional: false,
    lat: process.env.WAYPER_EMULATOR_LAT || null,
    lng: process.env.WAYPER_EMULATOR_LNG || null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--optional") {
      parsed.optional = true;
      continue;
    }

    if (arg === "--lat") {
      parsed.lat = args[index + 1] || parsed.lat;
      index += 1;
      continue;
    }

    if (arg.startsWith("--lat=")) {
      parsed.lat = arg.slice("--lat=".length) || parsed.lat;
      continue;
    }

    if (arg === "--lng") {
      parsed.lng = args[index + 1] || parsed.lng;
      index += 1;
      continue;
    }

    if (arg.startsWith("--lng=")) {
      parsed.lng = arg.slice("--lng=".length) || parsed.lng;
    }
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

function pickEmulator(devices) {
  const requested = process.env.WAYPER_ANDROID_DEVICE || process.env.ANDROID_SERIAL;
  const emulators = devices.filter((device) => device.id.startsWith("emulator-"));

  if (requested) {
    return emulators.find((device) => device.id === requested) || null;
  }

  return emulators[0] || null;
}

function normalizeNumber(value) {
  if (value === null || value === undefined) {
    return NaN;
  }

  return Number(String(value).replace(",", "."));
}

function isValidLocation(location) {
  return Number.isFinite(location.lat)
    && Number.isFinite(location.lng)
    && location.lat >= -90
    && location.lat <= 90
    && location.lng >= -180
    && location.lng <= 180;
}

function getLocationFromEnv(options) {
  const location = {
    source: "env",
    lat: normalizeNumber(options.lat),
    lng: normalizeNumber(options.lng),
  };

  return isValidLocation(location) ? location : null;
}

function getWindowsLocation() {
  if (process.platform !== "win32") {
    return null;
  }

  const script = `
    Add-Type -AssemblyName System.Device
    $watcher = New-Object System.Device.Location.GeoCoordinateWatcher
    $watcher.Start()
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while (($watcher.Status -ne 'Ready') -and ($sw.Elapsed.TotalSeconds -lt 15)) {
      Start-Sleep -Milliseconds 250
    }
    $coord = $watcher.Position.Location
    if ($coord.IsUnknown) {
      exit 2
    }
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [pscustomobject]@{
      latitude = $coord.Latitude
      longitude = $coord.Longitude
      accuracy = $coord.HorizontalAccuracy
    } | ConvertTo-Json -Compress
  `;

  const result = run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);

  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    const location = {
      source: "windows",
      lat: normalizeNumber(parsed.latitude),
      lng: normalizeNumber(parsed.longitude),
      accuracy: normalizeNumber(parsed.accuracy),
    };

    return isValidLocation(location) ? location : null;
  } catch {
    return null;
  }
}

function getJson(url) {
  return new Promise((resolve) => {
    const request = https.get(url, {
      headers: {
        "User-Agent": "Wayper emulator location helper",
      },
    }, (response) => {
      let body = "";

      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });

    request.on("error", () => resolve(null));
    request.setTimeout(8000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

async function getIpLocation() {
  const parsed = await getJson("https://ipwho.is/");
  if (!parsed || parsed.success === false) {
    return null;
  }

  const location = {
    source: "ip",
    lat: normalizeNumber(parsed.latitude),
    lng: normalizeNumber(parsed.longitude),
  };

  return isValidLocation(location) ? location : null;
}

function fail(message, optional) {
  console.error(message);
  if (optional) {
    process.exit(0);
  }
  process.exit(1);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const adb = run("adb", ["devices"]);

  if (adb.status !== 0) {
    fail("Could not list Android devices with adb.", options.optional);
  }

  const device = pickEmulator(parseDevices(adb.stdout || ""));

  if (!device) {
    fail("No Android emulator found. Start the emulator before running this command.", options.optional);
  }

  const location = getLocationFromEnv(options) || getWindowsLocation() || await getIpLocation();

  if (!location) {
    fail(
      [
        "Could not read your real location from Windows or IP fallback.",
        "Enable Windows Location Services, or run with WAYPER_EMULATOR_LAT and WAYPER_EMULATOR_LNG.",
        "Example: WAYPER_EMULATOR_LAT=-30.0346 WAYPER_EMULATOR_LNG=-51.2177 npm run dev",
      ].join("\n"),
      options.optional,
    );
  }

  const geoFix = run("adb", [
    "-s",
    device.id,
    "emu",
    "geo",
    "fix",
    String(location.lng),
    String(location.lat),
  ], { stdio: "pipe" });

  if (geoFix.status !== 0) {
    fail(`Could not send location to emulator ${device.id}.`, options.optional);
  }

  const accuracy = Number.isFinite(location.accuracy)
    ? ` accuracy ${Math.round(location.accuracy)}m`
    : "";

  console.log(`Emulator ${device.id} location set from ${location.source}:${accuracy}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
