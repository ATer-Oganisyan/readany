const COVERAGE_BAND_CHARS = 4_000
const REQUIRED_BAND_FRACTION = 0.75

function qualityInputError(message) {
  return Object.assign(new TypeError(message), { code: 'ANALYSIS_QUALITY_INPUT_INVALID' })
}

/**
 * Rejects internally consistent but obviously incomplete book analysis.
 *
 * Evidence is expected in most fixed-size bands of a fiction book. This does
 * not try to prove semantic completeness; it catches the concrete failure mode
 * where a model reads only the beginning of a large prompt. Narra also needs at
 * least one confirmed character before a result is useful to the reader.
 */
export function assessBookAnalysisCoverage({ textLength, observations, entities }) {
  if (!Number.isSafeInteger(textLength) || textLength < 1) {
    throw qualityInputError('textLength must be a positive safe integer')
  }
  if (!Array.isArray(observations)) throw qualityInputError('observations must be an array')
  if (!Array.isArray(entities)) throw qualityInputError('entities must be an array')

  const bandCount = Math.max(1, Math.ceil(textLength / COVERAGE_BAND_CHARS))
  const requiredBandCount = Math.max(1, Math.ceil(bandCount * REQUIRED_BAND_FRACTION))
  const coveredBands = new Set()
  for (const observation of observations) {
    const startOffset = observation?.evidence?.startOffset
    if (!Number.isSafeInteger(startOffset) || startOffset < 0 || startOffset >= textLength) continue
    coveredBands.add(Math.min(bandCount - 1, Math.floor(startOffset / COVERAGE_BAND_CHARS)))
  }
  const confirmedCharacterCount = entities.filter((entity) =>
    entity?.entityKind === 'character' && entity?.resolutionStatus === 'confirmed'
  ).length
  const errorCodes = []
  if (coveredBands.size < requiredBandCount) {
    errorCodes.push('ANALYSIS_TEXT_COVERAGE_INCOMPLETE')
  }
  if (confirmedCharacterCount === 0) {
    errorCodes.push('ANALYSIS_CHARACTERS_MISSING')
  }
  return {
    valid: errorCodes.length === 0,
    errorCodes,
    bandChars: COVERAGE_BAND_CHARS,
    bandCount,
    coveredBandCount: coveredBands.size,
    requiredBandCount,
    confirmedCharacterCount
  }
}
