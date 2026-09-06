import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("does not require a native rebuild for test scripts, but detects dependency changes", () => {
  const wrapper = readFileSync(fileURLToPath(new URL("../../../script/build_and_run.sh", import.meta.url)), "utf8");
  const fingerprint = wrapper.match(/^native_fingerprint\(\) \{\n[\s\S]*?^\}/m)?.[0];
  expect(fingerprint).toBeDefined();
  const root = mkdtempSync(join(tmpdir(), "narra-native-fingerprint-"));
  try {
    const appRoot = join(root, "app");
    mkdirSync(join(appRoot, "scripts"), { recursive: true });
    const path = join(appRoot, "package.json");
    const manifest = { dependencies: { expo: "57.0.14" }, scripts: { test: "vitest run" } };
    writeFileSync(path, JSON.stringify(manifest));
    const run = () => execFileSync("bash", ["-c", `${fingerprint}\nnative_fingerprint`], {
      env: { ...process.env, APP_ROOT: appRoot, MONOREPO_ROOT: root },
      encoding: "utf8",
    }).trim();
    const initial = run();
    // Building Android must not invalidate the already-built iOS client.
    const generated = join(appRoot, "modules", "native-controls", "android", "build");
    mkdirSync(generated, { recursive: true });
    writeFileSync(join(generated, "classes.jar"), "generated Android bytecode");
    expect(run()).toBe(initial);
    const androidSource = join(appRoot, "modules", "native-controls", "android", "src");
    mkdirSync(androidSource, { recursive: true });
    writeFileSync(join(androidSource, "Control.kt"), "class Control {}");
    expect(run()).toBe(initial);
    const nativeSource = join(appRoot, "modules", "native-controls", "ios");
    mkdirSync(nativeSource, { recursive: true });
    writeFileSync(join(nativeSource, "Control.swift"), "class Control {}");
    expect(run()).not.toBe(initial);
    rmSync(nativeSource, { recursive: true });
    manifest.scripts.test += " src/stores";
    writeFileSync(path, JSON.stringify(manifest));
    expect(run()).toBe(initial);
    manifest.dependencies.expo = "58.0.0";
    writeFileSync(path, JSON.stringify(manifest));
    expect(run()).not.toBe(initial);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
