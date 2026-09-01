const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/
const SAFE_CAMPAIGN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/
const JOB_TYPES = new Set([
  'book_markup',
  'book_identity',
  'catalog_cover',
  'scene_image',
  'character_bundle',
  'character_portrait',
  'character_audio',
  'character_animation'
])

function usage() {
  const error = new Error(
    'usage: status | pause [--job-type TYPE] [--edition UUID[,UUID]] ' +
    '[--campaign-id ID] [--limit 1..1000] [--reason CODE] [--operator ID] [--execute] | ' +
    'resume --pause-id UUID [--limit 1..1000] [--reason CODE] [--operator ID] [--execute]'
  )
  error.code = 'USAGE'
  return error
}

function positiveLimit(value) {
  const limit = value === undefined ? 100 : Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw usage()
  return limit
}

function values(argv) {
  const result = { execute: false }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--execute') {
      if (result.execute) throw usage()
      result.execute = true
      continue
    }
    if (!key.startsWith('--') || index + 1 >= argv.length) throw usage()
    const name = key.slice(2)
    if (!['job-type', 'edition', 'campaign-id', 'limit', 'reason', 'operator', 'pause-id'].includes(name)) {
      throw usage()
    }
    if (result[name] !== undefined) throw usage()
    result[name] = argv[++index]
  }
  return result
}

function operatorId(value) {
  const result = String(value || 'cli').trim()
  if (!result || result.length > 120 || /[\r\n]/.test(result)) throw usage()
  return result
}

export function parseGenerationQueueCommand(argv) {
  if (!Array.isArray(argv) || argv.length < 1) throw usage()
  const [command, ...rest] = argv
  const input = values(rest)
  if (command === 'status') {
    if (rest.length) throw usage()
    return { command }
  }
  if (command === 'resume') {
    if (!UUID.test(String(input['pause-id'] || ''))) throw usage()
    if (input['job-type'] || input.edition || input['campaign-id']) throw usage()
    const reasonCode = String(input.reason || 'OPERATOR_RESUMED')
    if (!SAFE_CODE.test(reasonCode)) throw usage()
    return {
      command,
      pauseId: input['pause-id'],
      limit: positiveLimit(input.limit),
      reasonCode,
      operatorId: operatorId(input.operator),
      execute: input.execute
    }
  }
  if (command !== 'pause' || input['pause-id']) throw usage()
  const jobType = input['job-type'] ? String(input['job-type']) : undefined
  if (jobType && !JOB_TYPES.has(jobType)) throw usage()
  const bookEditionIds = input.edition
    ? [...new Set(String(input.edition).split(',').map((item) => item.trim()).filter(Boolean))]
    : []
  if (bookEditionIds.some((id) => !UUID.test(id))) throw usage()
  const campaignId = input['campaign-id'] ? String(input['campaign-id']) : undefined
  if (campaignId && !SAFE_CAMPAIGN.test(campaignId)) throw usage()
  if (!jobType && !bookEditionIds.length && !campaignId) throw usage()
  const reasonCode = String(input.reason || 'OPERATOR_PAUSED')
  if (!SAFE_CODE.test(reasonCode)) throw usage()
  return {
    command,
    selector: { jobType, bookEditionIds, campaignId },
    limit: positiveLimit(input.limit),
    reasonCode,
    operatorId: operatorId(input.operator),
    execute: input.execute
  }
}
