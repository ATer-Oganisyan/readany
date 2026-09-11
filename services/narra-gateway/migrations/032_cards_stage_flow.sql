-- Стадийный поток конвейера карточек: roster прогона и задание подтверждения.
--
-- Две недостающие вещи, без которых `pipeline=cards` не мог работать в
-- продакшене.
--
-- 1. Подтверждённый roster нигде не хранился. Из-за этого имя персонажа
--    приходилось доставать из инвентаря по ключу кандидата, а связь между
--    `name:raskolnikov` и `char:raskolnikov` восстанавливать по общей части
--    ключа. Теперь связь явная: строка roster несёт и ключ персонажа, и
--    кандидатов, из которых он собран.
--
-- 2. Подтверждение идёт заданием, а не внутри Prepare. Оно ходит в модель и
--    занимает минуты, а Prepare держит аренду и транзакцию; кроме того,
--    подтверждение делается в два захода — сперва окно первых глав, потом вся
--    книга, — и второй заход по определению живёт отдельно от первого.

CREATE TABLE IF NOT EXISTS book_character_roster (
  run_id UUID NOT NULL REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  character_key TEXT NOT NULL CHECK (character_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  canonical_name TEXT NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 200),
  names TEXT[] NOT NULL,
  candidate_keys TEXT[] NOT NULL CHECK (array_length(candidate_keys, 1) > 0),
  mention_count INTEGER NOT NULL CHECK (mention_count >= 0),
  first_mention_text_offset INTEGER NOT NULL CHECK (first_mention_text_offset >= 0),
  tier TEXT NOT NULL CHECK (tier IN ('significant', 'roster')),
  -- Окно, чьё подтверждение выпустило эту строку. Полный заход по книге пишет
  -- NULL: он отвечает не за окно, а за всю книгу.
  window_index INTEGER CHECK (window_index >= 0),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, character_key)
);

-- Кандидат принадлежит ровно одному персонажу прогона: две строки roster,
-- претендующие на один ключ кандидата, — это расщепление, которого конвейер
-- как раз и избегает.
CREATE UNIQUE INDEX IF NOT EXISTS book_character_roster_candidate_unique
  ON book_character_roster (run_id, (candidate_keys[1]));

CREATE INDEX IF NOT EXISTS book_character_roster_by_offset
  ON book_character_roster (run_id, first_mention_text_offset);

-- `roster_confirm` рядом с `character_card`.
DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  -- Ищется именно перечисление типов, а не всякий CHECK, упоминающий
  -- `character_card`: под второе условие попадает и
  -- `generation_jobs_card_window_v1` («карточка обязана знать своё окно»), и
  -- первая версия этой миграции сносила его заодно — вместе с инвариантом,
  -- который он держит.
  FOR constraint_record IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'generation_jobs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%job_type%'
      AND pg_get_constraintdef(oid) LIKE '%book_markup%'
      AND pg_get_constraintdef(oid) LIKE '%character_animation%'
  LOOP
    EXECUTE format('ALTER TABLE generation_jobs DROP CONSTRAINT %I', constraint_record.conname);
  END LOOP;
END;
$$;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_job_type_v3 CHECK (
    job_type IN (
      'book_markup', 'book_identity', 'catalog_cover', 'scene_image',
      'character_bundle', 'character_portrait', 'character_audio',
      'character_animation', 'character_card', 'roster_confirm'
    )
  );

-- Подтверждение — задание уровня прогона, а не персонажа: у него есть
-- `analysis_run_id`, но нет `character_key`. Прежний CHECK требовал персонажа у
-- всякого типа вне книжного списка, поэтому `roster_confirm` в него не
-- помещался; список расширен, а не ослаблен — остальные типы по-прежнему обязаны
-- называть персонажа.
--
-- Про `generation_jobs_card_window_v1` из 028 здесь намеренно ничего нет: он и
-- так говорит ровно то, что нужно («карточка обязана знать своё окно»), и
-- второй CHECK о том же лишь подменил бы имя в сообщении об ошибке.
ALTER TABLE generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_character_v5;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_character_v6 CHECK (
    (job_type IN ('book_markup', 'book_identity', 'catalog_cover', 'scene_image', 'roster_confirm')
      AND character_key IS NULL) OR
    (job_type NOT IN ('book_markup', 'book_identity', 'catalog_cover', 'scene_image', 'roster_confirm')
      AND character_key IS NOT NULL)
  );

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_roster_confirm_scope CHECK (
    job_type <> 'roster_confirm' OR analysis_run_id IS NOT NULL
  );

-- Одно подтверждение на прогон и окно: повторная постановка не должна давать
-- второй вызов модели.
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_roster_confirm_window
  ON generation_jobs (analysis_run_id, COALESCE(card_window_index, -1))
  WHERE job_type = 'roster_confirm';
