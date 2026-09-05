# Fabric cached initializer: second iOS crash

Actual `Narra-2026-09-05-172533.ips`, PID 5829, patched factory build:
main-thread EXC_BREAKPOINT/SIGTRAP at ExpoFabricView.swift:212. Native log says
"The app context has been lost". This is a different failure from concurrent
factory context corruption. The guard combines missing weak context and missing
module holder, so the report alone cannot distinguish those operands.

Installed ExpoModulesCore 57.0.11 caches ObjC classes across runtimes and replaces
their initializer with a weak AppContext closure. Native view registration hops
to the main actor after module registration; an old initializer can be called
after context teardown and before reinjection. This pre-existing gap matches
[issue #48575](https://github.com/expo/expo/issues/48575). No evidence establishes
that the first factory fix introduced it; native recovery is still blocked.

## Narrow candidate, not upstream-approved release fix

The latest actual diff of **open** [PR #48933](https://github.com/expo/expo/pull/48933)
returns an inert view when the combined context/module guard fails. Its initial
strong-holder description is obsolete; permanent strong context retention risks
preventing module teardown. Our candidate is narrower: only a nil weak context
returns an inert same-class ExpoFabricView, initialized with nil context and
retained under the existing ObjC initializer convention. Missing module in a
live context and missing/uncreatable view still reach their original terminal
errors. No global context holder, fallback to another runtime or event replay.

## Actual Swift behavioral regression

`node scripts/qa/test-expo-fabric-context.mjs` extracts the actual installed
`injectInitializer` method, applies the candidate only to an isolated copy, and
compiles it with Swift/Foundation/Objective-C runtime stubs for view/module data.
The test invokes the real injected `new` IMP via the ObjC runtime. A controlled
terminal sink exits 86 instead of creating OS crash reports; branch behavior is
executed, not inferred from source text.

- Baseline dead weak context: exit 86; patched: exit 0.
- Live module view creation/event-setup sentinel: unchanged PASS.
- Missing live module, missing view and a present view creator returning nil:
  exit 86 in both versions.
- Cached class reinjection restores a real view using the new context.
- Old/new contexts deallocate, and inert/real views release correctly; no strong
  global context retention is introduced.

All ten subprocess cases pass locally, including after dependency patching.
The runner also executes the actual Apple autolinking resolver and asserts
`configuration.buildFromSource` includes `expo-modules-core`.
Foundation fixture event setup is not
real UIKit event delivery, Hermes teardown or complete view lifecycle acceptance.

## Remaining release gate

Do not accept a permanently blank current screen as success. After independent
review and source-pinned ExpoModulesCore rebuild, native QA must prove current
screens render and respond after cold start/reload, imports/pickers still work,
and old context teardown does not trigger stale runtime actions. If the crash
is instead the live missing-module branch, this candidate intentionally leaves
it visible for separate diagnosis. No dependency installation, simulator action,
app build, data wipe or model request was performed while preparing this change.

## Root installation and native verification

Root subsequently installed the patch with pnpm 9.15.0, preserving dependency
versions, and added `expo-modules-core` to the Apple source-build allowlist.
The actual autolinking resolver confirms that pin. The canonical wrapper
`rebuild-ios` completed with exit 0 for Air only, using LOCAL Metro8082 and
gateway18787. Build36 has native fingerprint prefix `b56c713d0293`;
`/private/tmp/narra-air-fabric-fix-build.log` records Swift compilation including
`ExpoFabricView.swift`. The pre-install data backup is
`/private/tmp/narra-air-before-fabric-fix.vEwahU/app-data`.

Initial native recovery passed: the visible Library renders the saved own book
at 9%, and actual taps on My books / that book open a fully rendered Reader.
The restored CFI matches exactly
`epubcfi(/6/2!/4/2[chapter-1],/12/1:251,/18/1:113)`.
Root independently inspected both screenshots, not just inspector state.
Further repeated-start and bookmark-jump checks are still in progress.
This does not establish full UIKit component coverage or long-running stability.

The CI macOS job now also runs this Swift harness. The earlier factory-only
native job passed on GitHub in run33971889063 (`4300d4e`), together with mobile,
core and TypeScript; the newly added Fabric job step still needs its hosted run.
