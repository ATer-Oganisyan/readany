const { withAppBuildGradle, withGradleProperties } = require("expo/config-plugins");

const GRADLE_JVM_ARGS = "-Xmx6144m -XX:MaxMetaspaceSize=1024m";

function upsertGradleProperty(properties, key, value) {
  const existing = properties.find(
    (property) => property.type === "property" && property.key === key,
  );

  if (existing) {
    existing.value = value;
    return properties;
  }

  properties.push({ type: "property", key, value });
  return properties;
}

function removeGradleProperty(properties, key) {
  return properties.filter((property) => !(property.type === "property" && property.key === key));
}

function useOptimizedProguardDefaults(contents) {
  if (contents.includes("proguard-android-optimize.txt")) {
    return contents;
  }

  const defaultRules = /getDefaultProguardFile\((["'])proguard-android\.txt\1\)/;
  if (!defaultRules.test(contents)) {
    throw new Error("withAndroidReleaseOptimization: release ProGuard configuration was not found");
  }

  return contents.replace(defaultRules, 'getDefaultProguardFile("proguard-android-optimize.txt")');
}

function withAndroidReleaseOptimization(config) {
  const configWithGradleProperties = withGradleProperties(config, (gradleConfig) => {
    let properties = removeGradleProperty(gradleConfig.modResults, "android.enableR8.fullMode");
    properties = upsertGradleProperty(properties, "org.gradle.jvmargs", GRADLE_JVM_ARGS);
    properties = upsertGradleProperty(properties, "android.r8.optimizedResourceShrinking", "true");
    gradleConfig.modResults = properties;
    return gradleConfig;
  });

  return withAppBuildGradle(configWithGradleProperties, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new Error("withAndroidReleaseOptimization: Android app build.gradle must use Groovy");
    }

    gradleConfig.modResults.contents = useOptimizedProguardDefaults(
      gradleConfig.modResults.contents,
    );
    return gradleConfig;
  });
}

module.exports = withAndroidReleaseOptimization;
module.exports.GRADLE_JVM_ARGS = GRADLE_JVM_ARGS;
module.exports.removeGradleProperty = removeGradleProperty;
module.exports.upsertGradleProperty = upsertGradleProperty;
module.exports.useOptimizedProguardDefaults = useOptimizedProguardDefaults;
