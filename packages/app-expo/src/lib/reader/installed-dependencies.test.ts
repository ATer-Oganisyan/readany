import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  findExpoDependencyMismatches,
  findPinnedDependencyMismatches,
} from "../../../scripts/check-installed-dependencies.mjs";

const script = fileURLToPath(
  new URL("../../../scripts/check-installed-dependencies.mjs", import.meta.url),
);

it("accepts the reviewed RN patch despite stale bundled Expo metadata, but still rejects stale or missing installs", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  );
  const require = createRequire(import.meta.url);
  const cliRequire = createRequire(require.resolve("@expo/cli/package.json"));
  const { satisfies } = cliRequire("semver");
  const resolveVersion = (rn: string | null) => (name: string) => {
    if (name === "react-native") return rn;
    return manifest.dependencies[name];
  };
  expect(manifest.dependencies["react-native"]).toBe("0.86.3");
  expect(
    findExpoDependencyMismatches(
      manifest,
      { "react-native": "0.86.2" },
      resolveVersion("0.86.3"),
      satisfies,
    ),
  ).toEqual([]);
  expect(findPinnedDependencyMismatches(manifest, resolveVersion("0.86.3"))).toEqual([]);
  for (const actual of ["0.86.2", "0.87.0", null]) {
    expect(findPinnedDependencyMismatches(manifest, resolveVersion(actual))).toContainEqual({
      name: "react-native",
      expected: "0.86.3",
      actual,
    });
  }
});

it("checks Expo-supported semver ranges without rejecting explicit SDK exclusions or uninstalled optional modules", () => {
  const require = createRequire(import.meta.url);
  const cliRequire = createRequire(require.resolve("@expo/cli/package.json"));
  const { satisfies } = cliRequire("semver");
  const manifest = {
    dependencies: { "expo-file-system": "^57.0.0", "react-native-screens": "4.25.2" },
    expo: { install: { exclude: ["react-native-screens"] } },
  };
  const expected = {
    "expo-file-system": "~57.0.2",
    "react-native-screens": "~4.26.0",
    "expo-camera": "~57.0.0",
  };
  expect(findExpoDependencyMismatches(manifest, expected, () => "57.0.3", satisfies)).toEqual([]);
  expect(findExpoDependencyMismatches(manifest, expected, () => "56.0.9", satisfies)).toEqual([
    { name: "expo-file-system", expected: "~57.0.2", actual: "56.0.9" },
  ]);
});

it("refuses a stale installed native dependency even when the app manifest is correct", () => {
  const root = mkdtempSync(join(tmpdir(), "narra-installed-deps-"));
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { "@expo/dom-webview": "57.0.1", "@readany/core": "workspace:*" },
      }),
    );
    const installed = join(root, "node_modules", "@expo", "dom-webview");
    mkdirSync(installed, { recursive: true });
    const setVersion = (version: string) =>
      writeFileSync(
        join(installed, "package.json"),
        JSON.stringify({
          name: "@expo/dom-webview",
          version,
        }),
      );
    const check = () =>
      execFileSync(process.execPath, [script, root], { encoding: "utf8", stdio: "pipe" });
    setVersion("55.0.6");
    expect(check).toThrow(/expected 57\.0\.1, installed 55\.0\.6/);
    setVersion("57.0.1");
    expect(check()).toContain("match the app manifest");
    rmSync(installed, { recursive: true });
    expect(check).toThrow(/expected 57\.0\.1, installed missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("resolves a package that hides its manifest behind an exports map", () => {
  const root = mkdtempSync(join(tmpdir(), "narra-hidden-package-manifest-"));
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { "native-fixture": "1.0.0" } }),
    );
    const installed = join(root, "node_modules", "native-fixture");
    mkdirSync(installed, { recursive: true });
    writeFileSync(
      join(installed, "package.json"),
      JSON.stringify({
        name: "native-fixture",
        version: "1.0.0",
        exports: "./index.js",
      }),
    );
    writeFileSync(join(installed, "index.js"), "module.exports = {};");
    expect(execFileSync(process.execPath, [script, root], { encoding: "utf8" })).toContain(
      "match the app manifest",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
