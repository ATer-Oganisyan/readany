const fs = require("node:fs");
const path = require("node:path");
const { getAppVariantConfig } = require("./app-variant");

const appRoot = path.resolve(__dirname, "..");

function firstExistingPath(...candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const iosProjectPath = firstExistingPath(
  path.join(appRoot, "ios", "ReadAnyDev.xcodeproj", "project.pbxproj"),
  path.join(appRoot, "ios", "ReadAny.xcodeproj", "project.pbxproj"),
  path.join(appRoot, "ios", "Narra.xcodeproj", "project.pbxproj"),
);
const iosInfoPlistPath = firstExistingPath(
  path.join(appRoot, "ios", "ReadAnyDev", "Info.plist"),
  path.join(appRoot, "ios", "ReadAny", "Info.plist"),
  path.join(appRoot, "ios", "Narra", "Info.plist"),
);

function replaceAll(content, pattern, replacement) {
  pattern.lastIndex = 0;
  if (!pattern.test(content)) {
    throw new Error(`Unable to apply native variant replacement: ${pattern}`);
  }
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

function syncIosProject(variant) {
  if (!iosProjectPath) {
    return false;
  }

  let project = fs.readFileSync(iosProjectPath, "utf8");
  project = replaceAll(
    project,
    /PRODUCT_BUNDLE_IDENTIFIER = ("[^"]+"|[^;]+);/g,
    `PRODUCT_BUNDLE_IDENTIFIER = "${variant.bundleIdentifier}";`,
  );
  project = replaceAll(
    project,
    /PRODUCT_NAME = ("[^"]+"|[^;]+);/g,
    `PRODUCT_NAME = "${variant.name}";`,
  );
  fs.writeFileSync(iosProjectPath, project);
  return true;
}

function syncIosInfoPlist(variant) {
  if (!iosInfoPlistPath) {
    return false;
  }

  let plist = fs.readFileSync(iosInfoPlistPath, "utf8");
  plist = replaceAll(
    plist,
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1${variant.name}$2`,
  );
  plist = replaceAll(
    plist,
    /<string>readany(?:-(?:dev|preview))?<\/string>/g,
    `<string>${variant.scheme}</string>`,
  );
  plist = replaceAll(
    plist,
    /<string>(?:com\.readany\.app(?:\.(?:dev|preview))?|com\.mishanaer\.readany\.dev)<\/string>/g,
    `<string>${variant.bundleIdentifier}</string>`,
  );
  plist = replaceAll(
    plist,
    /<string>exp\+readany(?:-(?:dev|preview))?<\/string>/g,
    `<string>exp+${variant.scheme}</string>`,
  );
  fs.writeFileSync(iosInfoPlistPath, plist);
  return true;
}

function main() {
  const variant = getAppVariantConfig();
  const syncedProject = syncIosProject(variant);
  const syncedInfoPlist = syncIosInfoPlist(variant);

  if (syncedProject || syncedInfoPlist) {
    console.log(`Synced iOS native variant: ${variant.key} (${variant.bundleIdentifier})`);
  } else {
    console.log("No iOS native project found; Expo config will provide variants.");
  }
}

main();
