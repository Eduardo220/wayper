const fs = require("node:fs");
const path = require("node:path");

const target = process.argv[2] || "all";
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const apks = {
  dev: {
    source: path.join(rootDir, "android", "app", "build", "outputs", "apk", "dev", "debug", "app-dev-debug.apk"),
    destination: path.join(distDir, "Wayper-dev-debug.apk"),
    buildScript: "android:build:dev",
  },
  prod: {
    source: path.join(rootDir, "android", "app", "build", "outputs", "apk", "prod", "release", "app-prod-release.apk"),
    destination: path.join(distDir, "Wayper-prod-release.apk"),
    buildScript: "android:build:prod",
  },
};

const aliases = {
  debug: "dev",
  release: "prod",
};

const normalizedTarget = aliases[target] || target;
const targets = normalizedTarget === "all" ? Object.keys(apks) : [normalizedTarget];

for (const name of targets) {
  const apk = apks[name];

  if (!apk) {
    console.error(`Unknown APK target: ${name}. Use dev, prod, debug, release, or all.`);
    process.exit(1);
  }

  if (!fs.existsSync(apk.source)) {
    console.error(`APK not found: ${path.relative(rootDir, apk.source)}`);
    console.error(`Run npm run ${apk.buildScript} first.`);
    process.exit(1);
  }

  fs.mkdirSync(distDir, { recursive: true });
  fs.copyFileSync(apk.source, apk.destination);
  console.log(`Copied ${path.relative(rootDir, apk.destination)}`);
}
