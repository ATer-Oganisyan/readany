import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBookAnalysisScanPolicy,
  createBookAnalysisScanPolicyFromEnv
} from '../book-analysis-scan-policy.mjs'

test('balanced ScanPolicy is the default and keeps the former chunk boundaries', () => {
  const policy = createBookAnalysisScanPolicy()
  assert.deepEqual(policy, {
    profile: 'balanced',
    semanticMaxAttempts: 1,
    emptyObservationMode: 'confirm_split',
    preservePartialResults: true,
    chunk: {
      targetChars: 4_000,
      minChars: 2_500,
      maxChars: 5_000,
      overlapChars: 500
    },
    adaptiveSplit: {
      enabled: true,
      minCoreChars: 2_000,
      overlapChars: 500
    }
  })
})

test('ScanPolicy profiles expose the intended semantic retry behavior', () => {
  assert.deepEqual(
    createBookAnalysisScanPolicy({ profile: 'conservative' }),
    {
      profile: 'conservative',
      semanticMaxAttempts: 5,
      emptyObservationMode: 'retry',
      preservePartialResults: true,
      chunk: { targetChars: 4_000, minChars: 2_500, maxChars: 5_000, overlapChars: 500 },
      adaptiveSplit: { enabled: true, minCoreChars: 2_000, overlapChars: 500 }
    }
  )
  const fast = createBookAnalysisScanPolicy({ profile: 'fast' })
  assert.equal(fast.semanticMaxAttempts, 1)
  assert.equal(fast.emptyObservationMode, 'accept')
  assert.equal(fast.preservePartialResults, true)

  const conservativeFromComposeDefaults = createBookAnalysisScanPolicyFromEnv({
    BOOK_ANALYSIS_SCAN_POLICY_PROFILE: 'conservative',
    BOOK_ANALYSIS_SCAN_SEMANTIC_MAX_ATTEMPTS: '',
    BOOK_ANALYSIS_SCAN_EMPTY_OBSERVATION_MODE: ''
  })
  assert.equal(conservativeFromComposeDefaults.semanticMaxAttempts, 5)
  assert.equal(conservativeFromComposeDefaults.emptyObservationMode, 'retry')
})

test('ScanPolicy reads explicit environment overrides without making partial preservation optional', () => {
  const policy = createBookAnalysisScanPolicyFromEnv({
    BOOK_ANALYSIS_SCAN_POLICY_PROFILE: 'conservative',
    BOOK_ANALYSIS_SCAN_SEMANTIC_MAX_ATTEMPTS: '3',
    BOOK_ANALYSIS_SCAN_EMPTY_OBSERVATION_MODE: 'confirm_split',
    BOOK_ANALYSIS_SCAN_ADAPTIVE_SPLIT_ENABLED: 'false',
    BOOK_ANALYSIS_SCAN_ADAPTIVE_MIN_CORE_CHARS: '2400',
    BOOK_ANALYSIS_SCAN_ADAPTIVE_OVERLAP_CHARS: '400',
    BOOK_ANALYSIS_SCAN_CHUNK_TARGET_CHARS: '3000',
    BOOK_ANALYSIS_SCAN_CHUNK_MIN_CHARS: '2000',
    BOOK_ANALYSIS_SCAN_CHUNK_MAX_CHARS: '3500',
    BOOK_ANALYSIS_SCAN_CHUNK_OVERLAP_CHARS: '300'
  })
  assert.deepEqual(policy, {
    profile: 'conservative',
    semanticMaxAttempts: 3,
    emptyObservationMode: 'confirm_split',
    preservePartialResults: true,
    chunk: { targetChars: 3_000, minChars: 2_000, maxChars: 3_500, overlapChars: 300 },
    adaptiveSplit: { enabled: false, minCoreChars: 2_400, overlapChars: 400 }
  })
})

test('ScanPolicy rejects unknown profiles and inconsistent chunk sizes', () => {
  assert.throws(
    () => createBookAnalysisScanPolicy({ profile: 'unknown' }),
    /conservative, balanced or fast/
  )
  assert.throws(
    () => createBookAnalysisScanPolicy({ chunk: { minChars: 4_500, targetChars: 4_000 } }),
    /minChars <= targetChars <= maxChars/
  )
})
