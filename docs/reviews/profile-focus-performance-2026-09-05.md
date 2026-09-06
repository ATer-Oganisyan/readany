# Скрытый профиль: лишняя работа на таймере чтения

## Доказательство

Android QA наблюдал очень долгий Reader → Characters после продолжительной
сессии. Это не доказательство бесконечного цикла: после ожидания JS успокоился.
В сохранённой [трассе до изменения](evidence/android-2026-09-05/characters-cpu-before.json.gz)
и её summary независимо подтверждены события начала `ph === "b"`:
`MiniHeatmap` 4, `TouchableOpacity` 1347, `View` 1321 и четыре Scheduler update
для скрытого `ProfileScreen` через `updateSyncExternalStore()`.
Окно, измеренное Android QA, — 5.117 секунды; 157 native commit starts.
Это события всей трассы, не число уникальных view и не удвоенный подсчёт start/end.

`ProfileScreen` оставался подписан на весь `currentSession`, хотя native tabs
сохраняют его под Reader. Настоящий `updateActiveTime()` создаёт новый session
object каждую секунду, что перерисовывает карточки, heatmap и настройки профиля.

Mounted regression с настоящим Zustand store и production tick action показал
**60 отдельных ticks → 60 commits скрытого Profile**. Два теста были RED.

## Изменение и проверка

Единственное runtime изменение: `ProfileScreen` выбирает `currentSession` только
при `useIsFocused()`, иначе стабильный `null`. Стабильные action selectors,
видимая статистика, UI, стили, навигация и семантика таймера не изменены.

После изменения **60 ticks → 0 commits скрытого Profile**. Три теста проходят:
скрытый экран; живые корректные значения видимого экрана; blur/refocus с
актуальной накопленной статистикой. Layout heatmap выполнен, все 112 cells
реально смонтированы; mocked DB snapshot не выдаётся за проверку SQLite.
App TypeScript и Biome проходят.

Команда: `pnpm --filter @readany/app-expo exec vitest run src/lib/reader/profile-focus-performance.test.tsx`.

Это устранение одного измеренного источника лишней работы, не обещание
процентного ускорения всего Reader → Characters. Android native after-trace
и соседние Reader subscriptions проверяются отдельно; до их завершения
полная задержка перехода не объявляется исправленной.

## Android after: изолированное изменение Profile

Android QA выполнил [after trace](evidence/android-2026-09-05/characters-cpu-profile-only-after.json.gz)
после cold reload с только этим изменением, до установки
следующего reader fix. Окно after — 5.074 секунды против before 5.117 секунды.
Подсчёт тот же (`ph === "b"`): ProfileScreen Scheduler updates **4 → 0**,
MiniHeatmap render starts **4 → 0**, native commits **157 → 21**, View render
starts **1321 → 354**. Character list реально открылся; прежнее ожидание более
30 секунд не повторилось. Trace включает профилировочную и dev-нагрузку,
не является чистым замером frame/input latency и не даёт процента ускорения
перехода. Отдельные ReaderContent tick updates ещё присутствовали.

## Отдельный Reader selector patch

Последующий reader-agent patch заменил whole-store subscription в
`useReadingSession` шестью action selectors; detector читает актуальный bookId
через ref. В ReaderContent вместо полного totalActiveTime подписка возвращает
book-bound boolean достижения 60 секунд; effect читает актуальное время и
повторно проверяет identity перед telemetry. Независимый review не нашёл
новых блокеров, actual hook/Reader statement regressions **7 PASS**.
Они проверяют ticks без rerender, A → B/null → B, visibility/cleanup,
реальную накопленную длительность и отсутствие события чужой книги.
Profile-only native after-trace выше не выдаётся за native проверку этого
более позднего изменения. Pause-on-sheet и логика сохранения статистики
этим selector patch не изменялись.
