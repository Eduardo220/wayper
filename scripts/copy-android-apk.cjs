const fs = require("node:fs");
const path = require("node:path");

const target = process.argv[2] || "all";
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const apks = {
  debug: {
    source: path.join(rootDir, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
    destination: path.join(distDir, "Wayper-local-server-debug.apk"),
  },
  release: {
    source: path.join(rootDir, "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
    destination: path.join(distDir, "Wayper-standalone-release.apk"),
  },
};

const targets = target === "all" ? Object.keys(apks) : [target];

for (const name of targets) {
  const apk = apks[name];

  if (!apk) {
    console.error(`Unknown APK target: ${name}. Use debug, release, or all.`);
    process.exit(1);
  }

  if (!fs.existsSync(apk.source)) {
    console.error(`APK not found: ${path.relative(rootDir, apk.source)}`);
    console.error(`Run npm run android:build:${name} first.`);
    process.exit(1);
  }

  fs.mkdirSync(distDir, { recursive: true });
  fs.copyFileSync(apk.source, apk.destination);
  console.log(`Copied ${path.relative(rootDir, apk.destination)}`);
}
