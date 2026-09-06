import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = new URL('../../', import.meta.url);
const temporary = mkdtempSync(join(tmpdir(), 'narra-scene-startup-'));
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000 });
const plugin = readFileSync(new URL('packages/app-expo/plugins/withIosSceneLifecycle.js', root), 'utf8');
const module = { exports: {} };
vm.runInNewContext(plugin, { module, require: () => ({
  withInfoPlist: (config, callback) => { callback({ modResults: {} }); return config; },
  withAppDelegate: (config, callback) => callback({ modResults: { language: 'swift', contents: 'class AppDelegate {\n  // Linking API\n}\nclass ReactNativeDelegate: ExpoReactNativeFactoryDelegate {\n  // Extension point for config-plugins\n}\n' } }),
}) });
const generated = module.exports({}).modResults.contents;
const scene = generated.slice(generated.indexOf('class SceneDelegate:'), generated.indexOf('class ReactNativeDelegate:'));
const legacy = scene.replace(/    \/\/ Let dev-launcher suppress[\s\S]*?factory.startReactNative\([^\n]+\)/,
  '    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)');
assert.notEqual(scene, legacy);
const launcher = readFileSync(new URL('node_modules/expo-dev-launcher/ios/EXDevLauncherController.m', root), 'utf8');
const condition = launcher.match(/if \(_lastOpenedAppUrl != nil && shouldTryToLaunchLastOpenedBundle && \[launchOptions objectForKey:@"UIApplicationLaunchOptionsURLKey"\] == nil\)/)?.[0];
assert.ok(condition, 'Update harness if actual native startup admission changes');
const header = join(temporary, 'guard.h'), objc = join(temporary, 'guard.m'), object = join(temporary, 'guard.o');
writeFileSync(header, '#import <Foundation/Foundation.h>\nint NarraAutoLaunch(NSDictionary *launchOptions);\n');
writeFileSync(objc, `#import "guard.h"\nint NarraAutoLaunch(NSDictionary *launchOptions) { NSURL *_lastOpenedAppUrl = [NSURL URLWithString:@"http://fixture"]; BOOL shouldTryToLaunchLastOpenedBundle = YES; ${condition} { return 1; } return 0; }`);
const sdk = run('xcrun', ['--sdk', 'macosx', '--show-sdk-path']); assert.equal(sdk.status, 0);
const compileGuard = run('xcrun', ['clang', '-isysroot', sdk.stdout.trim(), '-fobjc-arc', '-c', objc, '-o', object]);
assert.equal(compileGuard.status, 0, compileGuard.stderr);
const fixture = readFileSync(new URL('./ios-scene-startup-harness.swift', import.meta.url), 'utf8');
for (const [label, actualScene] of [['legacy', legacy], ['fixed', scene]]) {
  const swift = join(temporary, `${label}.swift`), binary = join(temporary, label);
  writeFileSync(swift, fixture.replace('// ACTUAL_SCENE_DELEGATE', actualScene));
  const built = run('xcrun', ['swiftc', '-sdk', sdk.stdout.trim(), '-import-objc-header', header, swift, object, '-o', binary]);
  assert.equal(built.status, 0, built.stderr);
  for (const mode of ['cold', 'warm', 'no-url', 'custom', 'universal']) {
    const result = run(binary, [mode]);
    assert.equal(result.status, 0, result.stderr);
    const expected = mode === 'warm' || (mode === 'cold' && label === 'legacy') ? 2 : 1;
    assert.equal(Number(result.stdout.trim()), expected, `${label}/${mode}`);
    console.log(`${label}/${mode}: ${expected} total loads PASS`);
  }
}
console.log('Actual generated SceneDelegate + native launcher guard: cold double-load RED→GREEN; warm delta one, normal links/options preserved');
