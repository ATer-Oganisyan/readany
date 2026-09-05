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
- MAIN still has RN 0.86.2 installed and must remain rejected. Its dependencies
  were not changed because the separate TEST runtime uses them.
- Isolated iOS project/Pods have not yet been generated. Existing LOCAL iOS
  build 36 has an older native fingerprint; it is not accepted as this build.
- No iOS build, install, simulator reset, TEST change, or deployment occurred.

Next native gate: generate iOS only in the isolated worktree without `--clean`,
verify generated config plugins, install matching Pods, then use the canonical
wrapper for the LOCAL iPhone Air. Check ownership of Metro 8082 before launch.
