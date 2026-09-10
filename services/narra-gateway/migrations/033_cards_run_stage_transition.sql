-- Переход стадий прогона для конвейера карточек.
--
-- Триггер из 005 требует, чтобы стадия сдвигалась ровно на один шаг по
-- цепочке prepare → scan → resolve → synthesize → validate → publish. У
-- конвейера карточек сканирующей стадии нет вовсе: персонажей находит
-- детерминированный инвентарь в Prepare, а дальнейшая работа идёт заданиями
-- generation_jobs. Prepare переводит прогон сразу в synthesize, и триггер
-- отбивал этот UPDATE с «analysis stages must advance exactly one step».
--
-- В продакшене это выглядело так: prepare-задание падало с error_code=UNKNOWN
-- (сообщение PostgreSQL до лога не доходит), уходило в повтор и падало снова,
-- пока не исчерпает попытки. Ни одна книга канареечной раскатки не сдвинулась
-- бы дальше Prepare.
--
-- Правило для карточек одно: prepare → synthesize. Больше переходов у этого
-- конвейера нет — стадийных заданий после Prepare он не создаёт, и прогон
-- стоит на synthesize, пока карточки публикуются по окнам. Остальные
-- конвейеры проверяются ровно как прежде: список стадий и «ровно один шаг»
-- для них не менялись.
--
-- Проверка полноты предыдущей стадии сохранена для обоих случаев: у Prepare
-- есть своё обязательное задание, и оно должно быть ready до перехода.

CREATE OR REPLACE FUNCTION enforce_book_analysis_run_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_stage_index INTEGER;
  new_stage_index INTEGER;
  required_job_count BIGINT;
  incomplete_job_count BIGINT;
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
      IF OLD.stage <> 'prepare' OR NEW.stage <> 'synthesize' THEN
        RAISE EXCEPTION 'cards analysis runs advance only from prepare to synthesize'
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
    SELECT count(*), count(*) FILTER (WHERE status <> 'ready')
      INTO required_job_count, incomplete_job_count
    FROM book_analysis_jobs
    WHERE run_id = OLD.id AND stage = OLD.stage AND required;
    IF required_job_count = 0 OR incomplete_job_count > 0 THEN
      RAISE EXCEPTION 'analysis stage % is incomplete', OLD.stage
        USING ERRCODE = 'check_violation';
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
    SELECT count(*), count(*) FILTER (WHERE status <> 'ready')
      INTO required_job_count, incomplete_job_count
    FROM book_analysis_jobs
    WHERE run_id = OLD.id AND stage = 'publish' AND required;
    IF required_job_count = 0 OR incomplete_job_count > 0 THEN
      RAISE EXCEPTION 'publish stage is incomplete'
        USING ERRCODE = 'check_violation';
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
