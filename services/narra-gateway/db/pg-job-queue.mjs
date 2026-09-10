/**
 * Общая механика durable-очередей на PostgreSQL.
 *
 * Все четыре очереди gateway (book_analysis_jobs, generation_jobs,
 * book_search_jobs, book_tts_markup_jobs) держат один и тот же контракт:
 * строка со статусом, счётчиком попыток и арендой, которую забирают через
 * `FOR UPDATE SKIP LOCKED`. Отличаются они доменными предикатами и именами
 * колонок, а не самой механикой. Здесь описана механика; доменный SQL
 * остаётся в репозиториях, потому что он несёт бизнес-правила.
 */

export const DEFAULT_JOB_COLUMNS = Object.freeze({
  id: 'id',
  status: 'status',
  attempts: 'attempts',
  // null — у очереди нет потолка попыток в момент захвата.
  maxAttempts: 'max_attempts',
  // null — очередь не приоритизирует задания.
  priority: 'priority',
  // null — задание в статусе queued доступно всегда.
  availableAt: 'available_at',
  // null — очередь не хранит момент захвата отдельно от срока аренды.
  lockedAt: 'locked_at',
  lockedBy: 'locked_by',
  leaseToken: 'lease_token',
  // null — срок аренды вычисляется от lockedAt, отдельной колонки нет.
  leaseExpiresAt: 'lease_expires_at',
  errorCode: 'last_error_code',
  updatedAt: 'updated_at'
})

export function jobQueueColumns(overrides = {}) {
  const unknown = Object.keys(overrides).filter((key) => !(key in DEFAULT_JOB_COLUMNS))
  if (unknown.length) throw new TypeError(`unknown job column: ${unknown.join(', ')}`)
  const columns = { ...DEFAULT_JOB_COLUMNS, ...overrides }
  for (const required of ['id', 'status', 'attempts', 'lockedBy', 'leaseToken', 'updatedAt']) {
    if (!columns[required]) throw new TypeError(`${required} column is required`)
  }
  // Срок аренды должен быть выразим: либо своей колонкой, либо lockedAt + длительность.
  if (!columns.leaseExpiresAt && !columns.lockedAt) {
    throw new TypeError('a queue needs either a leaseExpiresAt or a lockedAt column')
  }
  return Object.freeze(columns)
}

export function assertLeaseSeconds(value, { max = 3_600, min = 1 } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`leaseSeconds must be an integer between ${min} and ${max}`)
  }
  return value
}

function qualify(alias, column) {
  return alias ? `${alias}.${column}` : column
}

/**
 * SQL-выражение «срок аренды истёк». Очереди без колонки leaseExpiresAt
 * считают его от lockedAt и длительности аренды.
 */
export function leaseExpiredSql({ alias = 'job', columns = DEFAULT_JOB_COLUMNS, leaseSeconds }) {
  if (columns.leaseExpiresAt) return `${qualify(alias, columns.leaseExpiresAt)} <= now()`
  if (!columns.lockedAt) throw new TypeError('the queue can not express a lease expiry')
  if (!leaseSeconds) {
    throw new TypeError('leaseSeconds placeholder is required when the queue has no leaseExpiresAt column')
  }
  return `${qualify(alias, columns.lockedAt)} < now() - make_interval(secs => ${leaseSeconds})`
}

/**
 * Предикат «задание можно взять»: новое и уже доступное, либо брошенное
 * с истёкшей арендой, и попытки ещё не исчерпаны.
 */
export function claimableSql({ alias = 'job', columns = DEFAULT_JOB_COLUMNS, leaseSeconds }) {
  const status = qualify(alias, columns.status)
  const clauses = []
  if (columns.maxAttempts) {
    clauses.push(`${qualify(alias, columns.attempts)} < ${qualify(alias, columns.maxAttempts)}`)
  }
  const queued = columns.availableAt
    ? `(${status} = 'queued' AND ${qualify(alias, columns.availableAt)} <= now())`
    : `${status} = 'queued'`
  const abandoned = `(${status} = 'running' AND ${leaseExpiredSql({ alias, columns, leaseSeconds })})`
  clauses.push(`(${queued} OR ${abandoned})`)
  return clauses.join(' AND ')
}

/**
 * Порядок выдачи по умолчанию: приоритет, затем возраст. Репозиторий может
 * добавить свои выражения справедливости перед хвостом.
 */
export function claimOrderSql({ alias = 'job', columns = DEFAULT_JOB_COLUMNS, before = [] } = {}) {
  const parts = []
  if (columns.priority) parts.push(`${qualify(alias, columns.priority)} DESC`)
  parts.push(...before)
  if (columns.availableAt) parts.push(qualify(alias, columns.availableAt))
  parts.push(`${qualify(alias, 'created_at')}`)
  return parts.join(', ')
}

/**
 * SET-клауза захвата: перевод в running, инкремент попыток и запись аренды.
 */
export function leaseAssignmentSql({
  columns = DEFAULT_JOB_COLUMNS,
  lockedBy,
  leaseToken,
  leaseSeconds,
  clearErrorCode = false
}) {
  const parts = [
    `${columns.status} = 'running'`,
    `${columns.attempts} = ${columns.attempts} + 1`,
    ...(columns.lockedAt ? [`${columns.lockedAt} = now()`] : []),
    `${columns.lockedBy} = ${lockedBy}`,
    `${columns.leaseToken} = ${leaseToken}::uuid`
  ]
  if (columns.leaseExpiresAt) {
    parts.push(`${columns.leaseExpiresAt} = now() + make_interval(secs => ${leaseSeconds})`)
  }
  if (clearErrorCode && columns.errorCode) parts.push(`${columns.errorCode} = NULL`)
  parts.push(`${columns.updatedAt} = now()`)
  return parts.join(', ')
}

/**
 * Полный запрос захвата. `select`, `from` и `where` несут доменную часть;
 * механика аренды и SKIP LOCKED добавляются здесь.
 */
export function claimJobSql({
  table,
  alias = 'job',
  columns = DEFAULT_JOB_COLUMNS,
  select = [],
  from = '',
  where = [],
  orderBy,
  lockedBy,
  leaseToken,
  leaseSeconds,
  clearErrorCode = false,
  returning = `${alias}.*`
}) {
  if (!table) throw new TypeError('table is required')
  const candidateColumns = [qualify(alias, columns.id), ...select].join(', ')
  const predicates = [...where, claimableSql({ alias, columns, leaseSeconds })].filter(Boolean)
  // FOR UPDATE OF нужен только когда в кандидате участвует больше одной таблицы.
  const lockTarget = from ? ` OF ${alias}` : ''
  return `WITH candidate AS (
           SELECT ${candidateColumns}
           FROM ${table} AS ${alias}${from ? `\n           ${from}` : ''}
           WHERE ${predicates.join('\n             AND ')}
           ORDER BY ${orderBy ?? claimOrderSql({ alias, columns })}
           FOR UPDATE${lockTarget} SKIP LOCKED
           LIMIT 1
         )
         UPDATE ${table} AS ${alias}
         SET ${leaseAssignmentSql({ columns, lockedBy, leaseToken, leaseSeconds, clearErrorCode })}
         FROM candidate
         WHERE ${qualify(alias, columns.id)} = candidate.${columns.id}
         RETURNING ${returning}`
}

/**
 * Продление аренды. Владение подтверждается lease_token, поэтому воркер,
 * потерявший аренду, не может перезаписать чужую работу.
 */
export function renewLeaseSql({ table, columns = DEFAULT_JOB_COLUMNS, id, leaseToken, leaseSeconds }) {
  const parts = columns.lockedAt ? [`${columns.lockedAt} = now()`] : []
  if (columns.leaseExpiresAt) {
    parts.push(`${columns.leaseExpiresAt} = now() + make_interval(secs => ${leaseSeconds})`)
  }
  parts.push(`${columns.updatedAt} = now()`)
  return `UPDATE ${table}
         SET ${parts.join(', ')}
         WHERE ${columns.id} = ${id} AND ${columns.status} = 'running'
           AND ${columns.leaseToken} = ${leaseToken}::uuid
         RETURNING ${columns.id}`
}

/**
 * Снятие заданий, которые исчерпали попытки и потеряли аренду. Возвращает
 * строки, чтобы вызывающий репозиторий обновил свой rollup (run, index...).
 */
export function expireExhaustedLeasesSql({
  table,
  alias = 'job',
  columns = DEFAULT_JOB_COLUMNS,
  from = '',
  where = [],
  errorCode = 'LEASE_EXPIRED',
  leaseSeconds,
  returning
}) {
  const parts = [
    `${columns.status} = 'failed'`,
    `${columns.errorCode} = '${errorCode}'`,
    ...(columns.lockedAt ? [`${columns.lockedAt} = NULL`] : []),
    `${columns.lockedBy} = NULL`,
    `${columns.leaseToken} = NULL`
  ]
  if (columns.leaseExpiresAt) parts.push(`${columns.leaseExpiresAt} = NULL`)
  parts.push(`${columns.updatedAt} = now()`)
  const predicates = [
    ...where,
    `${qualify(alias, columns.status)} = 'running'`,
    leaseExpiredSql({ alias, columns, leaseSeconds }),
    columns.maxAttempts
      ? `${qualify(alias, columns.attempts)} >= ${qualify(alias, columns.maxAttempts)}`
      : null
  ].filter(Boolean)
  return `UPDATE ${table} AS ${alias}
         SET ${parts.join(', ')}
         ${from}
         WHERE ${predicates.join('\n             AND ')}
         RETURNING ${returning}`
}
