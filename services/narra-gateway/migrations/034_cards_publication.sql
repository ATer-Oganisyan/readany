-- Публикация разметки конвейером карточек.
--
-- Карточный конвейер до сих пор не публиковал ничего: прогон вставал на
-- synthesize, а карточки расходились заданиями generation_jobs. Для книги
-- каталога это работало, потому что разметку ей уже опубликовал narra. Свежая
-- приватная книга на карточках оставалась в статусе marking_up навсегда:
-- book_markup_versions и book_characters заполняет только публикация, а её не
-- было. Пользователь видел книгу, которая «обрабатывается» и не открывается.
--
-- Две вещи мешали это исправить.
--
-- Первая: стадия. Триггер разрешал карточкам ровно один переход,
-- prepare → synthesize. Публиковать стало некуда. Теперь их два, и второй —
-- synthesize → publish. Проверку «предыдущая стадия завершена» для этого
-- перехода не применяем: стадийных заданий после Prepare карточный конвейер не
-- создаёт вовсе, у synthesize их ноль, и общее правило отбивало бы переход
-- сообщением «analysis stage synthesize is incomplete».
--
-- Вторая: одна публикация на прогон. UNIQUE (run_id) не давал опубликоваться
-- второй раз, а окна карточек у приватной книги открываются за читателем —
-- разметка обязана догонять. Публикации остаются неизменяемыми поштучно,
-- снимается только запрет на вторую: читатели и проекция и так берут самую
-- свежую (ORDER BY published_at DESC, id DESC LIMIT 1).

ALTER TABLE book_analysis_publications
  DROP CONSTRAINT IF EXISTS book_analysis_publications_run_id_key;
ALTER TABLE book_analysis_publications
  DROP CONSTRAINT IF EXISTS book_analysis_publications_run_id_channel_key;
ALTER TABLE book_analysis_publications
  DROP CONSTRAINT IF EXISTS book_analysis_publications_artifact_id_channel_key;

-- Один артефакт — одна публикация: артефакт хранит снимок, и публиковать один
-- и тот же снимок дважды нечего. Прогон же публикуется столько раз, сколько
-- у него снимков.
CREATE UNIQUE INDEX IF NOT EXISTS book_analysis_publications_artifact_channel
  ON book_analysis_publications (artifact_id, channel);

CREATE INDEX IF NOT EXISTS book_analysis_publications_run
  ON book_analysis_publications (run_id, channel, published_at DESC);

CREATE OR REPLACE FUNCTION enforce_book_analysis_run_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_stage_index INTEGER;
  new_stage_index INTEGER;
  required_job_count BIGINT;
  incomplete_job_count BIGINT;
  skip_stage_completeness BOOLEAN := FALSE;
BEGIN
  IF OLD.status IN ('ready', 'cancelled') THEN
    RAISE EXCEPTION '% analysis runs are immutable', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.stage <> OLD.stage THEN
    IF OLD.status <> 'running' OR NEW.status <> 'running' THEN
      RAISE EXCEPTION 'stage changes require a running analysis run'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.pipeline_id = 'cards' THEN
      IF OLD.stage = 'prepare' AND NEW.stage = 'synthesize' THEN
        NULL;
      ELSIF OLD.stage = 'synthesize' AND NEW.stage = 'publish' THEN
        -- Стадийных заданий у synthesize здесь нет: работа идёт карточками.
        skip_stage_completeness := TRUE;
      ELSE
        RAISE EXCEPTION 'cards analysis runs advance prepare → synthesize → publish'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      old_stage_index := array_position(
        ARRAY['prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish'],
        OLD.stage
      );
      new_stage_index := array_position(
        ARRAY['prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish'],
        NEW.stage
      );
      IF new_stage_index <> old_stage_index + 1 THEN
        RAISE EXCEPTION 'analysis stages must advance exactly one step'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NOT skip_stage_completeness THEN
      SELECT count(*), count(*) FILTER (WHERE status <> 'ready')
        INTO required_job_count, incomplete_job_count
      FROM book_analysis_jobs
      WHERE run_id = OLD.id AND stage = OLD.stage AND required;
      IF required_job_count = 0 OR incomplete_job_count > 0 THEN
        RAISE EXCEPTION 'analysis stage % is incomplete', OLD.stage
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF OLD.status = 'queued' AND NEW.status NOT IN ('queued', 'running', 'cancelled') THEN
    RAISE EXCEPTION 'unsupported queued analysis transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.status = 'running' AND NEW.status NOT IN ('running', 'ready', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'unsupported running analysis transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.status = 'failed' AND NEW.status NOT IN ('failed', 'queued', 'cancelled') THEN
    RAISE EXCEPTION 'unsupported failed analysis transition'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'ready' AND OLD.status <> 'ready' THEN
    IF OLD.status <> 'running' OR NEW.stage <> 'publish' THEN
      RAISE EXCEPTION 'only a running publish stage can become ready'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Карточный прогон не завершается: окна открываются за читателем, и
    -- разметка публикуется снова по мере их готовности. Готовым он станет,
    -- только если кто-то закроет его явно, и тогда стадийных заданий у него
    -- по-прежнему нет — проверять нечего.
    IF NEW.pipeline_id <> 'cards' THEN
      SELECT count(*), count(*) FILTER (WHERE status <> 'ready')
        INTO required_job_count, incomplete_job_count
      FROM book_analysis_jobs
      WHERE run_id = OLD.id AND stage = 'publish' AND required;
      IF required_job_count = 0 OR incomplete_job_count > 0 THEN
        RAISE EXCEPTION 'publish stage is incomplete'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  NEW.updated_at := now();
  IF OLD.status = 'queued' AND NEW.status = 'running' AND NEW.started_at IS NULL THEN
    NEW.started_at := now();
  END IF;
  IF NEW.status IN ('ready', 'failed', 'cancelled') AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  ELSIF NEW.status IN ('queued', 'running') THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
