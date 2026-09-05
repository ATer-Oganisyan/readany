# Project SceneDelegate cold dev-client URL handoff

The generated SceneDelegate previously started React Native with nil launch
options, then forwarded the cold URL. Installed EXDevLauncherController.start
checks only UIApplicationLaunchOptionsURLKey before auto-loading the most recent
project. With that setting enabled and a recent project present, the explicit
dev-client URL therefore caused a second load. Each successful load can recreate
the React host. This is a project integration bug independent of the retained
native context-race safety patches.

The plugin now supplies the cold URL before start **only when its host is
`expo-development-client`**, matching the installed Expo URL classifier. It still
forwards each URL once after start. Ordinary application custom links retain
the old startup behavior; changing their launch options would suppress the app
that needs to receive them. Source application, annotation and open-in-place
options are forwarded for both cold and warm URLs. launchMode is unchanged.

The existing generated SceneDelegate is migrated in place. Strings/comments are
skipped when finding its class boundary, and only known old snippets inside that
class are updated. Same snippets in neighboring custom classes remain untouched.
The ignored local AppDelegate.swift was patched for the next native build, not
force-added to Git. Durable source is the config plugin.

## Evidence

- Three actual plugin-transform Vitest tests pass: fresh generation, repeated
  idempotent migration, preservation of custom overrides and neighboring classes.
- `node scripts/qa/test-ios-scene-startup.mjs` compiles the **generated Swift
  SceneDelegate** with controlled UIKit dependencies and the **actual installed
  Objective-C dev-launcher most-recent admission condition**. Legacy cold URL
  produces two loads; fixed cold URL produces one. Warm URL adds exactly one
  load after normal startup; no-URL, custom URL and ordinary user activity remain
  unchanged. Ten subprocess cases pass; URL options are checked on forwarding.
- Installed iOS SDK header confirms sourceApplication/annotation optional and
  openInPlace boolean. Node syntax and diff checks pass.

This is a deterministic branch/integration harness, not actual asynchronous
manifest fetching, UIKit launch timing or a native crash reproduction. It assumes
the local QA configuration has no embedded/default launch URL and most-recent
is enabled; the harness controls these prerequisites. A dev-client universal
link arriving only as userActivities is not changed by this patch. Real cold
start, active UI controls and repeated accessibility snapshots remain required.
No build, install, data wipe, settings reset, Metro action or provider call was
performed while preparing this fix.

## Root native acceptance, bounded sample

Root rebuilt and installed only the isolated Air through the canonical wrapper.
Build36, fingerprint `b7e9985e4b5b`; log
`/private/tmp/narra-air-scene-startup-fix-build.log` records actual compilation of
the updated AppDelegate.swift (line 4786). TEST8081 and its library were untouched.
The complete mobile suite passed **173 files / 1,587 tests**, TypeScript passed.
GitHub Regression33972748384 passed on `144e38e`, including all three native
harnesses, mobile/core and TypeScript; Gateway33972748382 also passed.

Native QA completed **5/5 cold launches** between 17:45 and 17:50:47 MSK:
PIDs 37694, 43946, 46910, 52611, 54786. Each rendered Library/My books, opened
the own book, exposed Book actions and the Bookmarks sheet, and accepted actual
bookmark-row interaction with the expected CFI. Accessibility inspection stayed
enabled. No new crash reports were observed; each PID had zero lost-context
fallback messages in the collected overlapping five-minute log windows.
The third run needed a test-flow correction: it had tapped to hide already
visible controls. A conditional tap restored a valid check; app source did not
change during the gate. Root independently inspected Library and Bookmarks
screenshots.

This closes the bounded cold-link startup/controls gate, **not** all iOS crash
risk, arbitrary reload overlap, signed-device acceptance or mass-release QA.
The repeated runs used the saved page-1 bookmark. The additional checks completed
at 17:54:50 MSK:

- A sixth cold start restored page 3 at the exact noninitial CFI
  `epubcfi(/6/2!/4/2[chapter-1],/12/1:251,/18/1:113)`.
- A new own FBZ fixture30 imported through URL → Open → Reader, creating book
  `d9d5f55a-a220-4d9e-a85c-443212d1384e`.
- The actual Files picker opened and cancelled without losing the library.
- Returning to own27 preserved the same page-3 CFI.
- A warm dev-client openLink on port8082 retained PID58515, restored functioning
  Library/Reader/Bookmarks controls and preserved that noninitial CFI.

All six PIDs had zero fallback messages in the collected log windows; no new
crash reports were observed. This is a startup/import/return smoke test, not
long-running soak, live AI/audio or release-signing acceptance.

The executed cold-start and conditional-controls actions are preserved in
`packages/app-expo/.maestro/ios-air-scene-full.yaml` with repository-relative
paths. It requires the QA fixture and separate screenshot/CFI verification;
it does not silently seed/delete books or claim standalone release acceptance.
