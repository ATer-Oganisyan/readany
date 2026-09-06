# iOS cold-start crash: Expo host callback context race

Build 36, PID 91615, Air simulator; crash `Narra-2026-09-05-171350.ips`.
Thread 8 faults in `EXPermissionsService.registerRequesters:35`, called from
ImagePicker OnCreate. Both thread 8 and thread 10 are JS runtime threads inside
`ExpoReactNativeFactory.host:didInitializeRuntime:` → native module registration.
Thread 10 is logging a ModuleRegistry registration. This demonstrates overlapping
callbacks, not by itself object-address proof that both used the same context.

Installed versions: Expo 57.0.14, expo-modules-core/image-picker 57.0.11,
expo-dev-client 57.0.13, RN 0.86.2. The factory still reads a shared `_appContext`
after assigning it. Another callback can replace it before setRuntime,
setHostWrapper or registerNativeModules. Permissions dictionaries are unguarded;
locking only them would not repair runtime/context cross-assignment.

## Candidate and provenance

Factory backport of official [Expo PR #49474](https://github.com/expo/expo/pull/49474),
merged September 1 as `899d99b`, fixing [issue #48576](https://github.com/expo/expo/issues/48576).
Actual official PR diff was fetched before editing. Patch excludes upstream
changelog and adds explicitly approved local hardening: `@synchronized(self)`
around only capture of the prior context and `_appContext = appContext`.
A strong `objc_precise_lifetime` local retains the prior value through unlocking;
its lexical scope ends before runtime callbacks. All runtime/module callbacks use
the new local strong reference outside that lock. Package.json pnpm9 declaration is
authoritative; workspace YAML has the matching Expo entry. Root installed the
patch with pnpm 9.15.0. A normalized comparison against HEAD confirmed that the
lockfile changes only the Expo patch identity, with no package version drift.

Each callback uses its own strong local context for all operations. Upstream
keeps the ivar assignment because failed `try? prepareRuntime()` may not install
the runtime-owned NativeState; removing ownership could prematurely destroy a
failed-initialization context. NativeState retention on success is documented in
installed AppContext.swift:647–682.

## Behavioral evidence

`node scripts/qa/test-expo-factory-race.mjs` compiles the **actual factory
implementation** with macOS Foundation/ARC and controlled RN/Expo boundaries.
Two threads overlap via a barrier in scheduler lookup, after A published its
context and B replaced it. Baseline exits 2 with three cross-context calls;
patched exits 0 with none. Both verify factory ownership when native-state
retention is absent and cleanup when the factory is released. No simulator,
model, database, installed dependency or app build is touched. Temporary native
fixtures are retained for inspection. This is not a Hermes/iOS acceptance test.

Upstream alone leaves nonatomic strong ivar writes. The approved local lock
serializes these ARC assignments. No other ivar consumers exist in the installed
factory. Review caught a lock-only regression: releasing an old failed-init
context inside the lock could invoke module teardown there. The final patch
retains the old value through unlock with precise lexical lifetime. Live callbacks
retain their own context, and successful runtimes have NativeState ownership.
No permission lock, broad callback lock or global context registry was added.
The native harness additionally starts two workers together and executes 2,000
callbacks. Context isolation, latest failed-init ownership and final cleanup
pass both normally and with Clang ThreadSanitizer (`halt_on_error=1`), no reported
races. This bounded Foundation test still does not cover real Hermes teardown.

A destructor probe launches a second thread to acquire the factory lock while
the old context is being released. The lock-only mutant fails (exit 10; one
blocked acquisition); final precise-lifetime candidate passes (exit 0; zero).
This reproduces callback-under-lock behavior, not a claim of an observed real
Expo deadlock. The runner also executes actual Apple autolinking resolution and
asserts `configuration.buildFromSource` includes Expo.

## Source-build and native acceptance gate

Installed autolinking supports app package.json
`expo.autolinking.apple.buildFromSource: ["expo"]` (also an `ios` fallback),
matching exact pod or npm package names. This can pin only Expo to source;
do not disable the entire SDK blindly. Current RN build-from-source settings
already disable precompiled Expo modules in the installed Ruby helper. The
generated build must nevertheless show compilation of the patched factory `.mm`.

After independent patch review, root must refresh pnpm9 lock/dependency state,
perform the explicit canonical wrapper rebuild, verify compiled source/build
identity, and run repeated selected-device cold starts and controlled reloads.
Then verify import/file picker and permissions without erasing app data.
Do not declare the observed native crash fixed solely from this harness.

## Root local build verification

On September 5 at approximately 17:25 MSK, the explicit canonical wrapper
`rebuild-ios` completed with exit 0 and installed only Air
`984D0C64-C0B2-4204-92A9-2C65519089E8`, preserving app data. Before installation,
its complete data container was copied to
`/private/tmp/narra-air-before-native-fix.rCVIkR/app-data`.
Build number remains 36; native fingerprint prefix is `b4842db0752f`.
The local build log `/private/tmp/narra-air-native-fix-build.log` records actual
arm64 Objective-C++ compilation of patched
`node_modules/expo/ios/AppDelegates/ExpoReactNativeFactory.mm` (line 9296),
not reuse of a precompiled Expo binary. The installed app subsequently exposed
a live inspector runtime with the LOCAL gateway profile (`18787`, development).
This is launch evidence, not yet repeated-cold-start acceptance.

Root reran the native behavioral harness, including both RED→GREEN probes,
ownership/cleanup, 2,000 concurrent callbacks and ThreadSanitizer: PASS.
After dependency installation, the complete mobile suite remained
**172 test files / 1,584 tests PASS**. TEST8081 and its app data were not changed.
The subsequent native gate **failed**: the launched process exited before UI QA
with a different signature, `EXC_BREAKPOINT` / `SIGTRAP` in
`ExpoFabricView.injectInitializer`, line 212, on the main thread. Runtime log:
17:25:22.476 MSK, `The app context has been lost`; crash report
`Narra-2026-09-05-172533.ips`. The newly built debug dylib UUID is
`06cb188a-fa70-3198-b921-d83b7f78904f`. This is not the original permissions
dictionary SIGSEGV and does not establish that the factory patch regressed it.
The source's combined guard does not distinguish a dead weak context from a
missing module in a live context. That defect is being investigated separately.
QA stopped without further launches. The app container changed during install;
read-only SQL in the new container confirmed the same own book, page-3 CFI and
page-1 bookmark. Repeated cold starts, exact bookmark jump, reader return,
full AI/audio and mass-release acceptance remain open.

## PR regression CI

`.github/workflows/narra-regression.yml` adds an independent `expo-factory-native`
job on `macos-15`, Node 22 and pnpm 9.15.0. Both harness files are explicit PR/main
push path triggers. Frozen installation uses `--ignore-scripts`: pnpm still
applies dependency patches, but package lifecycle builds are not needed for
Foundation compilation or the autolinking resolver. The job checks the selected
Clang/macOS SDK, then runs the same overlap, destructor, ownership and TSan tests.
No CocoaPods, simulator, signing, provider request or application build is used.

Local `actionlint`, YAML job/path assertions and the full native harness pass
against already-patched dependencies. Hosted macOS execution remains unverified
until the first CI run; runner/TSan/toolchain failures deliberately fail the job,
not skip the regression. This job does not test UIKit/Hermes lifecycle behavior
or replace the canonical native acceptance gate. Runner availability checked
against [GitHub hosted runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
