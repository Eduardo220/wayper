const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { inferEnvironmentFromArgs, loadWayperEnv } = require("./env-loader.cjs");

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/run-gradle.cjs <gradle-task> [...args]");
  process.exit(1);
}

const androidDir = path.resolve(__dirname, "..", "android");
const isWindows = process.platform === "win32";
const command = isWindows ? "gradlew.bat" : "./gradlew";
const inferredEnvironment = process.env.WAYPER_ENV || inferEnvironmentFromArgs(args);

if (inferredEnvironment) {
  try {
    loadWayperEnv(inferredEnvironment, { rootDir: path.resolve(__dirname, "..") });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const result = spawnSync(command, args, {
  cwd: androidDir,
  stdio: "inherit",
  shell: isWindows,
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
