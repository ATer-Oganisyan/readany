-- Задание `character_card` в очереди генерации (work order character-cards-pipeline, P3).
--
-- Карточка ставится как задание generation_jobs, а не новой стадией
-- book_analysis_jobs: стадии анализа упорядочены и завершаются публикацией, а
-- карточки появляются по окнам и после публикации тоже. Ломать ради этого
-- порядок стадий незачем — у очереди генерации уже есть приоритеты, дневные
-- бюджеты и operator pause, а карточке нужно именно это.
--
-- character_key у задания карточки заполнен, поэтому второй CHECK
-- (character_key обязателен для всего, кроме книжных типов) действует без
-- изменений.

DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'generation_jobs'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) LIKE '%job_type%' OR
        pg_get_constraintdef(oid) LIKE '%character_key%'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE generation_jobs DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_type_v5 CHECK (
    job_type IN (
      'book_markup', 'book_identity', 'catalog_cover', 'scene_image',
      'character_bundle', 'character_portrait', 'character_audio',
      'character_animation', 'character_card'
    )
  ),
  ADD CONSTRAINT generation_jobs_character_v5 CHECK (
    (job_type IN ('book_markup', 'book_identity', 'catalog_cover', 'scene_image')
      AND character_key IS NULL) OR
    (job_type NOT IN ('book_markup', 'book_identity', 'catalog_cover', 'scene_image')
      AND character_key IS NOT NULL)
  );

-- Задание карточки принадлежит окну прогона анализа, а не разметке книги:
-- окно задаёт спойлер-барьер, и без него задание не воспроизводимо.
ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS analysis_run_id UUID REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS card_window_index INTEGER;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_card_window_v1 CHECK (
    (job_type = 'character_card' AND analysis_run_id IS NOT NULL AND card_window_index >= 0) OR
    job_type <> 'character_card'
  );

-- Одно задание на персонажа в окне: повторная постановка не должна порождать
-- вторую карточку той же ревизии.
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_character_card_window
  ON generation_jobs (analysis_run_id, card_window_index, character_key)
  WHERE job_type = 'character_card';
