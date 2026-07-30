import React, { useMemo } from 'react'
import {
  View,
  Text } from 'react-native'
import { useChatContext } from '../ChatContext'
import { DATE_FORMAT } from '../Constant'
import { useLabels } from '../hooks/useLabels'
import { useThemedStyles } from '../hooks/useTheme'
import stylesCommon from '../styles'
import { createDayStyles } from './styles'
import { DayProps } from './types'
import { formatChatDate, isSameCalendarDay } from '../dateUtils'

export * from './types'

export function Day ({
  dateFormat = DATE_FORMAT,
  dateFormatCalendar,
  createdAt,
  containerStyle,
  wrapperStyle,
  textProps,
}: DayProps) {
  const { getLocale } = useChatContext()
  const labels = useLabels()
  const styles = useThemedStyles(createDayStyles)

  const dateStr = useMemo(() => {
    if (createdAt == null)
      return null

    const now = new Date()
    const date = new Date(createdAt)

    if (isSameCalendarDay(now, date))
      return labels.today

    return formatChatDate(date, getLocale(), now.getFullYear() !== date.getFullYear())
  }, [createdAt, dateFormat, getLocale, dateFormatCalendar, labels.today])

  if (!dateStr)
    return null

  return (
    <View style={[stylesCommon.centerItems, styles.container, containerStyle]}>
      <View style={[styles.wrapper, wrapperStyle]}>
        <Text {...textProps} style={[styles.text, textProps?.style]}>
          {dateStr}
        </Text>
      </View>
    </View>
  )
}
