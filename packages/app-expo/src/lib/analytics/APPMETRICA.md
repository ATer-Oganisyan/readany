# AppMetrica in the mobile app

AppMetrica is connected only in `packages/app-expo` (iOS and Android). The
desktop Tauri app and website do not load the React Native SDK. Narra's existing
gateway event queue remains independent.

The integration is off by default. A mobile build needs both:

```text
EXPO_PUBLIC_NARRA_APPMETRICA_ENABLED=true
EXPO_PUBLIC_NARRA_APPMETRICA_API_KEY=<AppMetrica SDK API key>
```

Use a separate AppMetrica app/key for development builds. These values are
embedded in the client bundle; the SDK API key is not a server secret. The
existing `EXPO_PUBLIC_NARRA_ANALYTICS_TIER=none` disables the integration.
Only allowlisted properties from `contract.ts` are sent as custom events. SDK
lifecycle statistics replace custom `app_opened`, `app_closed`, and
`app_version_seen` events in AppMetrica; those events still go to Narra's
gateway.

The new native dependency requires a fresh development or release build for
both platforms. Follow `packages/app-expo/AGENTS.md` for the supported iOS
rebuild command. Before enabling a release, confirm its privacy disclosures
and store metadata, then check an installation, a session, and a `book_opened`
event in the AppMetrica dashboard on iOS and Android.

## Build handoff validation (2026-09-22)

- Production uses the EAS `production` environment. Set the SDK key there as
  `sensitive` and the enabled flag as plaintext; never commit the key. These
  settings take effect in a newly built bundle, not an already installed app.
- `ReaderScreen` already emits `book_opened` when opening book metadata and
  `reading_session_qualified` after 60 seconds of active reading. Both pass the
  `essential` tier used by production and preview. The external handoff's claim
  that the UI does not emit `book_opened` is outdated.
- Character, chat, bookmark, note, analysis, and synthesis events require
  `extended`. Do not expect them in the current production `essential` tier.
- `development-simulator` sets tier `none`; local Metro does not automatically
  inherit EAS environment variables. Keep simulator data out of the production
  AppMetrica application unless deliberately running an acceptance test.
- Run `pnpm install --frozen-lockfile` after updating the checkout. For an
  existing local iOS project, intentionally run `pod install` with a compatible
  Ruby/CocoaPods installation before `./script/build_and_run.sh rebuild-ios`.
  The wrapper builds and installs the canonical app; it does not install pods.
- SDK loading happens inside guarded activation. Missing native modules in an
  old client do not prevent opening Narra, but that client cannot validate SDK
  delivery. Always test a freshly rebuilt native app on both platforms.
- Unit tests verify filtering, loading failure containment, and gateway
  independence. They do not prove receipt by AppMetrica. Before publishing,
  verify installations, sessions, `book_opened`, and `reading_session_qualified`
  in the production dashboard using the intended release build.

References: [AppMetrica setup](https://appmetrica.yandex.com/docs/en/sdk/react-native/analytics/quick-start),
[EAS environment selection](https://docs.expo.dev/eas/environment-variables/usage/).
