import type { TFunction } from "i18next";
import { expect, it } from "vitest";
import { groupByAnnotationDay } from "./group-by-annotation-day";

it("groups notes and bookmarks by calendar day, newest first, without empty sections", () => {
  const now = new Date(2026, 8, 29, 12);
  const date = (day: number, hour = 0) => new Date(2026, 8, day, hour).getTime();
  const items = [
    { id: "older-today", at: date(29, 1) },
    { id: "week", at: date(22) },
    { id: "yesterday", at: date(28) },
    { id: "month", at: new Date(2026, 7, 30).getTime() },
    { id: "earlier", at: new Date(2026, 7, 29, 23).getTime() },
    { id: "today", at: date(29, 10) },
  ];
  const t = ((_key: string, fallback: string) => fallback) as TFunction;
  const grouped = groupByAnnotationDay(
    items,
    (item) => item.at,
    (item) => item.id,
    t,
    now,
  );
  expect(grouped).toEqual([
    { title: "Сегодня", data: ["today", "older-today"] },
    { title: "Вчера", data: ["yesterday"] },
    { title: "За последние 7 дней", data: ["week"] },
    { title: "За последние 30 дней", data: ["month"] },
    { title: "Раньше", data: ["earlier"] },
  ]);
  expect(items[0].id).toBe("older-today");
  expect(
    groupByAnnotationDay(
      [],
      () => 0,
      (item) => item,
      t,
      now,
    ),
  ).toEqual([]);
});
