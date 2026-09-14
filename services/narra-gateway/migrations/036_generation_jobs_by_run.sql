-- Задания прогона читаются без seq scan.
--
-- Индексы под `analysis_run_id` были частичными — по `character_card` и по
-- `roster_confirm`. Вопрос «все упавшие задания этого прогона» под них не
-- подходил, и каждый такой запрос читал таблицу целиком: на списке из двухсот
-- прогонов это семнадцать миллионов строк и две с половиной минуты ответа.
-- Тот же индекс нужен и снимку дашборда, который группирует задания по прогону.
CREATE INDEX IF NOT EXISTS generation_jobs_by_analysis_run
  ON generation_jobs (analysis_run_id, status)
  WHERE analysis_run_id IS NOT NULL;
