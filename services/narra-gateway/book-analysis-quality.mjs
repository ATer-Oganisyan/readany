const COVERAGE_BAND_CHARS = 4_000
const REQUIRED_BAND_FRACTION = 0.75
const FRONT_MATTER_MAX_OFFSET = 1_024

function qualityInputError(message) {
  return Object.assign(new TypeError(message), { code: 'ANALYSIS_QUALITY_INPUT_INVALID' })
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Rejects internally consistent but obviously incomplete book analysis.
 *
 * Evidence is expected in most fixed-size bands of a fiction book. This does
 * not try to prove semantic completeness; it catches the concrete failure mode
 * where a model reads only the beginning of a large prompt. Narra also needs at
 * least one confirmed character before a result is useful to the reader.
 */
export function assessBookAnalysisCoverage({
  textLength,
  observations,
  entities,
  author = '',
  requireTextCoverage = true
}) {
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
  const observationsById = new Map(observations.map((observation) => [observation?.id, observation]))
  const normalizedAuthor = normalizedName(author)
  const confirmedCharacters = entities.filter((entity) =>
    entity?.entityKind === 'character' && entity?.resolutionStatus === 'confirmed'
  )
  const metadataCharacters = confirmedCharacters.filter((entity) => {
    if (!normalizedAuthor) return false
    const names = [entity?.canonicalName, ...(entity?.aliases ?? [])].map(normalizedName)
    if (!names.includes(normalizedAuthor)) return false
    const evidence = (entity?.evidenceIds ?? []).map((id) => observationsById.get(id)).filter(Boolean)
    return evidence.length > 0 && evidence.every((observation) =>
      observation?.evidence?.startOffset < FRONT_MATTER_MAX_OFFSET &&
      normalizedName(observation?.evidence?.quote) === normalizedAuthor
    )
  })
  const metadataCharacterSet = new Set(metadataCharacters)
  const productCharacters = confirmedCharacters.filter((entity) => !metadataCharacterSet.has(entity))
  const confirmedCharacterCount = productCharacters.length
  const resolvedCharacterNames = new Set(entities
    .filter((entity) => entity?.entityKind === 'character')
    .flatMap((entity) => [
      entity?.canonicalName,
      ...(entity?.aliases ?? []),
      ...(entity?.data?.candidateKeys ?? [])
    ])
    .map(normalizedName)
    .filter(Boolean)
  )
  const missingRelationshipCharacters = [...new Set(observations
    .filter((observation) => observation?.type === 'relationship')
    .flatMap((observation) => observation?.relatedEntityCandidates ?? [])
    .filter((candidate) => {
      const normalized = normalizedName(candidate)
      return normalized && !resolvedCharacterNames.has(normalized)
    })
    .map((candidate) => String(candidate).trim()))].sort((left, right) =>
      left.localeCompare(right, 'ru')
    )
  const errorCodes = []
  if (requireTextCoverage && coveredBands.size < requiredBandCount) {
    errorCodes.push('ANALYSIS_TEXT_COVERAGE_INCOMPLETE')
  }
  if (confirmedCharacterCount === 0) {
    errorCodes.push('ANALYSIS_CHARACTERS_MISSING')
  }
  if (metadataCharacters.length) {
    errorCodes.push('ANALYSIS_METADATA_CHARACTER')
  }
  return {
    valid: errorCodes.length === 0,
    errorCodes,
    bandChars: COVERAGE_BAND_CHARS,
    bandCount,
    coveredBandCount: coveredBands.size,
    requiredBandCount,
    confirmedCharacterCount,
    metadataCharacterCount: metadataCharacters.length,
    missingRelationshipCharacters
  }
}
