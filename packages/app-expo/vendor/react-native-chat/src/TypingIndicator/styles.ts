import { StyleSheet } from 'react-native'
import { ChatTheme } from '../Theme'

export const createTypingIndicatorStyles = (theme: ChatTheme) => StyleSheet.create({
  container: {
    marginLeft: 3,
    width: 45,
    borderRadius: theme.radii.bubble,
    backgroundColor: theme.colors.incomingBubble,
  },
  dots: {
    flexDirection: 'row',
  },
  dot: {
    marginLeft: 1.5,
    marginRight: 1.5,
    borderRadius: 4,
    width: 7,
    height: 7,
    backgroundColor: theme.colors.incomingMeta,
  },
})
