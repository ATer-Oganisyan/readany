# Сессия чтения: перерисовки, смена книги и сохранение статистики

## Подтверждённые ошибки

1. `useReadingSession` подписывал весь экран на каждое изменение сессии.
   Mounted hook с настоящим Zustand и его секундным таймером дал 10 render
   за 10 ticks; таймер квалификации Reader отдельно давал 59 render до минуты.
2. Callback детектора сохранял первый bookId. Смена A → B в том же mounted hook
   снова запускала A; начальное `null` → B запускало пустой bookId.
3. Reader мог засчитать минуту новой книге по ещё активной сессии предыдущей.
   Boolean «уже отправлено» также мешал независимо квалифицировать следующую книгу.
4. Запоздалый autosave заменял новую B снимком A, обнулял новые секунды/страницы/
   символы и мог вернуть ACTIVE вместо PAUSED. Concurrent save/stop пытались
   повторно INSERT одного ID, получали UNIQUE и теряли более полный snapshot.

## Исправление и границы

Core hook использует шесть стабильных action selectors и актуальный bookId ref.
Reader подписан только на boolean `currentSession.bookId === bookId && time >= 60s`.
При отправке telemetry повторно проверяется live identity и читается фактическое
время через `getState()` — это не жёстко заданные 60 секунд.

Autosave объединяется по ID сегмента. Успешная запись вычитает сохранённые счётчики
только из того же live ID/книги, оставляя накопленную разницу и текущее состояние.
Stop сразу закрывает live session; если autosave ещё идёт, после его успеха пишет
только остаток под новым ID, после ошибки — полный остановленный snapshot.
Новый пользовательский экран/книга не заменяется завершением старой записи.

Существующая сегментная модель статистики и API сохранены. Остаток страниц/
символов между секундными ticks не отбрасывается даже при нулевой разнице времени.
Это не новый durable journal: отказ записи окончательно остановленной сессии
по-прежнему логируется; сохранение статистики при kill до завершения DB этим
этапом не доказывается. Читательские CFI/checkpoint здесь не изменялись.

## Проверки

- Mounted React + real Zustand: **6 RED → 7 GREEN**.
  Проверки Reader выполняют реальные subscription/ref/effect statements,
  извлечённые из production ReaderContent; нативный экран целиком не подменяется
  утверждением о browser layout или скорости перехода.
- Deferred DB + real session store/write queue: **6 RED → 11 GREEN**.
  DB adapter моделирует настоящий INSERT/UNIQUE контракт, не permissive upsert.
  Покрыты A/B, новый ID той же книги, две независимые записи, deltas, PAUSED,
  concurrent save/stop, disk failure/retry и отсутствие двойного учёта.
- Core session/SQL/sync/live stats: **42/42 PASS**.
- Mobile subscriptions/Profile/counter/progress/Sonner/character-entry: **47/47 PASS**.
- App TypeScript, Biome изменённых session-файлов и `git diff --check`: PASS.
- Полный core на официальном Node 24.20.0: **639/639 PASS**, 79 suites.
  Полный mobile: **1278 PASS**, 5 TCP-проверок заблокированы sandbox `listen EPERM`,
  не поведенческим assertion. Их отдельный unrestricted rerun передан root.

```sh
# packages/core
pnpm exec vitest run src/stores/reading-session-store.test.ts src/db/__tests__/session-queries.test.ts src/stores/sync-store.test.ts src/stats/live-reading-stats.test.ts
# packages/app-expo
pnpm exec vitest run src/lib/reader/reading-session-subscriptions.test.tsx src/lib/reader/profile-focus-performance.test.tsx src/lib/reader/reader-fixed-page-count.test.ts src/lib/reader/reader-progress.test.ts src/lib/reader/toast-gesture-recovery.test.ts src/lib/narra/character-entry-progress.test.ts
pnpm exec tsc --noEmit
```

Android native AFTER: цикл Reader → Characters → Retry → Narra → клавиатура/Send →
Back → Reader сохранил точный CFI и 300 символов. В отдельном 5-секундном idle trace
нет прежней секундной серии перерисовок и нет Profile/MiniHeatmap renders; один
Scheduler Update и один render ReaderContent всё же есть. Это не утверждение о
нулевых обновлениях интерфейса или production frame time. Исходные trace:
`/private/tmp/narra-audit-android-reader-ticks-final-trace.json` и
`/private/tmp/narra-audit-android-reader-idle-final-trace.json`.

На этапе исправления сессий стандартный `core tsc --noEmit` блокировался TS5101
из-за старого baseUrl; временный проверочный запуск использовал
`--ignoreDeprecations 6.0`. Затем отдельный согласованный config fix удалил только
избыточный `baseUrl`, не изменяя `paths`: теперь обычный `tsc --noEmit` на
Node 24.20.0 проходит без suppression. Четыре compiler/alias regressions также
проходят. Fixture-типы и ES2020-совместимый Error.cause исправлены без расширения lib.

Поздний root полный mobile Node 24: **140 suites / 1287 PASS, 0 skipped**,
`/private/tmp/narra-audit-mobile-root-final.log`; предварительное препятствие
TCP sandbox выше снято unrestricted прогоном, а не замаскировано skip.
