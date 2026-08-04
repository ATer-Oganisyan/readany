import { StyleSheet } from 'react-native'
import { ChatTheme } from '../Theme'

export const createBubbleStyles = (theme: ChatTheme) => {
  const { colors, radii, spacing, typography } = theme

  return StyleSheet.create({
    // Fills the message row so the pressable surface reaches the far edge, with
    // the bubble itself pinned to the sender's side.
    container: {
      flex: 1,
    },
    container_left: {
      alignItems: 'flex-start',
    },
    container_right: {
      alignItems: 'flex-end',
    },

    // Full-width band holding the bubble - this is what the reactions gesture is
    // attached to, so the whole row responds and not just the bubble.
    rowSurface: {
      alignSelf: 'stretch',
    },
    rowSurface_left: {
      alignItems: 'flex-start',
    },
    rowSurface_right: {
      alignItems: 'flex-end',
    },

    wrapper: {
      borderRadius: radii.bubble,
      minWidth: 40,
      minHeight: 35,
      maxWidth: '85%',
      position: 'relative',
    },
    wrapper_left: {
      backgroundColor: colors.incomingBubble,
      justifyContent: 'flex-end',
    },
    wrapper_right: {
      backgroundColor: colors.outgoingBubble,
      justifyContent: 'flex-end',
    },
    // A round video note floats with no bubble background/chrome (Telegram-style).
    noteWrapper: {
      backgroundColor: 'transparent',
    },

    bottom: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingRight: 7,
      paddingBottom: 3,
    },

    // Reserve the trailing baseline occupied by the 11pt timestamp and ticks.
    // Telegram measures the final line and only consumes this width there; RN
    // cannot inspect a Markdown line fragment, so the equivalent reservation is
    // applied to the message container's trailing edge.
    messageTextWithMeta: {
      paddingRight: 48,
    },

    // Curved tail built from two circles: the bubble-coloured lobe is carved by
    // a chat-background circle. This reproduces Telegram's crescent principle
    // without copying its CoreGraphics path.
    tail: {
      position: 'absolute',
      left: -6,
      bottom: 0,
      width: 12,
      height: 15,
    },
    tailRight: {
      left: undefined,
      right: -6,
    },
    tailBubble: {
      position: 'absolute',
      bottom: 0,
      width: 14,
      height: 14,
      borderRadius: 7,
    },
    tailBubbleLeft: {
      right: -5,
      backgroundColor: colors.incomingBubble,
    },
    tailBubbleRight: {
      left: -5,
      backgroundColor: colors.outgoingBubble,
    },
    tailCutout: {
      position: 'absolute',
      bottom: 4,
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: colors.background,
    },
    tailCutoutLeft: {
      left: -7,
    },
    tailCutoutRight: {
      right: -7,
    },

    // Soften the inner corners of grouped messages instead of squaring them off.
    containerToNext_left: {
      borderBottomLeftRadius: radii.bubbleGrouped,
    },
    containerToNext_right: {
      borderBottomRightRadius: radii.bubbleGrouped,
    },

    containerToPrevious_left: {
      borderTopLeftRadius: radii.bubbleGrouped,
    },
    containerToPrevious_right: {
      borderTopRightRadius: radii.bubbleGrouped,
    },

    messageTimeAndStatusContainer: {
      flexGrow: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 3,
    },

    messageStatusContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },

    usernameContainer: {
      paddingHorizontal: spacing.bubblePaddingH,
      paddingTop: spacing.bubblePaddingV,
    },
    username: {
      fontSize: typography.senderName.fontSize,
      fontWeight: typography.senderName.fontWeight,
      color: colors.senderName,
    },
  })
}

export type BubbleStyles = ReturnType<typeof createBubbleStyles>
