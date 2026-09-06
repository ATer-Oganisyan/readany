import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
const plugin = readFileSync(new URL("../../../plugins/withIosSceneLifecycle.js", import.meta.url), "utf8");
const fresh = `class AppDelegate {\n  // Linking API\n}\nclass ReactNativeDelegate: ExpoReactNativeFactoryDelegate {\n  // Extension point for config-plugins\n}\n`;
function transform(contents: string) {
  const module = { exports: undefined as unknown };
  vm.runInNewContext(plugin, { module, require: () => ({
    withInfoPlist: (config: unknown, callback: Function) => { callback({ modResults: {} }); return config; },
    withAppDelegate: (_config: unknown, callback: Function) => callback({ modResults: { language: "swift", contents } }),
  }) });
  return (module.exports as Function)({}).modResults.contents as string;
}
describe("SceneDelegate cold URL regeneration", () => {
  it("does not rewrite identical snippets in neighboring custom classes", () => {
    const sentinel = `class CustomDelegate {\n    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)\n      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])\n}\n`;
    const output = transform(sentinel + fresh + sentinel);
    expect(output.startsWith(sentinel)).toBe(true);
    expect(output).toContain(sentinel + "\nprivate final class NarraRootViewController");
    expect(output.split(sentinel)).toHaveLength(3);
    expect(transform(output)).toBe(output);
  });
  it("generates once and remains idempotent", () => {
    const once = transform(fresh);
    expect(transform(once)).toBe(once);
    expect(once.match(/class SceneDelegate:/g)).toHaveLength(1);
  });
  it("migrates the old generated startup in place and preserves unrelated overrides", () => {
    const expected = transform(fresh).replace("  var window: UIWindow?", "  // own customization\n  var window: UIWindow?");
    const legacy = expected
      .replace(/    \/\/ Let dev-launcher suppress[\s\S]*?factory.startReactNative\([^\n]+\)/,
        '    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)')
      .replace(/      var options: \[UIApplication.OpenURLOptionsKey: Any\][\s\S]*?open: context.url, options: options\)/g,
        '      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])');
    expect(transform(legacy)).toBe(expected);
    expect(transform(transform(legacy))).toBe(expected);
  });
});
