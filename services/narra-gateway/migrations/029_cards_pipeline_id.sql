-- `pipeline=cards` рядом с narra и external (work order character-cards-pipeline, P7).
--
-- Идентичность конвейера отделена от его подключения к машине стадий: строка
-- прогона должна уметь называться `cards` раньше, чем переход стадий под этот
-- конвейер подведён, иначе включить его на канарейке нечем. Сам конвейер пока
-- отказывается создавать scan-задания с кодом PIPELINE_STAGE_FLOW_UNWIRED —
-- громко, а не тихой остановкой прогона.

DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('book_analysis_runs'::regclass, 'book_analysis_jobs'::regclass)
      AND pg_get_constraintdef(oid) LIKE '%pipeline_id%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT %I',
      constraint_record.table_name,
      constraint_record.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE book_analysis_runs
  ADD CONSTRAINT book_analysis_runs_pipeline_v2 CHECK (
    pipeline_id IN ('narra', 'external', 'cards')
  );

ALTER TABLE book_analysis_jobs
  ADD CONSTRAINT book_analysis_jobs_pipeline_v2 CHECK (
    pipeline_id IN ('narra', 'external', 'cards')
  );
