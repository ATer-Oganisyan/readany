import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = new URL('../../', import.meta.url);
const temporary = mkdtempSync(join(tmpdir(), 'narra-fabric-context-'));
const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000, ...options });
const resolver = run(process.execPath, [new URL('node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js', root).pathname,
  'resolve', '--platform', 'apple', '--json'], { cwd: new URL('packages/app-expo/', root).pathname });
assert.equal(resolver.status, 0, resolver.stderr);
assert.ok(JSON.parse(resolver.stdout).configuration.buildFromSource.includes('expo-modules-core'),
  'Actual autolinking resolver must keep patched ExpoModulesCore on source builds');
console.log('Actual Apple autolinking resolver: ExpoModulesCore source pin PASS');
const relative = 'ios/Fabric/ExpoFabricView.swift';
mkdirSync(join(temporary, 'ios/Fabric'), { recursive: true });
writeFileSync(join(temporary, relative), readFileSync(new URL(`node_modules/expo-modules-core/${relative}`, root)));
const patch = new URL('patches/expo-modules-core@57.0.11.patch', root).pathname;
if (run('git', ['apply', '--check', patch], { cwd: temporary }).status !== 0) {
  // Support the prior installed candidate during review; normalize only this
  // isolated copy so reversing the current patch reconstructs pristine source.
  const installed = readFileSync(join(temporary, relative), 'utf8');
  writeFileSync(join(temporary, relative), installed.replace(
    '(viewClass as? ExpoFabricView.Type ?? ExpoFabricView.self).init(appContext: nil)',
    'ExpoFabricView(appContext: nil)'));
  const reverse = run('git', ['apply', '--reverse', patch], { cwd: temporary });
  assert.equal(reverse.status, 0, reverse.stderr);
}
const baseline = readFileSync(join(temporary, relative), 'utf8');
const applied = run('git', ['apply', patch], { cwd: temporary });
assert.equal(applied.status, 0, applied.stderr);
const patched = readFileSync(join(temporary, relative), 'utf8');
const fixture = readFileSync(new URL('./expo-fabric-context-harness.swift', import.meta.url), 'utf8');
const compiler = run('xcrun', ['--find', 'swiftc']);
const sdk = run('xcrun', ['--sdk', 'macosx', '--show-sdk-path']);
assert.equal(compiler.status, 0, compiler.stderr);
assert.equal(sdk.status, 0, sdk.stderr);
const dynamicFallback = patched.replace('ExpoFabricView(appContext: nil)',
  '(viewClass as? ExpoFabricView.Type ?? ExpoFabricView.self).init(appContext: nil)');
assert.notEqual(dynamicFallback, patched);
for (const [label, source] of [['baseline', baseline], ['dynamic-fallback', dynamicFallback], ['patched', patched]]) {
  const start = source.indexOf('  internal static func injectInitializer(');
  const end = source.indexOf('\n  // swiftlint:disable unavailable_function', start);
  assert.ok(start >= 0 && end > start);
  const swift = join(temporary, `${label}.swift`);
  writeFileSync(swift, fixture.replace('// ACTUAL_INITIALIZER', source.slice(start, end)));
  const binary = join(temporary, label);
  const built = run(compiler.stdout.trim(), ['-sdk', sdk.stdout.trim(), swift, '-o', binary]);
  assert.equal(built.status, 0, built.stderr);
  for (const mode of ['live', 'dead', 'missing-module', 'missing-view', 'create-failed']) {
    const result = run(binary, [mode], { env: { ...process.env, NARRA_BASE_FALLBACK: label === 'patched' ? '1' : '0' } });
    const expected = mode.startsWith('missing') || mode === 'create-failed' || (label === 'baseline' && mode === 'dead') ? 86 : 0;
    assert.equal(result.status, expected, result.stderr || result.stdout);
    console.log(`${label}/${mode}: exit ${result.status} PASS`);
  }
  if (label !== 'baseline') {
    const unregistered = run(binary, ['unregistered'], { env: { ...process.env, NARRA_BASE_FALLBACK: label === 'patched' ? '1' : '0' } });
    assert.equal(unregistered.status, label === 'patched' ? 0 : 87, unregistered.stderr || unregistered.stdout);
    console.log(`${label}/unregistered class: exit ${unregistered.status} PASS`);
  }
}
console.log(`Actual Swift initializer RED→GREEN, live/missing-definition semantics preserved. Fixtures: ${temporary}`);
