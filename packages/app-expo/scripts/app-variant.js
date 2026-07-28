const APP_VARIANTS = {
  development: {
    key: "development",
    name: "Narra Reader Dev",
    bundleIdentifier: "com.narra.reader.dev",
    androidPackage: "com.narra.reader.dev",
    scheme: "narra-reader-dev",
  },
  preview: {
    key: "preview",
    name: "Narra Reader Preview",
    bundleIdentifier: "com.narra.reader.preview",
    androidPackage: "com.narra.reader.preview",
    scheme: "narra-reader-preview",
  },
  production: {
    key: "production",
    name: "Narra Reader",
    bundleIdentifier: "com.narra.reader",
    androidPackage: "com.narra.reader",
    scheme: "narra-reader",
  },
};

const VARIANT_ALIASES = {
  dev: "development",
  development: "development",
  local: "development",
  debug: "development",
  "development-simulator": "development",
  preview: "preview",
  staging: "preview",
  test: "preview",
  prod: "production",
  production: "production",
  release: "production",
};

function normalizeAppVariant(value) {
  const rawVariant = String(value || "")
    .trim()
    .toLowerCase();

  if (VARIANT_ALIASES[rawVariant]) {
    return VARIANT_ALIASES[rawVariant];
  }

  if (rawVariant.includes("production")) {
    return "production";
  }

  if (rawVariant.includes("preview") || rawVariant.includes("staging")) {
    return "preview";
  }

  return "development";
}

function getAppVariant() {
  return normalizeAppVariant(
    process.env.APP_VARIANT || process.env.EAS_BUILD_PROFILE || "development",
  );
}

function getAppVariantConfig() {
  return APP_VARIANTS[getAppVariant()];
}

module.exports = {
  APP_VARIANTS,
  getAppVariant,
  getAppVariantConfig,
  normalizeAppVariant,
};
