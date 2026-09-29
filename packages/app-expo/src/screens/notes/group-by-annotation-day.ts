import type { TFunction } from "i18next";

function annotationDayBuckets(t: TFunction, now: Date) {
  const day = (daysAgo: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  return [
    { title: t("notes.today", "Сегодня"), from: day(0), to: Number.POSITIVE_INFINITY },
    { title: t("notes.yesterday", "Вчера"), from: day(1), to: day(0) },
    { title: t("notes.last7Days", "За последние 7 дней"), from: day(7), to: day(1) },
    { title: t("notes.last30Days", "За последние 30 дней"), from: day(30), to: day(7) },
    { title: t("notes.earlier", "Раньше"), from: Number.NEGATIVE_INFINITY, to: day(30) },
  ];
}

/** The notes date label ("Сегодня", "Вчера", …) for a single timestamp. */
export function annotationDayLabel(timestamp: number, t: TFunction, now = new Date()): string {
  const buckets = annotationDayBuckets(t, now);
  return (buckets.find((bucket) => timestamp >= bucket.from && timestamp < bucket.to) ?? buckets[4])
    .title;
}

/** Shared date sections for notes and bookmarks, using local calendar days. */
export function groupByAnnotationDay<T, R>(
  items: T[],
  timestamp: (item: T) => number,
  row: (item: T) => R,
  t: TFunction,
  now = new Date(),
): Array<{ title: string; data: R[] }> {
  const sorted = [...items].sort((a, b) => timestamp(b) - timestamp(a));
  return annotationDayBuckets(t, now)
    .map((bucket) => ({
      title: bucket.title,
      data: sorted
        .filter((item) => timestamp(item) >= bucket.from && timestamp(item) < bucket.to)
        .map(row),
    }))
    .filter((section) => section.data.length > 0);
}
