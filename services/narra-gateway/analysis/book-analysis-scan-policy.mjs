import { BOOK_ANALYSIS_CHUNK_DEFAULTS } from './book-analysis-chunking.mjs'
import { parseEnvBool, parseEnvInt } from '../platform/env.mjs'

export const BOOK_ANALYSIS_SCAN_POLICY_DEFAULT_PROFILE = 'balanced'

const EMPTY_OBSERVATION_MODES = new Set(['retry', 'confirm_split', 'accept'])
const PROFILE_DEFAULTS = Object.freeze({
  conservative: Object.freeze({
    semanticMaxAttempts: 5,
    emptyObservationMode: 'retry'
  }),
  balanced: Object.freeze({
    semanticMaxAttempts: 1,
    emptyObservationMode: 'confirm_split'
  }),
  fast: Object.freeze({
    semanticMaxAttempts: 1,
    emptyObservationMode: 'accept'
  })
})

const ADAPTIVE_SPLIT_DEFAULTS = Object.freeze({
  enabled: true,
  minCoreChars: 2_000,
  overlapChars: 500
})

function invalid(message) {
  throw new Error(message)
}

function positiveInteger(value, name, maximum = 100_000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    invalid(`${name} must be an integer between 1 and ${maximum}`)
  }
  return value
}

function profileName(value) {
  const profile = String(value || '').trim().toLowerCase()
  if (!Object.hasOwn(PROFILE_DEFAULTS, profile)) {
    invalid('BOOK_ANALYSIS_SCAN_POLICY_PROFILE must be conservative, balanced or fast')
  }
  return profile
}

function emptyObservationMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  if (!EMPTY_OBSERVATION_MODES.has(mode)) {
    invalid('BOOK_ANALYSIS_SCAN_EMPTY_OBSERVATION_MODE must be retry, confirm_split or accept')
  }
  return mode
}

function frozenChunkOptions(raw = {}) {
  const chunk = Object.freeze({
    targetChars: positiveInteger(
      raw.targetChars ?? BOOK_ANALYSIS_CHUNK_DEFAULTS.targetChars,
      'BOOK_ANALYSIS_SCAN_CHUNK_TARGET_CHARS'
    ),
    minChars: positiveInteger(
      raw.minChars ?? BOOK_ANALYSIS_CHUNK_DEFAULTS.minChars,
      'BOOK_ANALYSIS_SCAN_CHUNK_MIN_CHARS'
    ),
    maxChars: positiveInteger(
      raw.maxChars ?? BOOK_ANALYSIS_CHUNK_DEFAULTS.maxChars,
      'BOOK_ANALYSIS_SCAN_CHUNK_MAX_CHARS'
    ),
    overlapChars: positiveInteger(
      raw.overlapChars ?? BOOK_ANALYSIS_CHUNK_DEFAULTS.overlapChars,
      'BOOK_ANALYSIS_SCAN_CHUNK_OVERLAP_CHARS'
    )
  })
  if (chunk.minChars > chunk.targetChars || chunk.targetChars > chunk.maxChars) {
    invalid('scan chunk sizes must satisfy minChars <= targetChars <= maxChars')
  }
  if (chunk.overlapChars >= chunk.minChars) {
    invalid('scan chunk overlapChars must be shorter than minChars')
  }
  return chunk
}

function frozenAdaptiveSplit(raw = {}) {
  const adaptiveSplit = Object.freeze({
    enabled: raw.enabled ?? ADAPTIVE_SPLIT_DEFAULTS.enabled,
    minCoreChars: positiveInteger(
      raw.minCoreChars ?? ADAPTIVE_SPLIT_DEFAULTS.minCoreChars,
      'BOOK_ANALYSIS_SCAN_ADAPTIVE_MIN_CORE_CHARS'
    ),
    overlapChars: positiveInteger(
      raw.overlapChars ?? ADAPTIVE_SPLIT_DEFAULTS.overlapChars,
      'BOOK_ANALYSIS_SCAN_ADAPTIVE_OVERLAP_CHARS'
    )
  })
  if (typeof adaptiveSplit.enabled !== 'boolean') {
    invalid('BOOK_ANALYSIS_SCAN_ADAPTIVE_SPLIT_ENABLED must be true or false')
  }
  if (adaptiveSplit.overlapChars >= adaptiveSplit.minCoreChars) {
    invalid('adaptive split overlapChars must be shorter than minCoreChars')
  }
  return adaptiveSplit
}

export function createBookAnalysisScanPolicy({
  profile = BOOK_ANALYSIS_SCAN_POLICY_DEFAULT_PROFILE,
  semanticMaxAttempts,
  emptyObservationMode: rawEmptyObservationMode,
  chunk,
  adaptiveSplit
} = {}) {
  const normalizedProfile = profileName(profile)
  const defaults = PROFILE_DEFAULTS[normalizedProfile]
  return Object.freeze({
    profile: normalizedProfile,
    semanticMaxAttempts: positiveInteger(
      semanticMaxAttempts ?? defaults.semanticMaxAttempts,
      'BOOK_ANALYSIS_SCAN_SEMANTIC_MAX_ATTEMPTS',
      20
    ),
    emptyObservationMode: emptyObservationMode(
      rawEmptyObservationMode ?? defaults.emptyObservationMode
    ),
    preservePartialResults: true,
    chunk: frozenChunkOptions(chunk),
    adaptiveSplit: frozenAdaptiveSplit(adaptiveSplit)
  })
}

function optionalEnvInt(env, name, fallback, maximum = 100_000) {
  return Object.hasOwn(env, name) && String(env[name]).trim()
    ? parseEnvInt(env, name, fallback, maximum)
    : fallback
}

export function createBookAnalysisScanPolicyFromEnv(env = process.env) {
  const profile = profileName(
    env.BOOK_ANALYSIS_SCAN_POLICY_PROFILE || BOOK_ANALYSIS_SCAN_POLICY_DEFAULT_PROFILE
  )
  const defaults = PROFILE_DEFAULTS[profile]
  return createBookAnalysisScanPolicy({
    profile,
    semanticMaxAttempts: optionalEnvInt(
      env,
      'BOOK_ANALYSIS_SCAN_SEMANTIC_MAX_ATTEMPTS',
      defaults.semanticMaxAttempts,
      20
    ),
    emptyObservationMode: env.BOOK_ANALYSIS_SCAN_EMPTY_OBSERVATION_MODE ||
      defaults.emptyObservationMode,
    chunk: {
      targetChars: optionalEnvInt(
        env,
        'BOOK_ANALYSIS_SCAN_CHUNK_TARGET_CHARS',
        BOOK_ANALYSIS_CHUNK_DEFAULTS.targetChars
      ),
      minChars: optionalEnvInt(
        env,
        'BOOK_ANALYSIS_SCAN_CHUNK_MIN_CHARS',
        BOOK_ANALYSIS_CHUNK_DEFAULTS.minChars
      ),
      maxChars: optionalEnvInt(
        env,
        'BOOK_ANALYSIS_SCAN_CHUNK_MAX_CHARS',
        BOOK_ANALYSIS_CHUNK_DEFAULTS.maxChars
      ),
      overlapChars: optionalEnvInt(
        env,
        'BOOK_ANALYSIS_SCAN_CHUNK_OVERLAP_CHARS',
        BOOK_ANALYSIS_CHUNK_DEFAULTS.overlapChars
      )
    },
    adaptiveSplit: {
      enabled: Object.hasOwn(env, 'BOOK_ANALYSIS_SCAN_ADAPTIVE_SPLIT_ENABLED') &&
        String(env.BOOK_ANALYSIS_SCAN_ADAPTIVE_SPLIT_ENABLED).trim()
        ? parseEnvBool(env, 'BOOK_ANALYSIS_SCAN_ADAPTIVE_SPLIT_ENABLED', true)
        : ADAPTIVE_SPLIT_DEFAULTS.enabled,
      minCoreChars: optionalEnvInt(
        env,
        'BOOK_ANALYSIS_SCAN_ADAPTIVE_MIN_CORE_CHARS',
        ADAPTIVE_SPLIT_DEFAULTS.minCoreChars
      ),
      overlapChars: optionalEnvInt(
        env,
        'BOOK_ANALYSIS_SCAN_ADAPTIVE_OVERLAP_CHARS',
        ADAPTIVE_SPLIT_DEFAULTS.overlapChars
      )
    }
  })
}

export const BOOK_ANALYSIS_SCAN_POLICY_PROFILES = PROFILE_DEFAULTS
export const BOOK_ANALYSIS_ADAPTIVE_SPLIT_DEFAULTS = ADAPTIVE_SPLIT_DEFAULTS
