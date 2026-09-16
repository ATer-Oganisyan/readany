/**
 * Закрытие карточных заданий, которые остались висеть после переноса.
 *
 * Строку задания в готовые переводит тот, кто карточку записал. У переноса в
 * другое окно записывать нечего, и до правки он оставлял исходное задание в
 * `running`: воркер писал в лог «завершено», аренда истекала, задание
 * захватывалось снова, переносилось опять — и так по кругу. Девяносто четыре
 * задания набрали так по 240–375 попыток за шесть дней.
 *
 * Закрываем только те, у которых перенос состоялся: в более позднем окне того
 * же прогона есть задание на того же персонажа, и карточка его уже собрана.
 * Задание без наследника — это не круг, а честно неудавшаяся карточка, и
 * трогать его нельзя.
 *
 * Usage:
 *   node books/close-deferred-card-jobs.mjs [--dry-run] [--limit <n>] [--min-attempts <n>]
 */
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from '../db/postgres-runtime.mjs'

function parseArgs(argv) {
  const options = { dryRun: false, limit: 1_000, minAttempts: 2 }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--dry-run') { options.dryRun = true; continue }
    const value = argv[index + 1]
    if (flag === '--limit' || flag === '--min-attempts') {
      const parsed = Number(value)
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw Object.assign(new Error(`${flag} must be a positive integer`), { code: 'USAGE' })
      }
      if (flag === '--limit') options.limit = parsed
      else options.minAttempts = parsed
      index += 1
      continue
    }
    throw Object.assign(new Error(`unknown argument: ${flag}`), { code: 'USAGE' })
  }
  return options
}

const SELECT_STUCK = `
  SELECT stuck.id, stuck.analysis_run_id, stuck.character_key,
         stuck.card_window_index, stuck.attempts,
         (SELECT min(later.card_window_index) FROM generation_jobs AS later
           WHERE later.analysis_run_id = stuck.analysis_run_id
             AND later.character_key = stuck.character_key
             AND later.job_type = 'character_card'
             AND later.card_window_index > stuck.card_window_index) AS deferred_to_window
    FROM generation_jobs AS stuck
   WHERE stuck.job_type = 'character_card'
     AND stuck.status = 'running'
     AND stuck.attempts >= $1
     AND EXISTS (
       SELECT 1 FROM generation_jobs AS later
        WHERE later.analysis_run_id = stuck.analysis_run_id
          AND later.character_key = stuck.character_key
          AND later.job_type = 'character_card'
          AND later.card_window_index > stuck.card_window_index)
     AND EXISTS (
       SELECT 1 FROM book_character_cards AS card
        WHERE card.run_id = stuck.analysis_run_id
          AND card.character_key = stuck.character_key)
   ORDER BY stuck.attempts DESC
   LIMIT $2`

let pool
try {
  const options = parseArgs(process.argv.slice(2))
  pool = await createPostgresPoolFromEnv(process.env)
  await runBookMarkupMigrations(pool)
  const stuck = await pool.query(SELECT_STUCK, [options.minAttempts, options.limit])
  const closed = []
  for (const row of stuck.rows) {
    if (!options.dryRun) {
      await pool.query(
        `UPDATE generation_jobs
            SET status = 'ready', result = $2::jsonb, last_error_code = NULL,
                locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()
          WHERE id = $1 AND job_type = 'character_card' AND status = 'running'`,
        [row.id, JSON.stringify({
          character_key: row.character_key,
          deferred_from_window: Number(row.card_window_index),
          deferred_to_window: Number(row.deferred_to_window),
          closed_by: 'close-deferred-card-jobs'
        })]
      )
    }
    closed.push({
      jobId: row.id,
      runId: row.analysis_run_id,
      characterKey: row.character_key,
      fromWindow: Number(row.card_window_index),
      toWindow: Number(row.deferred_to_window),
      attempts: Number(row.attempts)
    })
  }
  console.log(JSON.stringify({
    ok: true, dryRun: options.dryRun, closedCount: closed.length, closed
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false, error: { code: error?.code ?? 'ERROR', message: error?.message ?? String(error) }
  }, null, 2))
  process.exitCode = 1
} finally {
  await pool?.end()
}
