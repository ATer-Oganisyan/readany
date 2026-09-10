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

-- Досчёт для уже существующих прогонов.
--
-- Точный диапазон считается по границам глав, а из строк окон границы глав не
-- восстанавливаются: у первого окна их несколько, и внутренние в базе не
-- записаны. Поэтому здесь окно забирает свой собственный пролёт — от конца
-- предыдущего окна до своего конца, — а не пролёт предыдущего.
--
-- Что это значит для старого прогона: барьер карточки оказывается на главу уже
-- точного, то есть «глава появления» вместо «глава появления + 1». Это
-- беднее, но безопасно — спойлеров такой барьер не добавляет, — и, в отличие
-- от смещённого варианта, диапазоны не вырождаются: у смещённого правила
-- первое окно получало [0, 0] и не отвечало ни за кого, а второе забирало обе
-- первые главы и уводило ранних героев из foreground-окна. Точные диапазоны
-- новый прогон получает от `buildBookCardWindows`; старому для этого нужен
-- повторный Prepare.
WITH own_span AS (
  SELECT run_id, window_index,
         COALESCE(LAG(end_offset) OVER (PARTITION BY run_id ORDER BY window_index), 0)
           AS assign_start,
         end_offset AS assign_end
  FROM book_card_windows
)
UPDATE book_card_windows AS target
SET assign_start_offset = own_span.assign_start,
    assign_end_offset = GREATEST(own_span.assign_end, own_span.assign_start)
FROM own_span
WHERE target.run_id = own_span.run_id
  AND target.window_index = own_span.window_index
  AND target.assign_start_offset IS NULL;

ALTER TABLE book_card_windows
  ALTER COLUMN assign_start_offset SET NOT NULL,
  ALTER COLUMN assign_end_offset SET NOT NULL;

-- Идемпотентно: миграцию прогоняют и повторно (например, тест досчёта).
DO $$
BEGIN
  -- Проверка по конкретной таблице, а не по имени во всех схемах: тесты
  -- гоняют миграции в изолированных схемах, и глобальное имя нашлось бы от
  -- соседней схемы, а ограничение в этой так и не появилось бы.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'book_card_windows_assignment_range'
      AND conrelid = 'book_card_windows'::regclass
  ) THEN
    ALTER TABLE book_card_windows
      ADD CONSTRAINT book_card_windows_assignment_range
        CHECK (assign_start_offset >= 0 AND assign_end_offset >= assign_start_offset);
  END IF;
END;
$$;
