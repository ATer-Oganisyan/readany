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
