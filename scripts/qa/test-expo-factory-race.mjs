import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = new URL('../../', import.meta.url);
let original = readFileSync(new URL('node_modules/expo/ios/AppDelegates/ExpoReactNativeFactory.mm', root), 'utf8');
const fixture = readFileSync(new URL('./expo-factory-race-harness.mm', import.meta.url), 'utf8');
const temporary = mkdtempSync(join(tmpdir(), 'narra-expo-factory-race-'));
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000, ...opts });
const resolver = run(process.execPath, [new URL('node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js', root).pathname,
  'resolve', '--platform', 'apple', '--json'], { cwd: new URL('packages/app-expo/', root).pathname });
assert.equal(resolver.status, 0, resolver.stderr);
assert.ok(JSON.parse(resolver.stdout).configuration.buildFromSource.includes('expo'),
  'Actual autolinking resolver must keep patched Expo on source builds');
console.log('Actual Apple autolinking resolver: Expo source pin PASS');
const localSource = join(temporary, 'ios/AppDelegates');
mkdirSync(localSource, { recursive: true });
writeFileSync(join(localSource, 'ExpoReactNativeFactory.mm'), original);
const patchPath = new URL('patches/expo@57.0.14.patch', root).pathname;
if (run('git', ['apply', '--check', patchPath], { cwd: temporary }).status !== 0) {
  // Also works after pnpm applied the candidate. Reverse only the isolated copy.
  const reversed = run('git', ['apply', '--reverse', patchPath], { cwd: temporary });
  assert.equal(reversed.status, 0, reversed.stderr);
  original = readFileSync(join(localSource, 'ExpoReactNativeFactory.mm'), 'utf8');
}
const patch = run('git', ['apply', patchPath], { cwd: temporary });
assert.equal(patch.status, 0, patch.stderr);
const patched = readFileSync(join(localSource, 'ExpoReactNativeFactory.mm'), 'utf8');
const compiler = run('xcrun', ['--find', 'clang++']);
assert.equal(compiler.status, 0, compiler.stderr);
const sdk = run('xcrun', ['--sdk', 'macosx', '--show-sdk-path']);
assert.equal(sdk.status, 0, sdk.stderr);
// Deliberately regress only old-context retention, keeping the publication lock.
const lockOnly = patched.replace(/    EXAppContext \*previousContext __attribute__\(\(objc_precise_lifetime\)\) = nil;\n/, '')
  .replace(/      previousContext = _appContext;\n/, '').replace(/    \(void\)previousContext;\n/, '');
assert.notEqual(lockOnly, patched);
for (const [label, source, expected] of [['baseline', original, 2], ['lock-only', lockOnly, 0], ['patched', patched, 0]]) {
  const implementation = source.slice(source.indexOf('@implementation EXReactNativeFactory'));
  const path = join(temporary, `${label}.mm`);
  writeFileSync(path, fixture.replace('// ACTUAL_FACTORY_IMPLEMENTATION', implementation));
  const built = run(compiler.stdout.trim(), ['-isysroot', sdk.stdout.trim(), '-std=c++17', '-fobjc-arc', '-framework', 'Foundation', path, '-o', join(temporary, label)]);
  assert.equal(built.status, 0, built.stderr);
  const result = run(join(temporary, label), []);
  console.log(`${label}: exit ${result.status}; ${result.stdout.trim()}`);
  assert.equal(result.status, expected, result.stderr);
  if (label !== 'baseline') {
    const destructor = run(join(temporary, label), [], { env: { ...process.env, NARRA_FACTORY_DEALLOC_PROBE: '1' } });
    console.log(`${label} ${destructor.stdout.trim()}`);
    assert.equal(destructor.status, label === 'lock-only' ? 10 : 0, destructor.stderr);
  }
  if (label === 'patched') {
    const stress = run(join(temporary, label), [], { env: { ...process.env, NARRA_FACTORY_STRESS: '1' } });
    assert.equal(stress.status, 0, stress.stderr);
    console.log(stress.stdout.trim());
    const sanitizedPath = join(temporary, 'patched-tsan');
    const sanitizedBuild = run(compiler.stdout.trim(), ['-isysroot', sdk.stdout.trim(), '-std=c++17', '-fobjc-arc', '-fsanitize=thread', '-g', '-framework', 'Foundation', path, '-o', sanitizedPath]);
    assert.equal(sanitizedBuild.status, 0, sanitizedBuild.stderr);
    const sanitized = run(sanitizedPath, [], { env: { ...process.env, NARRA_FACTORY_STRESS: '1', TSAN_OPTIONS: 'halt_on_error=1' } });
    assert.equal(sanitized.status, 0, sanitized.stderr);
    console.log(`ThreadSanitizer: ${sanitized.stdout.trim()}`);
  }
}
console.log(`PASS: actual ObjC++ factory overlap RED→GREEN, retained failed-init ownership. Fixtures: ${temporary}`);
