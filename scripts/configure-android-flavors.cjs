const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const androidAppDir = path.join(rootDir, "android", "app");
const buildGradlePath = path.join(androidAppDir, "build.gradle");
const manifestPath = path.join(androidAppDir, "src", "main", "AndroidManifest.xml");

const flavorBlock = `    flavorDimensions "environment"
    productFlavors {
        dev {
            dimension "environment"
            applicationId "com.wayper.app.dev"
            manifestPlaceholders = [
                appScheme: "wayper-dev",
                appSchemeExpo: "exp+wayper-dev"
            ]
        }
        prod {
            dimension "environment"
            applicationId "com.wayper.app"
            manifestPlaceholders = [
                appScheme: "wayper",
                appSchemeExpo: "exp+wayper"
            ]
        }
    }
`;

const googleServicesBlock = `def requestedGradleTasks = gradle.startParameter.taskNames.collect { it.toLowerCase(java.util.Locale.ROOT) }
def isDevOnlyBuild = requestedGradleTasks.any { it.contains("dev") } &&
        !requestedGradleTasks.any { it.contains("prod") || it.contains("release") || it.contains("bundle") }

if (isDevOnlyBuild) {
    logger.lifecycle("Skipping Google Services plugin for Wayper Dev. Firebase JS config is loaded from src/firebaseConfig.js.")
} else {
    apply plugin: 'com.google.gms.google-services'
}
`;

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`${label} not found: ${path.relative(rootDir, filePath)}`);
    console.error("Run npm run android:prebuild first if the native Android folder does not exist.");
    process.exit(1);
  }
}

function findMatchingBrace(content, openBraceIndex) {
  let depth = 0;

  for (let index = openBraceIndex; index < content.length; index += 1) {
    const char = content[index];

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function configureBuildGradle() {
  assertFile(buildGradlePath, "Android Gradle file");

  let content = fs.readFileSync(buildGradlePath, "utf8");

  content = content.replace(
    /debuggableVariants\s*=\s*\[[^\]]*]/,
    'debuggableVariants = ["devDebug", "prodDebug"]'
  );

  if (!content.includes('debuggableVariants = ["devDebug", "prodDebug"]')) {
    content = content.replace(
      /(\/\*\s*Variants\s*\*\/[\s\S]*?By default is just 'debug'\.[\s\S]*?\n)/,
      `$1    debuggableVariants = ["devDebug", "prodDebug"]\n`
    );
  }

  if (!content.includes('applicationId "com.wayper.app.dev"')) {
    const defaultConfigIndex = content.indexOf("defaultConfig {");
    if (defaultConfigIndex === -1) {
      console.error("Could not find defaultConfig block in android/app/build.gradle.");
      process.exit(1);
    }

    const defaultConfigOpenBrace = content.indexOf("{", defaultConfigIndex);
    const defaultConfigCloseBrace = findMatchingBrace(content, defaultConfigOpenBrace);

    if (defaultConfigCloseBrace === -1) {
      console.error("Could not parse defaultConfig block in android/app/build.gradle.");
      process.exit(1);
    }

    content = `${content.slice(0, defaultConfigCloseBrace + 1)}\n${flavorBlock}${content.slice(defaultConfigCloseBrace + 1)}`;
  }

  content = content.replace(
    /\napply plugin:\s*['"]com\.google\.gms\.google-services['"]\s*$/m,
    `\n${googleServicesBlock.trimEnd()}`
  );

  if (!content.includes("Skipping Google Services plugin for Wayper Dev")) {
    content = `${content.trimEnd()}\n\n${googleServicesBlock}`;
  }

  fs.writeFileSync(buildGradlePath, content);
}

function configureManifest() {
  assertFile(manifestPath, "Android manifest");

  let content = fs.readFileSync(manifestPath, "utf8");

  content = content
    .replace(/<data android:scheme="wayper"\s*\/>/g, '<data android:scheme="${appScheme}"/>')
    .replace(/<data android:scheme="exp\+wayper"\s*\/>/g, '<data android:scheme="${appSchemeExpo}"/>');

  fs.writeFileSync(manifestPath, content);
}

function writeFlavorString(flavor, appName) {
  const valuesDir = path.join(androidAppDir, "src", flavor, "res", "values");
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.writeFileSync(
    path.join(valuesDir, "strings.xml"),
    `<resources>\n  <string name="app_name">${appName}</string>\n</resources>\n`
  );
}

configureBuildGradle();
configureManifest();
writeFlavorString("dev", "Wayper Dev");
writeFlavorString("prod", "Wayper Prod");

console.log("Configured Android flavors: Wayper Dev (com.wayper.app.dev) and Wayper Prod (com.wayper.app).");
