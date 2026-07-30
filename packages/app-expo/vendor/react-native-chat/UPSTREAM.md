# Upstream source

This workspace package vendors the source of
[`@kesha-antonov/react-native-chat`](https://github.com/kesha-antonov/react-native-chat)
from its unreleased `4.2.0` branch.

- Commit: `299d3377821fc866ccf72c33bfc3cd45bf5b5924`
- Retrieved: 2026-07-30
- License: MIT (see `LICENSE`)

The branch is vendored because its package manifest points to generated `lib/`
artifacts that are not committed and its prepare script does not build them.
Keeping the exact source in the workspace makes local Metro, EAS, and CI builds
reproducible until 4.2.0 is published.

## Local compatibility patch

Narra uses React Native's built-in `KeyboardAvoidingView` instead of the
branch's `react-native-keyboard-controller` wrapper. The current local iOS
toolchain has no CocoaPods installation, so making that native module mandatory
would prevent the existing development client from launching. The public chat
API and all other 4.2.0 features remain unchanged.

The vendored build also uses `Intl` for timestamps, a small message comparator,
and the regular React Native image viewer. This removes three implementation-only
dependencies (`dayjs`, `lodash.isequal`, and `react-native-zoom-reanimated`) from
Narra's application graph. Pinch-to-zoom is the only intentionally omitted
upstream behavior; Narra's AI messages currently contain no image attachments.
