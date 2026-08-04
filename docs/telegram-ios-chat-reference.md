# Telegram iOS chat reference for Narra

Research snapshot: telegrammessenger/Telegram-iOS commit
6ad963e5b62d354da79040f388ae2b9132fb17b8 (inspected 2026-07-30).
The implementation in this repository is original React Native code. No Swift,
CoreGraphics path, wallpaper, icon, or other GPL source asset is copied.

## Source files inspected

- submodules/TelegramUI/Components/Chat/ChatMessageItemCommon/Sources/ChatMessageItemCommon.swift
  — phone/regular layout constants, content width, text and avatar insets, list
  spacing, minimum bubble size, date-header height.
- submodules/TelegramUIPreferences/Sources/PresentationThemeSettings.swift
  — default 16 pt main bubble radius, 8 pt auxiliary radius, merged corners and
  tail defaults.
- submodules/TelegramPresentationData/Sources/ChatMessageBubbleImages.swift
  — isolated/merged bubble topology and the curved subtractive-tail principle.
- submodules/TelegramUI/Components/Chat/ChatMessageItemView/Sources/ChatMessageItemView.swift
  and
  submodules/TelegramUI/Components/Chat/ChatMessageBubbleItemNode/Sources/ChatMessageBubbleItemNode.swift
  — merge status, phone width fill, avatar reservation, reaction/tail behavior.
- submodules/TelegramUI/Components/Chat/ChatMessageItemImpl/Sources/ChatMessageDateHeader.swift
  — 34 pt avatar and the same-author/day/ten-minute grouping rule.
- submodules/TelegramUI/Components/Chat/ChatMessageTextBubbleContentNode/Sources/ChatMessageTextBubbleContentNode.swift
  — 11 pt horizontal text inset, asymmetric vertical insets and final-line
  timestamp placement.
- submodules/TelegramUI/Components/Chat/ChatMessageDateAndStatusNode/Sources/ChatMessageDateAndStatusNode.swift
  — 11 pt date type, 5 pt date/status inset, roughly 11–14 pt delivery glyphs,
  inline reaction/status spacing.
- submodules/TelegramUI/Components/Chat/ChatMessageReplyInfoNode/Sources/ChatMessageReplyInfoNode.swift
  — 14 pt reply title/body, semibold title, 3 pt vertical text inset and leading
  accent indicator.
- submodules/TelegramUI/Components/Chat/ChatTextInputPanelNode/Sources/ChatTextInputPanelNode.swift
  — 17 pt composer, 31 pt text line, 40 pt field/control, 45 pt minimum panel,
  12/11 pt internal horizontal insets and 6 pt control gap.
- submodules/TelegramUI/Components/ContextControllerImpl/Sources/ContextActionNode.swift,
  ContextActionsContainerNode.swift, and
  ContextControllerExtractedPresentationNode.swift — 250 pt minimum menu,
  14 pt radius, 17 pt action label, 16 pt side / 12 pt vertical insets, 8 pt
  grouped separator, extracted-message spring/fade behavior.
- submodules/TelegramUI/Sources/ChatInterfaceStateContextMenus.swift — real
  Reply, Copy, Delete and Select actions and destructive/group separators.
- submodules/TelegramUI/Components/Chat/TopMessageReactions/Sources/TopMessageReactions.swift
  — top reaction selection and active reaction behavior.
- submodules/TelegramPresentationData/Sources/DefaultDayPresentationTheme.swift
  and DefaultDarkPresentationTheme.swift — Classic day and default night chat,
  composer, service-message and metadata colors.
- submodules/TelegramPresentationData/Sources/PresentationData.swift and
  ComponentsThemes.swift — regular 17 pt message font baseline.

## Measured rules transferred

| Area | Telegram iOS rule | Narra RN value |
|---|---:|---:|
| Main / merged radius | 16 / 8 pt | 16 / 8 dp |
| Bubble minimum | 40 × 35 pt | 40 × 35 dp |
| Bubble width on phone | 85% fill cap | 85% |
| Text insets | 11 horizontal, 6±pixel vertical | 11, 6±hairline |
| Consecutive / new-group gap | 0 / 2+pixel pt | 0 / 2.333 dp |
| Avatar | 34 pt, bottom of group | 34 dp, bottom of group |
| Group time window | 10 minutes | 10 minutes |
| Message / metadata type | 17 / 11 pt | 17 / 11 sp |
| Composer field / panel | 40 / 45 pt | 40 / 45 dp |
| Composer controls / gaps | 40 / 6 pt | 40 / 6 dp |
| Input radius | 20 pt | 20 dp |
| Context menu | 250 pt min, radius 14 | 250 dp, radius 14 |

The tail is an original two-circle RN construction following the observed
“add lobe, subtract background” geometry. The wallpaper is an original,
code-generated low-opacity pattern; Telegram’s copyrighted wallpaper is not
bundled.

## Cross-platform boundary

All chat layout, bubbles, tails, typography, avatars, composer, reply preview,
reactions, selection, wallpaper and gestures use shared React Native host
components and the vendored chat library. There is no WebView/DOM chat path and
no iOS-only chat component. Platform services are limited to the library’s
existing optional native attachment sheet and React Native vibration/keyboard
behavior, both with Android fallbacks.

## Visual harness

NarraChat.stories.tsx extends the existing on-device Storybook. Its independent
reference renderer and production NarraChat share only the fixture data, not
bubble implementation. Stories cover light/dark, grouped incoming/outgoing,
avatar, quote/reply, Markdown/link, reactions, streaming, typing and focused
composer. Long-press opens the real reaction/action menu.

scripts/chat-visual-diff.py compares equal-size captures, reports MAE/RMSE and
changed pixels, and writes an emphasized PNG diff.
