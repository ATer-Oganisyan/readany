function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

export function isValidDate(value: string | number | Date): boolean {
  return !Number.isNaN(toDate(value).getTime())
}

export function isSameCalendarDay(
  left: string | number | Date,
  right: string | number | Date,
): boolean {
  const a = toDate(left)
  const b = toDate(right)

  return isValidDate(a)
    && isValidDate(b)
    && a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

export function formatChatDate(
  value: string | number | Date,
  locale: string,
  includeYear = false,
): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    ...(includeYear ? { year: 'numeric' as const } : {}),
  }).format(toDate(value))
}

export function formatChatTime(value: string | number | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(toDate(value))
}
