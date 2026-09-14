/**
 * Снимок для операторского дашборда: кто из воркеров жив и что происходит с
 * книгами прямо сейчас.
 *
 * Отдельно от `/v2/admin/metrics`: тот снимок агрегатный — «столько-то заданий
 * в статусе X по всей установке». Оператору во время раскатки нужен другой
 * срез: эта книга, эта стадия, эти карточки. Сводить одно к другому не вышло
 * бы — метрики намеренно не знают ни про книгу, ни про прогон.
 *
 * Воркеры и занятые задания показываются раздельно, и это не оплошность.
 * `worker_heartbeats.worker_id` — имя контейнера (HOSTNAME), а `locked_by`
 * задания — идентификатор процесса, и связать их join'ом нельзя. Поэтому здесь
 * два ответа на два разных вопроса: «кто поднят» и «что сейчас в работе».
 *
 * Воркеры сводятся по типу, а не по типу и сборке. Строка heartbeat живёт по
 * имени контейнера, а контейнер после каждого деплоя новый: пять выкаток за
 * день дают пять мёртвых строк на каждый живой воркер. Разбивка по сборкам
 * превращала список в 136 групп, из которых 130 — вчерашние контейнеры.
 * Сборки живых воркеров остаются: расхождение в них и есть тот единственный
 * случай, ради которого разбивка была нужна.
 */

const ACTIVE_RUN_STATUSES = ['queued', 'running']

function count(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function duration(value) {
  if (value == null) return null
  return Math.max(0, Math.round(count(value)))
}

function groupBy(rows, key) {
  const grouped = new Map()
  for (const row of rows) {
    const id = row[key]
    if (!id) continue
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id).push(row)
  }
  return grouped
}

function tally(rows, nameKey) {
  return rows.map((row) => ({
    name: row[nameKey],
    status: row.status,
    count: count(row.count)
  }))
}

export function createBookProgressRepository(pool, { staleWorkerSeconds = 60 } = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('a pg-compatible pool is required')
  }
  if (!Number.isSafeInteger(staleWorkerSeconds) || staleWorkerSeconds < 30 || staleWorkerSeconds > 3_600) {
    throw new RangeError('staleWorkerSeconds must be between 30 and 3600')
  }

  return {
    /**
     * Полный список книг, запущенных в конвейер карточек, по времени запуска.
     *
     * Снимок дашборда намеренно короткий: он отвечает на «что происходит
     * сейчас» и держит два десятка книг. У перевода каталога вопрос другой —
     * «что мы уже запустили и где оно стоит», и ответ на него нужен целиком,
     * иначе книга, застрявшая три сотни строк назад, не видна вообще.
     *
     * Берётся последний прогон книги: перезапуск создаёт новый, и без этого
     * одна книга давала бы столько строк, сколько раз её перезапускали.
     */
    async cardsRuns({ limit = 600 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_000) {
        throw new RangeError('limit must be between 1 and 2000')
      }
      const runs = await pool.query(
        `SELECT latest.id AS run_id, latest.book_edition_id, latest.stage, latest.status,
                latest.run_sequence, latest.created_at, latest.updated_at,
                latest.pipeline_implementation_version,
                edition.title, edition.author, edition.scope
           FROM (
             SELECT DISTINCT ON (run.book_edition_id) run.*
               FROM book_analysis_runs AS run
              WHERE run.pipeline_id = 'cards'
              ORDER BY run.book_edition_id, run.created_at DESC, run.run_sequence DESC
           ) AS latest
           JOIN book_editions AS edition ON edition.id = latest.book_edition_id
          ORDER BY latest.created_at DESC, latest.book_edition_id
          LIMIT $1`,
        [limit]
      )
      const runIds = runs.rows.map((row) => row.run_id)
      const empty = { rows: [] }
      // Счётчики собираются четырьмя проходами по списку прогонов, а не
      // подзапросом на каждый. LATERAL здесь стоил 141 секунду: у
      // `generation_jobs` нет индекса под «все задания прогона», и каждый из
      // двухсот прогонов приводил свой seq scan по семидесяти тысячам строк.
      const [windows, cards, publications, failures] = runIds.length
        ? await Promise.all([
          pool.query(
            `SELECT run_id, count(*)::integer AS total,
                    count(*) FILTER (WHERE status = 'ready')::integer AS ready
               FROM book_card_windows WHERE run_id = ANY($1::uuid[]) GROUP BY run_id`,
            [runIds]
          ),
          pool.query(
            `SELECT run_id, count(*) FILTER (WHERE enabled)::integer AS published
               FROM book_character_cards WHERE run_id = ANY($1::uuid[]) GROUP BY run_id`,
            [runIds]
          ),
          pool.query(
            `SELECT run_id, count(*)::integer AS count, max(published_at) AS last_at
               FROM book_analysis_publications WHERE run_id = ANY($1::uuid[]) GROUP BY run_id`,
            [runIds]
          ),
          pool.query(
            `SELECT analysis_run_id AS run_id, count(*)::integer AS count,
                    array_agg(DISTINCT last_error_code)
                      FILTER (WHERE last_error_code IS NOT NULL) AS codes
               FROM generation_jobs
              WHERE analysis_run_id = ANY($1::uuid[]) AND status = 'failed'
              GROUP BY analysis_run_id`,
            [runIds]
          )
        ])
        : [empty, empty, empty, empty]

      const windowsByRun = new Map(windows.rows.map((row) => [row.run_id, row]))
      const cardsByRun = new Map(cards.rows.map((row) => [row.run_id, row]))
      const publicationsByRun = new Map(publications.rows.map((row) => [row.run_id, row]))
      const failuresByRun = new Map(failures.rows.map((row) => [row.run_id, row]))

      return {
        generatedAt: new Date().toISOString(),
        limit,
        runs: runs.rows.map((row) => ({
          runId: row.run_id,
          bookEditionId: row.book_edition_id,
          title: row.title,
          author: row.author,
          scope: row.scope,
          stage: row.stage,
          status: row.status,
          runSequence: count(row.run_sequence),
          implementationVersion: row.pipeline_implementation_version,
          startedAt: row.created_at,
          updatedAt: row.updated_at,
          windows: {
            total: count(windowsByRun.get(row.run_id)?.total),
            ready: count(windowsByRun.get(row.run_id)?.ready)
          },
          cards: count(cardsByRun.get(row.run_id)?.published),
          publications: count(publicationsByRun.get(row.run_id)?.count),
          lastPublishedAt: publicationsByRun.get(row.run_id)?.last_at ?? null,
          failedJobs: count(failuresByRun.get(row.run_id)?.count),
          failedCodes: failuresByRun.get(row.run_id)?.codes ?? []
        }))
      }
    },

    async snapshot({
      bookLimit = 25,
      recentHours = 24,
      runningLimit = 60,
      workerRetentionHours = 24
    } = {}) {
      if (!Number.isSafeInteger(bookLimit) || bookLimit < 1 || bookLimit > 200) {
        throw new RangeError('bookLimit must be between 1 and 200')
      }
      if (!Number.isSafeInteger(workerRetentionHours)
        || workerRetentionHours < 1 || workerRetentionHours > 720) {
        throw new RangeError('workerRetentionHours must be between 1 and 720')
      }
      if (!Number.isSafeInteger(recentHours) || recentHours < 1 || recentHours > 720) {
        throw new RangeError('recentHours must be between 1 and 720')
      }
      if (!Number.isSafeInteger(runningLimit) || runningLimit < 1 || runningLimit > 500) {
        throw new RangeError('runningLimit must be between 1 and 500')
      }

      const [workers, running, runs] = await Promise.all([
        pool.query(
          `SELECT worker_type,
                  count(*) FILTER (WHERE fresh)::integer AS alive,
                  count(*) FILTER (WHERE NOT fresh AND kept)::integer AS stale,
                  coalesce(array_agg(DISTINCT build_version) FILTER (WHERE fresh), '{}') AS builds,
                  coalesce(array_agg(DISTINCT state) FILTER (WHERE fresh), '{}') AS states,
                  max(last_seen_at) FILTER (WHERE kept) AS last_seen_at
             FROM (
               SELECT worker_type, build_version, state, last_seen_at,
                      last_seen_at >= now() - make_interval(secs => $1::double precision) AS fresh,
                      last_seen_at >= now() - make_interval(hours => $2::integer) AS kept
                 FROM worker_heartbeats
             ) AS beats
            GROUP BY worker_type
           HAVING count(*) FILTER (WHERE kept) > 0
            ORDER BY count(*) FILTER (WHERE fresh) DESC, worker_type`,
          [staleWorkerSeconds, workerRetentionHours]
        ),
        pool.query(
          `SELECT kind, job_id, worker_id, label, character_key, book_title, lease_age_ms
             FROM (
               SELECT 'analysis' AS kind, job.id::text AS job_id, job.locked_by AS worker_id,
                      job.stage AS label, NULL::text AS character_key,
                      edition.title AS book_title,
                      round(extract(epoch FROM (now() - job.locked_at)) * 1000)::bigint AS lease_age_ms
                 FROM book_analysis_jobs AS job
                 JOIN book_analysis_runs AS run ON run.id = job.run_id
                 JOIN book_editions AS edition ON edition.id = run.book_edition_id
                WHERE job.status = 'running'
               UNION ALL
               SELECT 'generation', job.id::text, job.locked_by,
                      job.job_type, job.character_key,
                      edition.title,
                      round(extract(epoch FROM (now() - job.locked_at)) * 1000)::bigint
                 FROM generation_jobs AS job
                 JOIN book_editions AS edition ON edition.id = job.book_edition_id
                WHERE job.status = 'running'
             ) AS busy
            ORDER BY lease_age_ms DESC NULLS LAST
            LIMIT $1`,
          [runningLimit]
        ),
        pool.query(
          `WITH latest AS (
             SELECT DISTINCT ON (run.book_edition_id) run.*
               FROM book_analysis_runs AS run
              ORDER BY run.book_edition_id, run.created_at DESC, run.run_sequence DESC
           )
           SELECT latest.id AS run_id, latest.book_edition_id, latest.pipeline_id,
                  latest.stage, latest.status, latest.run_sequence,
                  latest.created_at, latest.updated_at,
                  edition.title, edition.author, edition.scope
             FROM latest
             JOIN book_editions AS edition ON edition.id = latest.book_edition_id
            WHERE latest.status = ANY($1::text[])
               OR latest.updated_at >= now() - make_interval(hours => $2::integer)
            ORDER BY (latest.status = ANY($1::text[])) DESC, latest.updated_at DESC
            LIMIT $3`,
          [ACTIVE_RUN_STATUSES, recentHours, bookLimit]
        )
      ])

      const runIds = runs.rows.map((row) => row.run_id)
      const editionIds = runs.rows.map((row) => row.book_edition_id)
      const empty = { rows: [] }
      const [stages, runJobs, editionJobs, roster, cards, windows, publications] = runIds.length
        ? await Promise.all([
          pool.query(
            `SELECT run_id, stage AS name, status, count(*)::integer AS count
               FROM book_analysis_jobs
              WHERE run_id = ANY($1::uuid[])
              GROUP BY run_id, stage, status
              ORDER BY run_id, stage, status`,
            [runIds]
          ),
          pool.query(
            `SELECT analysis_run_id AS run_id, job_type AS name, status, count(*)::integer AS count
               FROM generation_jobs
              WHERE analysis_run_id = ANY($1::uuid[])
              GROUP BY analysis_run_id, job_type, status
              ORDER BY analysis_run_id, job_type, status`,
            [runIds]
          ),
          pool.query(
            `SELECT book_edition_id, job_type AS name, status, count(*)::integer AS count
               FROM generation_jobs
              WHERE book_edition_id = ANY($1::uuid[]) AND analysis_run_id IS NULL
              GROUP BY book_edition_id, job_type, status
              ORDER BY book_edition_id, job_type, status`,
            [editionIds]
          ),
          pool.query(
            `SELECT run_id, tier, count(*)::integer AS count
               FROM book_character_roster
              WHERE run_id = ANY($1::uuid[])
              GROUP BY run_id, tier
              ORDER BY run_id, tier`,
            [runIds]
          ),
          pool.query(
            `SELECT run_id,
                    count(*) FILTER (WHERE enabled)::integer AS published,
                    max(window_index)::integer AS last_window
               FROM book_character_cards
              WHERE run_id = ANY($1::uuid[])
              GROUP BY run_id`,
            [runIds]
          ),
          // Окна и публикации: у карточного прогона стадия всегда одна и та же,
          // и по ней не видно ни движения, ни беды. Движется здесь число
          // закрытых окон, а бедой оказывается ноль публикаций при готовых
          // карточках — книга без разметки, которая выглядела работающей.
          pool.query(
            `SELECT run_id, count(*)::integer AS total,
                    count(*) FILTER (WHERE status = 'ready')::integer AS ready
               FROM book_card_windows
              WHERE run_id = ANY($1::uuid[])
              GROUP BY run_id`,
            [runIds]
          ),
          pool.query(
            `SELECT run_id, count(*)::integer AS count, max(published_at) AS last_at
               FROM book_analysis_publications
              WHERE run_id = ANY($1::uuid[])
              GROUP BY run_id`,
            [runIds]
          )
        ])
        : [empty, empty, empty, empty, empty, empty, empty]

      const stagesByRun = groupBy(stages.rows, 'run_id')
      const runJobsByRun = groupBy(runJobs.rows, 'run_id')
      const editionJobsByEdition = groupBy(editionJobs.rows, 'book_edition_id')
      const rosterByRun = groupBy(roster.rows, 'run_id')
      const cardsByRun = new Map(cards.rows.map((row) => [row.run_id, row]))
      const windowsByRun = new Map(windows.rows.map((row) => [row.run_id, row]))
      const publicationsByRun = new Map(publications.rows.map((row) => [row.run_id, row]))

      return {
        generatedAt: new Date().toISOString(),
        staleWorkerSeconds,
        workerRetentionHours,
        workers: workers.rows.map((row) => ({
          workerType: row.worker_type,
          alive: count(row.alive),
          stale: count(row.stale),
          builds: row.builds ?? [],
          states: row.states ?? [],
          lastSeenAt: row.last_seen_at
        })),
        running: running.rows.map((row) => ({
          kind: row.kind,
          jobId: row.job_id,
          workerId: row.worker_id,
          label: row.label,
          characterKey: row.character_key || undefined,
          bookTitle: row.book_title,
          leaseAgeMs: duration(row.lease_age_ms)
        })),
        books: runs.rows.map((row) => {
          const card = cardsByRun.get(row.run_id)
          return {
            bookEditionId: row.book_edition_id,
            runId: row.run_id,
            title: row.title,
            author: row.author,
            scope: row.scope,
            pipelineId: row.pipeline_id,
            stage: row.stage,
            status: row.status,
            runSequence: count(row.run_sequence),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            stages: tally(stagesByRun.get(row.run_id) ?? [], 'name'),
            runJobs: tally(runJobsByRun.get(row.run_id) ?? [], 'name'),
            editionJobs: tally(editionJobsByEdition.get(row.book_edition_id) ?? [], 'name'),
            roster: (rosterByRun.get(row.run_id) ?? []).map((entry) => ({
              tier: entry.tier,
              count: count(entry.count)
            })),
            cards: {
              published: count(card?.published),
              lastWindowIndex: card?.last_window == null ? null : count(card.last_window),
              windows: {
                total: count(windowsByRun.get(row.run_id)?.total),
                ready: count(windowsByRun.get(row.run_id)?.ready)
              },
              publications: count(publicationsByRun.get(row.run_id)?.count),
              lastPublishedAt: publicationsByRun.get(row.run_id)?.last_at ?? null
            }
          }
        })
      }
    }
  }
}
