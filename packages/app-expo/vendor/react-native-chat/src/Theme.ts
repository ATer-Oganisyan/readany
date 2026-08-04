/**
 * Centralized design tokens for the chat UI.
 *
 * The defaults below mirror Telegram iOS chat geometry and its Classic day /
 * default night palettes. Consumers
 * can override any subset through the `theme` / `darkTheme` props on `Chat`;
 * overrides are deep-merged over these defaults, and explicit per-component
 * style props still win over the theme. Components read the resolved theme via
 * the `useTheme` hook.
 */

export interface ChatThemeColors {
  /** Accent used for the send button, links, read ticks and active states. */
  accent: string
  /** Chat list background. Lets white incoming bubbles read on light themes. */
  background: string
  /** Incoming (left) bubble background. */
  incomingBubble: string
  /** Outgoing (right) bubble background. */
  outgoingBubble: string
  /** Incoming message text. */
  incomingText: string
  /** Outgoing message text. */
  outgoingText: string
  /** Time/meta text inside incoming bubbles. */
  incomingMeta: string
  /** Time/meta text inside outgoing bubbles. */
  outgoingMeta: string
  /** Sender name shown above grouped incoming messages. */
  senderName: string
  /** Delivery tick color before the message is read. */
  ticksSent: string
  /** Delivery tick color once the message is read. */
  ticksRead: string
  /** Hairlines and dividers. */
  separator: string
  /** Background of the rounded composer field. */
  inputBackground: string
  /** Background of the whole input bar surrounding the field. */
  inputBarBackground: string
  /** Composer text color. */
  inputText: string
  /** Composer placeholder color. */
  placeholder: string
  /** Translucent day-separator pill background. */
  dayPillBackground: string
  /** Day-separator pill text. */
  dayPillText: string
  /** Surface color for floating elements (scroll-to-bottom button, picker). */
  surface: string
  /** Inactive reaction pill background. */
  reactionBackground: string
  /** Active (selected) reaction pill background. */
  reactionActiveBackground: string
  /** Translucent overlay drawn on top of outgoing bubbles (e.g. reply quotes). */
  outgoingOverlay: string
  /** Error / "not implemented" placeholder text. */
  error: string
  /** Optional border around the composer field (default transparent). */
  inputFieldBorder: string
  /** Context-menu material. Kept separate from chat surfaces for fidelity. */
  menuBackground: string
  menuPressed: string
  menuText: string
  menuSeparator: string
}

export interface ChatThemeAvatar {
  size: number
  /** Background palette for initials avatars, picked deterministically per user. */
  palette: string[]
  /** Initials text color drawn on a palette background. */
  textColor: string
}

export interface ChatThemeRadii {
  bubble: number
  bubbleGrouped: number
  inputField: number
  sendButton: number
  reaction: number
  dayPill: number
}

export interface ChatThemeSpacing {
  bubblePaddingV: number
  bubblePaddingH: number
  withinGroup: number
  betweenGroups: number
  screenEdge: number
}

export interface ChatThemeTextStyle {
  fontSize: number
  lineHeight?: number
  fontWeight?:
    | 'normal'
    | 'bold'
    | '100'
    | '200'
    | '300'
    | '400'
    | '500'
    | '600'
    | '700'
    | '800'
    | '900'
}

export interface ChatThemeTypography {
  message: ChatThemeTextStyle
  time: ChatThemeTextStyle
  senderName: ChatThemeTextStyle
  day: ChatThemeTextStyle
  system: ChatThemeTextStyle
}

export interface ChatThemeComposer {
  /** Resting height of the composer field (single line). */
  minHeight: number
  /** Max height before the field scrolls internally instead of growing. */
  maxHeight: number
  /** Horizontal padding inside the field pill. */
  fieldPaddingH: number
  /** Size of the inset icons (emoji, attachment, camera). */
  insetIconSize: number
}

export interface ChatThemeVoice {
  /** Horizontal slide distance (px) to cancel a recording. */
  cancelThreshold: number
  /** Vertical slide distance (px) to lock hands-free recording. */
  lockThreshold: number
}

export interface ChatTheme {
  colors: ChatThemeColors
  radii: ChatThemeRadii
  spacing: ChatThemeSpacing
  typography: ChatThemeTypography
  avatar: ChatThemeAvatar
  sendButton: { size: number }
  composer: ChatThemeComposer
  voice: ChatThemeVoice
}

export type PartialChatTheme = {
  colors?: Partial<ChatThemeColors>
  radii?: Partial<ChatThemeRadii>
  spacing?: Partial<ChatThemeSpacing>
  typography?: Partial<Record<keyof ChatThemeTypography, Partial<ChatThemeTextStyle>>>
  avatar?: Partial<ChatThemeAvatar>
  sendButton?: Partial<{ size: number }>
  composer?: Partial<ChatThemeComposer>
  voice?: Partial<ChatThemeVoice>
}

// Telegram's seven deterministic peer-name/avatar hues.
const avatarPalette = ['#FC5C51', '#FA790F', '#895DD5', '#0FB297', '#00C0C2', '#3CA5EC', '#3D72ED']

const sharedRadii: ChatThemeRadii = {
  bubble: 16,
  bubbleGrouped: 8,
  inputField: 20,
  sendButton: 20,
  reaction: 15,
  dayPill: 14,
}

const sharedComposer: ChatThemeComposer = {
  minHeight: 40,
  maxHeight: 120,
  fieldPaddingH: 12,
  insetIconSize: 23,
}

const sharedVoice: ChatThemeVoice = {
  cancelThreshold: 80,
  lockThreshold: 90,
}

const sharedSpacing: ChatThemeSpacing = {
  bubblePaddingV: 6,
  bubblePaddingH: 11,
  withinGroup: 0,
  betweenGroups: 2.333,
  screenEdge: 8,
}

const sharedTypography: ChatThemeTypography = {
  message: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  time: { fontSize: 11, lineHeight: 13, fontWeight: '400' },
  senderName: { fontSize: 14, lineHeight: 17, fontWeight: '600' },
  day: { fontSize: 12, lineHeight: 15, fontWeight: '600' },
  system: { fontSize: 13, fontWeight: '400' },
}

export const defaultLightTheme: ChatTheme = {
  colors: {
    accent: '#0088FF',
    // Solid fallback under Narra's code-generated wallpaper pattern.
    background: '#DDE5E4',
    incomingBubble: '#FFFFFF',
    outgoingBubble: '#E1FFC7',
    incomingText: '#000000',
    outgoingText: '#000000',
    incomingMeta: 'rgba(82, 82, 82, 0.60)',
    outgoingMeta: 'rgba(0, 140, 9, 0.80)',
    senderName: '#0088FF',
    ticksSent: 'rgba(0, 140, 9, 0.80)',
    ticksRead: '#00A700',
    separator: '#BEC2C6',
    inputBackground: 'rgba(255, 255, 255, 0.80)',
    inputBarBackground: '#FFFFFF',
    inputText: '#000000',
    placeholder: 'rgba(0, 0, 0, 0.40)',
    dayPillBackground: 'rgba(116, 131, 145, 0.45)',
    dayPillText: '#FFFFFF',
    surface: '#FFFFFF',
    reactionBackground: 'rgba(255, 255, 255, 0.88)',
    reactionActiveBackground: 'rgba(0, 136, 255, 0.15)',
    outgoingOverlay: 'rgba(0, 140, 9, 0.08)',
    error: '#FF3B30',
    inputFieldBorder: 'rgba(0, 0, 0, 0.10)',
    menuBackground: 'rgba(248, 248, 248, 0.96)',
    menuPressed: 'rgba(0, 0, 0, 0.08)',
    menuText: '#000000',
    menuSeparator: 'rgba(60, 60, 67, 0.20)',
  },
  radii: sharedRadii,
  spacing: sharedSpacing,
  typography: sharedTypography,
  avatar: { size: 34, palette: avatarPalette, textColor: '#FFFFFF' },
  sendButton: { size: 40 },
  composer: sharedComposer,
  voice: sharedVoice,
}

export const defaultDarkTheme: ChatTheme = {
  colors: {
    accent: '#0088FF',
    background: '#000000',
    incomingBubble: 'rgba(29, 29, 29, 0.90)',
    // Telegram uses a #61BCF9 -> #0088FF gradient. This is the documented
    // single-colour fallback used where a gradient surface is unavailable.
    outgoingBubble: '#0088FF',
    incomingText: '#FFFFFF',
    outgoingText: '#FFFFFF',
    incomingMeta: 'rgba(255, 255, 255, 0.50)',
    outgoingMeta: 'rgba(255, 255, 255, 0.70)',
    senderName: '#61BCF9',
    ticksSent: 'rgba(255, 255, 255, 0.70)',
    ticksRead: '#FFFFFF',
    separator: 'rgba(84, 84, 88, 0.55)',
    inputBackground: 'rgba(36, 36, 36, 0.95)',
    inputBarBackground: '#000000',
    inputText: '#FFFFFF',
    placeholder: 'rgba(255, 255, 255, 0.48)',
    dayPillBackground: 'rgba(0, 0, 0, 0.20)',
    dayPillText: '#FFFFFF',
    surface: '#242424',
    reactionBackground: 'rgba(255, 255, 255, 0.10)',
    reactionActiveBackground: 'rgba(0, 136, 255, 0.28)',
    outgoingOverlay: 'rgba(255, 255, 255, 0.1)',
    error: '#FF453A',
    inputFieldBorder: 'rgba(255, 255, 255, 0.10)',
    menuBackground: 'rgba(44, 44, 46, 0.96)',
    menuPressed: 'rgba(255, 255, 255, 0.10)',
    menuText: '#FFFFFF',
    menuSeparator: 'rgba(84, 84, 88, 0.65)',
  },
  radii: sharedRadii,
  spacing: sharedSpacing,
  typography: sharedTypography,
  avatar: { size: 34, palette: avatarPalette, textColor: '#FFFFFF' },
  sendButton: { size: 40 },
  composer: sharedComposer,
  voice: sharedVoice,
}

export interface ChatThemeOverrides {
  light?: PartialChatTheme
  dark?: PartialChatTheme
}

/**
 * Resolve the active theme for a color scheme, applying the matching override.
 * Used by `Chat` to compute the theme once per change and share it via context.
 */
export function resolveTheme (
  colorScheme: 'light' | 'dark' | null | undefined,
  light?: PartialChatTheme,
  dark?: PartialChatTheme
): ChatTheme {
  const isDark = colorScheme === 'dark'
  return mergeTheme(isDark ? defaultDarkTheme : defaultLightTheme, isDark ? dark : light)
}

/** Deep-merge a partial theme over a base theme (two levels deep). */
export function mergeTheme (base: ChatTheme, override?: PartialChatTheme): ChatTheme {
  if (!override)
    return base

  const mergedTypography = { ...base.typography }
  if (override.typography)
    for (const key of Object.keys(override.typography) as Array<keyof ChatThemeTypography>)
      mergedTypography[key] = { ...base.typography[key], ...override.typography[key] }

  return {
    colors: { ...base.colors, ...override.colors },
    radii: { ...base.radii, ...override.radii },
    spacing: { ...base.spacing, ...override.spacing },
    typography: mergedTypography,
    avatar: { ...base.avatar, ...override.avatar },
    sendButton: { ...base.sendButton, ...override.sendButton },
    composer: { ...base.composer, ...override.composer },
    voice: { ...base.voice, ...override.voice },
  }
}
