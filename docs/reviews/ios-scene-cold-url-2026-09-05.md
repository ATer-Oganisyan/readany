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
