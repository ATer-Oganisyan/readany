-- Состав окна карточек отделён от его барьера (ревью PR #91).
--
-- Барьер окна начинается с нуля у всех окон: карточка персонажа из главы 5
-- опирается на весь текст до конца главы 6. Из этого следовало, что запрос
-- «персонажи этого окна» по `start_offset >= window.start_offset` выбирал
-- каждого раннего персонажа заново в каждом следующем окне, а персонаж главы 2
-- попадал уже в первое окно — то есть получал карточку по первым двум главам
-- вместо правила D1 «глава появления + 1». Повторные задания при этом стоили
-- вызовов модели и не давали результата: `card_revision` всегда 1, а вставка
-- идёт с ON CONFLICT DO NOTHING.
--
-- Диапазон состава считает `buildBookCardWindows` тем же правилом, что
-- `cardWindowIndexForOffset`, и диапазоны соседних окон не пересекаются.

ALTER TABLE book_card_windows
  ADD COLUMN IF NOT EXISTS assign_start_offset INTEGER,
  ADD COLUMN IF NOT EXISTS assign_end_offset INTEGER;

-- Досчёт для уже существующих прогонов: состав окна N — главы окна N-1, потому
-- что барьер персонажа кончается главой, следующей за главой его появления.
-- Последнее окно забирает и свою главу: за её конец текст не идёт.
WITH shifted AS (
  SELECT run_id, window_index,
         COALESCE(LAG(end_offset, 2) OVER (PARTITION BY run_id ORDER BY window_index), 0)
           AS assign_start,
         CASE
           WHEN LEAD(window_index) OVER (PARTITION BY run_id ORDER BY window_index) IS NULL
             THEN end_offset
           ELSE COALESCE(LAG(end_offset) OVER (PARTITION BY run_id ORDER BY window_index),
                         start_offset)
         END AS assign_end
  FROM book_card_windows
)
UPDATE book_card_windows AS target
SET assign_start_offset = shifted.assign_start,
    assign_end_offset = GREATEST(shifted.assign_end, shifted.assign_start)
FROM shifted
WHERE target.run_id = shifted.run_id
  AND target.window_index = shifted.window_index
  AND target.assign_start_offset IS NULL;

ALTER TABLE book_card_windows
  ALTER COLUMN assign_start_offset SET NOT NULL,
  ALTER COLUMN assign_end_offset SET NOT NULL;

ALTER TABLE book_card_windows
  ADD CONSTRAINT book_card_windows_assignment_range
    CHECK (assign_start_offset >= 0 AND assign_end_offset >= assign_start_offset);
