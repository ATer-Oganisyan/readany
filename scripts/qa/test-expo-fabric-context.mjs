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
for (const [label, source] of [['baseline', baseline], ['patched', patched]]) {
  const start = source.indexOf('  internal static func injectInitializer(');
  const end = source.indexOf('\n  // swiftlint:disable unavailable_function', start);
  assert.ok(start >= 0 && end > start);
  const swift = join(temporary, `${label}.swift`);
  writeFileSync(swift, fixture.replace('// ACTUAL_INITIALIZER', source.slice(start, end)));
  const binary = join(temporary, label);
  const built = run(compiler.stdout.trim(), ['-sdk', sdk.stdout.trim(), swift, '-o', binary]);
  assert.equal(built.status, 0, built.stderr);
  for (const mode of ['live', 'dead', 'missing-module', 'missing-view', 'create-failed']) {
    const result = run(binary, [mode]);
    const expected = mode.startsWith('missing') || mode === 'create-failed' || (label === 'baseline' && mode === 'dead') ? 86 : 0;
    assert.equal(result.status, expected, result.stderr || result.stdout);
    console.log(`${label}/${mode}: exit ${result.status} PASS`);
  }
}
console.log(`Actual Swift initializer RED→GREEN, live/missing-definition semantics preserved. Fixtures: ${temporary}`);
