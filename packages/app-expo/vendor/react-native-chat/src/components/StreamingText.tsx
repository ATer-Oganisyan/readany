import React, { memo, useEffect, useMemo } from 'react'
import {
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'

const AnimatedText = Animated.createAnimatedComponent(Text)

const REVEAL_DURATION_MS = 400
const REVEAL_STAGGER_MS = 15
const REVEAL_OFFSET = 6
const REVEAL_EASING = Easing.bezier(0.23, 1, 0.32, 1)

interface StreamingTextProps {
  text: string
  textStyle?: StyleProp<TextStyle>
  containerStyle?: StyleProp<ViewStyle>
  onComplete?: () => void
}

interface StreamingTokenProps {
  content: string
  index: number
  isLast: boolean
  textStyle?: StyleProp<TextStyle>
  onComplete?: () => void
}

const StreamingToken = memo(function StreamingToken({
  content,
  index,
  isLast,
  textStyle,
  onComplete,
}: StreamingTokenProps) {
  const progress = useSharedValue(0)

  useEffect(() => {
    progress.value = withDelay(
      index * REVEAL_STAGGER_MS,
      withTiming(1, {
        duration: REVEAL_DURATION_MS,
        easing: REVEAL_EASING,
      }, (finished) => {
        if (finished && isLast && onComplete)
          runOnJS(onComplete)()
      }),
    )
  }, [index, isLast, onComplete, progress])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * REVEAL_OFFSET }],
  }), [progress])

  return (
    <AnimatedText style={[textStyle, animatedStyle]}>
      {content}
    </AnimatedText>
  )
})

export const StreamingText = ({
  text,
  textStyle,
  containerStyle,
  onComplete,
}: StreamingTextProps) => {
  const tokens = useMemo(() => text.split(/(\s+)/).filter(Boolean), [text])
  const animatedTokenCount = useMemo(
    () => tokens.reduce((count, token) => count + (/^\s+$/.test(token) ? 0 : 1), 0),
    [tokens],
  )

  let animatedIndex = 0

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={[textStyle, styles.ghost]}>{text}</Text>
      <Text style={[textStyle, styles.overlay]}>
        {tokens.map((token, tokenIndex) => {
          if (/^\s+$/.test(token))
            return <Text key={`space-${tokenIndex}`}>{token}</Text>

          const index = animatedIndex
          animatedIndex += 1
          return (
            <StreamingToken
              key={`token-${tokenIndex}`}
              content={token}
              index={index}
              isLast={index === animatedTokenCount - 1}
              textStyle={textStyle}
              onComplete={onComplete}
            />
          )
        })}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  ghost: {
    opacity: 0,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
})
