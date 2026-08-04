import React, { useCallback } from 'react'
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { useThemedStyles } from '../hooks/useTheme'
import { MessageMenuItem } from '../Models'
import { ChatTheme } from '../Theme'

const MENU_WIDTH = 250
const ROW_HEIGHT = 44
const REACTION_ROW_HEIGHT = 50
const VERTICAL_OFFSET = 8
const EDGE = 8
const GROUP_SEPARATOR_HEIGHT = 8

export interface ContextMenuReactions {
  emojis: string[]
  onSelect: (emoji: string) => void
}

export interface ContextMenuProps {
  visible: boolean
  items: MessageMenuItem[]
  onDismiss: () => void
  position?: 'left' | 'right'
  pageX?: number
  pageY?: number
  bubbleWidth?: number
  bubbleHeight?: number
  /** Optional reactions pill rendered above the action list. */
  reactions?: ContextMenuReactions
}

/**
 * Telegram-style long-press context menu: a floating, themed action list
 * anchored to the bubble, with an optional reactions pill on top. Dependency-free
 * (Modal + Views), dark-mode aware.
 */
export const ContextMenu = ({
  visible,
  items,
  onDismiss,
  position = 'left',
  pageX = 0,
  pageY = 0,
  bubbleWidth = 0,
  bubbleHeight = 0,
  reactions,
}: ContextMenuProps) => {
  const styles = useThemedStyles(createStyles)
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window')

  const menuHeight = items.length * ROW_HEIGHT +
    items.filter(item => item.separatorBefore).length * GROUP_SEPARATOR_HEIGHT +
    (reactions ? REACTION_ROW_HEIGHT + VERTICAL_OFFSET : 0)

  const showAbove = pageY >= menuHeight + VERTICAL_OFFSET && pageY + bubbleHeight + menuHeight > screenHeight
  const top = showAbove
    ? Math.max(EDGE, pageY - menuHeight - VERTICAL_OFFSET)
    : Math.min(pageY + bubbleHeight + VERTICAL_OFFSET, screenHeight - menuHeight - EDGE)

  const left = position === 'right'
    ? Math.max(EDGE, Math.min(pageX + bubbleWidth - MENU_WIDTH, screenWidth - MENU_WIDTH - EDGE))
    : Math.max(EDGE, Math.min(pageX, screenWidth - MENU_WIDTH - EDGE))

  const handlePress = useCallback((onPress: () => void) => {
    onPress()
    onDismiss()
  }, [onDismiss])

  const handleReaction = useCallback((emoji: string) => {
    reactions?.onSelect(emoji)
    onDismiss()
  }, [reactions, onDismiss])

  if (!visible)
    return null

  return (
    <Modal transparent visible={visible} animationType='fade' onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onDismiss} />

      <View style={[styles.anchor, { top, left, width: MENU_WIDTH }]} pointerEvents='box-none'>
        {reactions && reactions.emojis.length > 0 && (
          <View style={styles.reactionPill}>
            {reactions.emojis.map(emoji => (
              <Pressable
                key={emoji}
                onPress={() => handleReaction(emoji)}
                style={({ pressed }) => [styles.reactionButton, pressed && styles.pressed]}
              >
                <Text style={styles.reactionEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.menu}>
          {items.map((item, index) => (
            <React.Fragment key={`${item.label}-${index}`}>
              {item.separatorBefore && <View style={styles.groupSeparator} />}
              <Pressable
                onPress={() => handlePress(item.onPress)}
                accessibilityRole='button'
                accessibilityLabel={item.label}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && !item.separatorBefore && styles.rowDivider,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.rowLabel, item.destructive && styles.destructive]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
                {item.icon?.({
                  color: item.destructive ? styles.destructive.color : styles.rowLabel.color,
                  size: 20,
                })}
              </Pressable>
            </React.Fragment>
          ))}
        </View>
      </View>
    </Modal>
  )
}

const createStyles = (theme: ChatTheme) => StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  anchor: {
    position: 'absolute',
  },
  reactionPill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.menuBackground,
    borderRadius: 25,
    height: REACTION_ROW_HEIGHT,
    paddingHorizontal: 5,
    marginBottom: VERTICAL_OFFSET,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  reactionButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmoji: {
    fontSize: 25,
  },
  menu: {
    backgroundColor: theme.colors.menuBackground,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.menuSeparator,
  },
  groupSeparator: {
    height: GROUP_SEPARATOR_HEIGHT,
    backgroundColor: theme.colors.menuPressed,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.menuSeparator,
  },
  pressed: {
    backgroundColor: theme.colors.menuPressed,
  },
  rowLabel: {
    fontSize: 17,
    lineHeight: 20,
    color: theme.colors.menuText,
  },
  destructive: {
    color: theme.colors.error,
  },
})
