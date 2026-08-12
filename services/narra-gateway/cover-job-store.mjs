import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const FORMAT_VERSION = 1
const JOB_FILE_LIMIT = 32 * 1024
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUEST_ID = UUID_V4
const JOB_ID = UUID_V4
const INSTALLATION_ID = UUID_V4
const TERMINAL = new Set(['completed', 'failed'])
const RUNNABLE = new Set(['queued', 'retry_wait'])
const STATUSES = new Set([...RUNNABLE, 'running', ...TERMINAL])
const RESULT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function jobError(code, message, status = 500) {
  return Object.assign(new Error(message), { code, status })
}

function promptHash(prompt) {
  return createHash('sha256').update(prompt).digest('hex')
}

function metadata(job) {
  return structuredClone(job)
}

function assertJob(candidate) {
  if (
    !candidate ||
    candidate.version !== FORMAT_VERSION ||
    !JOB_ID.test(candidate.job_id || '') ||
    !INSTALLATION_ID.test(candidate.installation_id || '') ||
    !REQUEST_ID.test(candidate.request_id || '') ||
    !/^[a-f0-9]{64}$/.test(candidate.prompt_hash || '') ||
    !STATUSES.has(candidate.status) ||
    !Number.isSafeInteger(candidate.attempt_count) ||
    candidate.attempt_count < 0 ||
    !Number.isSafeInteger(candidate.next_attempt_at) ||
    !Number.isSafeInteger(candidate.created_at) ||
    !Number.isSafeInteger(candidate.updated_at) ||
    !Number.isSafeInteger(candidate.expires_at)
  ) {
    throw new Error('cover job has an unsupported or corrupt format')
  }
  if (
    !TERMINAL.has(candidate.status) &&
    (typeof candidate.prompt !== 'string' || candidate.prompt.length < 1 || candidate.prompt.length > 8_000)
  ) {
    throw new Error('non-terminal cover job has no prompt')
  }
  if (TERMINAL.has(candidate.status) && Object.hasOwn(candidate, 'prompt')) {
    throw new Error('terminal cover job retained its prompt')
  }
  if (candidate.status === 'completed') {
    if (
      !RESULT_MIME_TYPES.has(candidate.mime_type) ||
      candidate.result_file !== `${candidate.job_id}.${extensionFor(candidate.mime_type)}`
    ) {
      throw new Error('completed cover job has invalid result metadata')
    }
  } else if (candidate.result_file !== null) {
    throw new Error('unfinished cover job unexpectedly references a result')
  }
  return candidate
}

function extensionFor(mimeType) {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  return 'jpg'
}

export function createCoverJobStore({
  dataDir,
  environment = 'production',
  maxJobs = 1_000,
  resultTtlMs = 24 * 60 * 60 * 1000,
  maxResultBytes = 16 * 1024 * 1024,
  now = () => Date.now()
}) {
  const root = path.join(dataDir, `cover-jobs-${environment}`)
  const jobsDir = path.join(root, 'jobs')
  const resultsDir = path.join(root, 'results')
  const quarantineDir = path.join(root, 'quarantine')
  const jobs = new Map()
  const requestIndex = new Map()
  let chain = Promise.resolve()
  let initialized = false
  let storageVerified = false

  function serial(operation) {
    const pending = chain.then(operation, operation)
    chain = pending.catch(() => {})
    return pending
  }

  function requireStarted() {
    if (!initialized) throw new Error('cover job store is not initialized')
  }

  function jobPath(jobId) {
    return path.join(jobsDir, `${jobId}.json`)
  }

  function resultPath(jobId, mimeType) {
    return path.join(resultsDir, `${jobId}.${extensionFor(mimeType)}`)
  }

  function requestKey(installationId, requestId) {
    return `${installationId}:${requestId}`
  }

  async function persist(job) {
    const target = jobPath(job.job_id)
    const temporary = `${target}.${randomUUID()}.tmp`
    const payload = `${JSON.stringify(job)}\n`
    if (Buffer.byteLength(payload) > JOB_FILE_LIMIT) {
      throw jobError('VALIDATION', 'Cover job metadata is too large', 400)
    }
    try {
      await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
  }

  async function removeFiles(job) {
    await unlink(jobPath(job.job_id)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
    if (job.result_file) {
      await unlink(path.join(resultsDir, path.basename(job.result_file))).catch((error) => {
        if (error?.code !== 'ENOENT') throw error
      })
    }
  }

  async function removeJob(job) {
    await removeFiles(job)
    jobs.delete(job.job_id)
    requestIndex.delete(requestKey(job.installation_id, job.request_id))
  }

  async function removeExpired(timestamp) {
    for (const job of [...jobs.values()]) {
      if (job.expires_at <= timestamp) await removeJob(job)
    }
  }

  async function removeOrphanResults() {
    const referenced = new Set(
      [...jobs.values()].map((job) => job.result_file).filter(Boolean)
    )
    for (const name of await readdir(resultsDir)) {
      if (!referenced.has(name)) await unlink(path.join(resultsDir, name))
    }
  }

  async function quarantine(file, error) {
    const suffix = `${Date.now()}-${randomUUID()}`
    const target = path.join(quarantineDir, `${path.basename(file)}.${suffix}.bad`)
    await rename(file, target).catch(() => {})
    console.error('[cover-jobs] quarantined corrupt job:', path.basename(file), error?.message || error)
  }

  async function verifyStorage() {
    const id = randomUUID()
    const temporary = path.join(root, `.storage-${id}.tmp`)
    const committed = path.join(root, `.storage-${id}.ok`)
    await writeFile(temporary, id, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, committed)
    if ((await readFile(committed, 'utf8')) !== id) throw new Error('cover job storage verification failed')
    await unlink(committed)
    storageVerified = true
  }

  async function start() {
    await serial(async () => {
      await Promise.all([
        mkdir(jobsDir, { recursive: true, mode: 0o700 }),
        mkdir(resultsDir, { recursive: true, mode: 0o700 }),
        mkdir(quarantineDir, { recursive: true, mode: 0o700 })
      ])
      await verifyStorage()
      jobs.clear()
      requestIndex.clear()
      const timestamp = now()
      for (const name of await readdir(jobsDir)) {
        if (!name.endsWith('.json')) continue
        const file = path.join(jobsDir, name)
        try {
          const raw = await readFile(file, 'utf8')
          if (Buffer.byteLength(raw) > JOB_FILE_LIMIT) throw new Error('cover job metadata exceeds limit')
          const job = assertJob(JSON.parse(raw))
          if (job.expires_at <= timestamp) {
            await removeFiles(job)
            continue
          }
          if (job.status === 'running') {
            const recovered = {
              ...job,
              status: 'queued',
              next_attempt_at: timestamp,
              updated_at: timestamp,
              error_code: 'CANCELLED',
              error_message: 'Gateway restarted while the job was running'
            }
            await persist(recovered)
            Object.assign(job, recovered)
          }
          if (job.status === 'completed') {
            const result = await stat(path.join(resultsDir, job.result_file))
            if (result.size < 1 || result.size > maxResultBytes) {
              throw new Error('completed cover job result has an invalid size')
            }
          }
          const key = requestKey(job.installation_id, job.request_id)
          if (requestIndex.has(key)) throw new Error('duplicate cover job request id')
          jobs.set(job.job_id, job)
          requestIndex.set(key, job.job_id)
        } catch (error) {
          await quarantine(file, error)
        }
      }
      await removeOrphanResults()
      initialized = true
    })
  }

  async function cleanupExpired() {
    return serial(async () => {
      requireStarted()
      await removeExpired(now())
    })
  }

  async function createOrGet({ installationId, requestId, prompt, beforeCreate = async () => {} }) {
    return serial(async () => {
      requireStarted()
      if (!REQUEST_ID.test(requestId || '')) {
        throw jobError('VALIDATION', 'request_id: недопустимое значение', 400)
      }
      if (!INSTALLATION_ID.test(installationId || '')) {
        throw jobError('VALIDATION', 'installation_id: недопустимое значение', 400)
      }
      if (typeof prompt !== 'string' || prompt.length < 1 || prompt.length > 8_000) {
        throw jobError('VALIDATION', 'prompt: строка длиной 1–8000', 400)
      }
      await removeExpired(now())
      const hash = promptHash(prompt)
      const key = requestKey(installationId, requestId)
      const existingId = requestIndex.get(key)
      const existing = existingId ? jobs.get(existingId) : undefined
      if (existing) {
        if (existing.prompt_hash !== hash) {
          throw jobError('CONFLICT', 'request_id уже используется для другой обложки', 409)
        }
        return { created: false, job: metadata(existing) }
      }
      if (jobs.size >= maxJobs) {
        throw jobError('RATE', 'Очередь обложек заполнена', 429)
      }
      await beforeCreate()
      const timestamp = now()
      const job = {
        version: FORMAT_VERSION,
        job_id: randomUUID(),
        installation_id: installationId,
        request_id: requestId,
        prompt_hash: hash,
        prompt,
        status: 'queued',
        attempt_count: 0,
        next_attempt_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
        expires_at: timestamp + resultTtlMs,
        model: null,
        mime_type: null,
        result_file: null,
        error_code: null,
        error_message: null
      }
      await persist(job)
      jobs.set(job.job_id, job)
      requestIndex.set(key, job.job_id)
      return { created: true, job: metadata(job) }
    })
  }

  async function claimNext() {
    return serial(async () => {
      requireStarted()
      const timestamp = now()
      await removeExpired(timestamp)
      const job = [...jobs.values()]
        .filter((candidate) => RUNNABLE.has(candidate.status) && candidate.next_attempt_at <= timestamp)
        .sort((left, right) => left.next_attempt_at - right.next_attempt_at || left.created_at - right.created_at)[0]
      if (!job) return null
      const candidate = {
        ...job,
        status: 'running',
        attempt_count: job.attempt_count + 1,
        updated_at: timestamp,
        error_code: null,
        error_message: null
      }
      await persist(candidate)
      jobs.set(candidate.job_id, candidate)
      return metadata(candidate)
    })
  }

  async function markRetry(jobId, { code, message, nextAttemptAt }) {
    return serial(async () => {
      requireStarted()
      const job = jobs.get(jobId)
      if (!job || job.status !== 'running') return null
      if (!Number.isSafeInteger(nextAttemptAt)) {
        throw jobError('VALIDATION', 'next_attempt_at: недопустимое значение', 400)
      }
      const candidate = {
        ...job,
        status: 'retry_wait',
        next_attempt_at: nextAttemptAt,
        updated_at: now(),
        error_code: code,
        error_message: String(message || '').slice(0, 240)
      }
      await persist(candidate)
      jobs.set(candidate.job_id, candidate)
      return metadata(candidate)
    })
  }

  async function markFailed(jobId, { code, message }) {
    return serial(async () => {
      requireStarted()
      const job = jobs.get(jobId)
      if (!job || TERMINAL.has(job.status)) return job ? metadata(job) : null
      const timestamp = now()
      const candidate = {
        ...job,
        status: 'failed',
        updated_at: timestamp,
        expires_at: timestamp + resultTtlMs,
        result_file: null,
        error_code: code,
        error_message: String(message || '').slice(0, 240)
      }
      delete candidate.prompt
      await persist(candidate)
      jobs.set(candidate.job_id, candidate)
      return metadata(candidate)
    })
  }

  async function markCompleted(jobId, { image, mimeType = 'image/jpeg', model = null }) {
    return serial(async () => {
      requireStarted()
      const job = jobs.get(jobId)
      if (!job || job.status !== 'running') return null
      const bytes = Buffer.isBuffer(image) ? image : Buffer.from(image)
      if (bytes.length < 1 || bytes.length > maxResultBytes) {
        throw jobError('PARSE', 'Generated cover has an invalid size', 502)
      }
      if (!RESULT_MIME_TYPES.has(mimeType)) {
        throw jobError('PARSE', 'Generated cover has an unsupported MIME type', 502)
      }
      const target = resultPath(jobId, mimeType)
      const temporary = `${target}.${randomUUID()}.tmp`
      const timestamp = now()
      const candidate = {
        ...job,
        status: 'completed',
        updated_at: timestamp,
        expires_at: timestamp + resultTtlMs,
        mime_type: mimeType,
        model,
        result_file: path.basename(target),
        error_code: null,
        error_message: null
      }
      delete candidate.prompt
      try {
        await writeFile(temporary, bytes, { mode: 0o600 })
        await rename(temporary, target)
        await persist(candidate)
      } catch (error) {
        await Promise.all([
          unlink(temporary).catch(() => {}),
          unlink(target).catch(() => {})
        ])
        throw error
      }
      jobs.set(candidate.job_id, candidate)
      return metadata(candidate)
    })
  }

  function getForInstallation(jobId, installationId) {
    requireStarted()
    const job = jobs.get(jobId)
    if (!job || job.installation_id !== installationId) return null
    return metadata(job)
  }

  async function readResult(job) {
    requireStarted()
    const current = jobs.get(job?.job_id)
    if (
      !current ||
      current.status !== 'completed' ||
      !current.result_file ||
      current.result_file !== job.result_file ||
      current.installation_id !== job.installation_id
    ) return null
    const bytes = await readFile(path.join(resultsDir, current.result_file))
    if (bytes.length > maxResultBytes) throw new Error('cover job result exceeds limit')
    return bytes
  }

  async function acknowledge(jobId, installationId) {
    return serial(async () => {
      requireStarted()
      const job = jobs.get(jobId)
      if (!job || job.installation_id !== installationId) return false
      if (!TERMINAL.has(job.status)) {
        throw jobError('CONFLICT', 'Задача обложки ещё не завершена', 409)
      }
      await removeJob(job)
      return true
    })
  }

  function nextRunnableAt() {
    requireStarted()
    let next = null
    for (const job of jobs.values()) {
      if (!RUNNABLE.has(job.status)) continue
      next = next === null ? job.next_attempt_at : Math.min(next, job.next_attempt_at)
    }
    return next
  }

  function status() {
    requireStarted()
    const counts = { queued: 0, retry_wait: 0, running: 0, completed: 0, failed: 0 }
    for (const job of jobs.values()) counts[job.status] += 1
    return { persistent: true, storage_verified: storageVerified, total: jobs.size, ...counts }
  }

  async function stop() {
    await chain
  }

  return {
    start,
    stop,
    cleanupExpired,
    createOrGet,
    claimNext,
    markRetry,
    markFailed,
    markCompleted,
    getForInstallation,
    readResult,
    acknowledge,
    nextRunnableAt,
    status
  }
}
