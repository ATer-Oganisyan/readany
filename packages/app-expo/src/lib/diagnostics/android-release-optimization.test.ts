import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  GRADLE_JVM_ARGS,
  removeGradleProperty,
  upsertGradleProperty,
  useOptimizedProguardDefaults,
} = require("../../../plugins/withAndroidReleaseOptimization") as {
  GRADLE_JVM_ARGS: string;
  removeGradleProperty: (properties: GradleProperty[], key: string) => GradleProperty[];
  upsertGradleProperty: (
    properties: GradleProperty[],
    key: string,
    value: string,
  ) => GradleProperty[];
  useOptimizedProguardDefaults: (contents: string) => string;
};

type GradleProperty =
  | { type: "property"; key: string; value: string }
  | { type: "comment"; value: string };

describe("Android release optimization config plugin", () => {
  it("switches release builds to the optimized R8 defaults", () => {
    const source =
      'proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"';

    expect(useOptimizedProguardDefaults(source)).toContain(
      'getDefaultProguardFile("proguard-android-optimize.txt")',
    );
  });

  it("keeps the ProGuard replacement idempotent", () => {
    const source =
      'proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"';

    expect(useOptimizedProguardDefaults(source)).toBe(source);
  });

  it("enables optimized resource shrinking and enough memory for R8", () => {
    let properties: GradleProperty[] = [
      { type: "comment", value: "Gradle settings" },
      { type: "property", key: "org.gradle.jvmargs", value: "-Xmx2048m" },
      { type: "property", key: "android.enableR8.fullMode", value: "false" },
    ];

    properties = removeGradleProperty(properties, "android.enableR8.fullMode");
    properties = upsertGradleProperty(properties, "org.gradle.jvmargs", GRADLE_JVM_ARGS);
    properties = upsertGradleProperty(properties, "android.r8.optimizedResourceShrinking", "true");

    expect(properties).toContainEqual({
      type: "property",
      key: "org.gradle.jvmargs",
      value: "-Xmx6144m -XX:MaxMetaspaceSize=1024m",
    });
    expect(properties).toContainEqual({
      type: "property",
      key: "android.r8.optimizedResourceShrinking",
      value: "true",
    });
    expect(properties).not.toContainEqual(
      expect.objectContaining({ key: "android.enableR8.fullMode" }),
    );
  });
});
