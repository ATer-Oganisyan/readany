#!/usr/bin/env node
// Refuse a stale installation before a native build can succeed with incompatible modules.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function findPinnedDependencyMismatches(manifest, resolveInstalledVersion) {
  const failures = [];
  for (const [name, expected] of Object.entries(manifest.dependencies ?? {})) {
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(expected)) continue;
    let actual;
    try {
      actual = resolveInstalledVersion(name);
    } catch {
      actual = null;
    }
    if (actual !== expected) failures.push({ name, expected, actual });
  }
  return failures;
}

export function findExpoDependencyMismatches(
  manifest,
  expectedVersions,
  resolveInstalledVersion,
  satisfies,
) {
  const excluded = new Set(manifest.expo?.install?.exclude ?? []);
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const failures = [];
  for (const [name, expected] of Object.entries(expectedVersions)) {
    if (!(name in dependencies) || excluded.has(name)) continue;
    let actual;
    try {
      actual = resolveInstalledVersion(name);
    } catch {
      actual = null;
    }
    if (!actual || !satisfies(actual, expected)) failures.push({ name, expected, actual });
  }
  return failures;
}

export function checkInstalledDependencies(appRoot) {
  const manifestPath = join(appRoot, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const require = createRequire(manifestPath);
  const resolveInstalledVersion = (name) => {
    try {
      return JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")).version;
    } catch {
      // Packages may deliberately hide package.json behind their exports map.
      let directory = dirname(require.resolve(name));
      while (dirname(directory) !== directory) {
        try {
          const candidate = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
          if (candidate.name === name) return candidate.version;
        } catch {
          // Continue to the package root, not to a sibling dependency.
        }
        directory = dirname(directory);
      }
      throw new Error(`Cannot resolve installed version of ${name}`);
    }
  };
  const failures = findPinnedDependencyMismatches(manifest, resolveInstalledVersion);
  if (manifest.dependencies?.expo) {
    const expoPath = require.resolve("expo/package.json");
    const expectedVersions = JSON.parse(
      readFileSync(join(dirname(expoPath), "bundledNativeModules.json"), "utf8"),
    );
    // Semver is an explicit dependency of Expo CLI, not an accidental app dependency.
    const expoRequire = createRequire(expoPath);
    const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
    const { satisfies } = cliRequire("semver");
    const alreadyFailed = new Set(failures.map(({ name }) => name));
    failures.push(
      ...findExpoDependencyMismatches(
        manifest,
        expectedVersions,
        resolveInstalledVersion,
        satisfies,
      ).filter(({ name }) => !alreadyFailed.has(name)),
    );
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const appRoot = resolve(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)));
  const failures = checkInstalledDependencies(appRoot);
  if (failures.length) {
    for (const { name, expected, actual } of failures) {
      console.error(
        `[Narra dependencies] ${name}: expected ${expected}, installed ${actual ?? "missing"}`,
      );
    }
    console.error(
      "Run pnpm install --frozen-lockfile at the repository root, then rebuild the affected native client.",
    );
    process.exitCode = 1;
  } else {
    console.log("[Narra dependencies] Installed pinned dependencies match the app manifest.");
  }
}
