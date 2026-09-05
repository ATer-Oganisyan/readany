# iOS dependency preflight — 2026-09-05

## Result

The isolated RN 0.86.3 installation was rejected before native preparation:
`react-native: expected 0.86.2, installed 0.86.3`. The wrapper's checker uses
Expo 57.0.14's bundled metadata, while Expo CLI uses remote versions first.

The official SDK endpoint returned RN `0.86.3` and React `19.2.3` in this audit:
https://api.expo.dev/v2/sdks/57.0.0/native-modules
The endpoint does not separately list `@react-native/metro-config`.

Added only `react-native` to the documented `expo.install.exclude` list:
https://docs.expo.dev/versions/latest/config/package-json/#installexclude
The exact manifest pin remains `0.86.3`. Our independent pinned-install check
still rejects missing RN, RN 0.86.2, and unreviewed 0.87.0. Other Expo dependency
checks remain enabled. No network dependency was added to everyday startup.

## Evidence and limitations

- Actual isolated checker reproduced the failure, exit 1.
- New regression against the actual app manifest failed before the change;
  all four installed-dependency tests pass after it, including existing unrelated
  Expo mismatch and missing-package cases.
- Isolated checkout `fa364e8` now passes the actual checker. The full mobile
  suite in that checkout passes 1734 tests; MAIN TypeScript also passes.
- MAIN still has RN 0.86.2 installed and must remain rejected. Its dependencies
  were not changed because the separate TEST runtime uses them.
- Isolated iOS project/Pods have not yet been generated. Existing LOCAL iOS
  build 36 has an older native fingerprint; it is not accepted as this build.
- No iOS build, install, simulator reset, TEST change, or deployment occurred.

Next native gate: generate iOS only in the isolated worktree without `--clean`,
verify generated config plugins, install matching Pods, then use the canonical
wrapper for the LOCAL iPhone Air. Check ownership of Metro 8082 before launch.

## Subsequent native preparation (isolated `ec7fb6c`)

Completed iOS-only `expo prebuild --no-install --skip-dependency-update
react-native,expo` with development variant and dotenv disabled. No `--clean`,
no copying MAIN native files, and no tracked diff. Generated AppDelegate and
Podfile were independently reviewed against the configured plugins; cold-URL,
scene lifecycle, status-bar forwarding, source-build settings, Screens Gamma,
and deployment target 16.4 are retained.

`pod install` then completed: 143 dependencies, 146 pods, reported 45 seconds.
Actual Podfile.lock and Pods/Manifest.lock match. React-Core is 0.86.3 and
hermes-engine 250829098.0.17. The Hermes configuration-selection build phase
was inspected. Expo correctly reports source builds when RN source mode disables
precompiled modules, despite the generic precompiled property being true.

Canonical wrapper `check` passes with Xcode26.5/17F42, pasteboard sync off,
LOCAL Air `984D0C64-C0B2-4204-92A9-2C65519089E8`, gateway127.0.0.1:18787 and
Metro8082. Existing installed build is36; isolated canonical app/fingerprint
are still missing at this preparation checkpoint. This is not compilation or
native runtime acceptance. Metro8082 currently belongs to MAIN and must not be
reused for the new isolated binary; TEST Metro8081 remains untouched.

## Canonical build and first launch

The canonical `rebuild-ios` completed compilation and installed its own app on
LOCAL Air. Its foreground process then started Metro8082 from the isolated copy.
Before rebuilding, only the old LOCAL Metro8082 process was stopped; TEST8081
and Android LOCAL8083 were not stopped. No data reset or book deletion occurred.

- Native input baseline: `ec7fb6c`; subsequent JS-only import notification fix
  `04c4b8c` was applied without changing native inputs during compilation.
- Artifact: isolated `packages/app-expo/ios/build/codex-devicehub/Build/Products/Debug-iphonesimulator/Narra.app`.
- Bundle ID `com.mishanaer.readany.dev`, build36.
- `Narra.debug.dylib` SHA256:
  `d0b582f05381159c345a4d68eb3b439a27ee8e306efaa23853091fbc6c1ff133`.
- Saved native fingerprint:
  `665547634a70f927c506cc136386ac1f2da9743a9cbb519455ebb1ba0711311b`.
- Build/runtime log: `/private/tmp/narra-ios-rn0863-rebuild.log`.
- Runtime reaches bootstrap done, starts the iOS TCP file server, and verifies
  the development gateway at127.0.0.1:18787. Metro PID93674 is owned by the isolated
  checkout, not MAIN. This confirms startup, not the whole client loop.

Pre-install library snapshot contains two own QA books and exact CFI/progress,
saved at `/private/tmp/narra-air-pre-rn3-library-books.json`. Their preservation
and the new import/Open transition are being checked separately on the device.
Runtime warns that some TrackPlayer sleep-timer bridge methods are unavailable;
the affected application paths are under review. This is Debug Simulator, not
a signed Release archive, physical-device test, or deployment.

Post-install wrapper `check` confirms canonical build36 and **current** native
fingerprint. Root compared the pre-install snapshot with
`/private/tmp/narra-air-rn3-baseline.json`: both original IDs, hashes, CFI and
progress are unchanged before any reading action. Root inspected
[the resulting Library](evidence/ios-rn0863/library-after-install.png): both
cards are visible (22% and3%), no RedBox. This accepts the bounded in-place
LOCAL simulator upgrade/startup, not release distribution.

Independent review traced four TrackPlayer warnings to unused upstream bridge
declarations without Swift implementations (`getSleepTimerProgress`,
`setSleepTimer`, `sleepWhenActiveTrackReachesEnd`, `clearSleepTimer`). Current
NARRA calls its own JS sleep timer, not those selectors; warning removal would
not prove timer correctness. Background/suspended iOS timer accuracy remains
unverified and requires actual audio QA. No dummy methods were introduced.

## Reader checkpoint after installation

The first automated semantic title tap left Library visible and failed the
Reader assertion. No new app crash report was found and the app process was
still alive. This is an unresolved gesture-delivery/handling observation, not
evidence of a native crash or a confirmed broken BookCard handler.

After one canonical Run without data reset, a single coordinate tap on the
same own27 card opened Reader. Root visually inspected the captured Russian
text (episodes1.17/1.18) and controls; the QA agent confirmed `Narra Reader`
in the native hierarchy and unchanged exact CFI/progress for both original
books. No speculative native touch fix was applied.

Screenshot: `/private/tmp/narra-air-physical-own27-evidence/2026-09-05_231925/narra-air-physical-own27/takeScreenshot/physical-own27-after.png`.
Fresh import/Open-dismiss acceptance on `04c4b8c` has not yet run. This remains
a bounded startup/reader checkpoint, not full iOS core-loop acceptance.

## Fresh URL import / Open dismissal (`04c4b8c`)

The native LOCAL Air flow imported own `01-river.epub` from the local fixture
server, displayed Open, then opened actual Russian text without the notification.
Root inspected the after-Open image and complete command timestamps.
[Before Open](evidence/ios-rn0863/import-before-open.png),
[Reader after Open](evidence/ios-rn0863/import-after-open.png),
[native commands](evidence/ios-rn0863/import-open-commands.json).

Open command duration was2462ms; absence was observed678ms after command
completion (3140ms from command start). The clean Reader screenshot began
5722ms after Add began, proving disappearance before the8s result timer.
This accepts dismissal on this native path, **not** a measured <=2s touch SLA:
automation delivery and observation add unseparated latency.

Root independently compared `/private/tmp/narra-air-before-own01.json` and
`/private/tmp/narra-air-after-own01.json`: three books, both original IDs and
exact CFI/progress/hash/filePath/localProgressCheckpoint preserved.
Fresh book ID `f7be0867-96f7-4560-83ef-87efc4e77685`, progress
`0.031074336792853093`, CFI `epubcfi(/6/2!/4,/2,/8/1:113)`.
Android acceptance of this newest dismissal change and other import paths remain
open; the earlier Android native geometry fix has its separate evidence.

The subsequent combined Back/reopen automation did not return to Library;
the failure screenshot remained Reader. It is not accepted. A separate
screenshot-guided control-visibility/Back diagnostic is pending; no crash is
inferred from this failed navigation assertion.
