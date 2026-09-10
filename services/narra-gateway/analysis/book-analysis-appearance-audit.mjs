export const CHARACTER_APPEARANCE_CLUSTER_CODE = 'CHARACTER_APPEARANCE_CLUSTERED_AT_START'

export const CHARACTER_APPEARANCE_AUDIT_THRESHOLDS = Object.freeze({
  minimumEarlyCharacters: 5,
  minimumEarlyFraction: 0.4,
  initialTextFraction: 0.01,
  maximumInitialTextOffset: 1_000
})

function nonNegativeInteger(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function positiveTextLength(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

function earlyBoundary(textLength) {
  if (!textLength) return 0
  return Math.min(
    CHARACTER_APPEARANCE_AUDIT_THRESHOLDS.maximumInitialTextOffset,
    Math.max(1, Math.ceil(
      textLength * CHARACTER_APPEARANCE_AUDIT_THRESHOLDS.initialTextFraction
    ))
  )
}

export function characterAppearanceAuditFromCounts({
  textLength: rawTextLength,
  characterCount: rawCharacterCount,
  earlyCharacterCount: rawEarlyCharacterCount
}) {
  const textLength = positiveTextLength(rawTextLength)
  const characterCount = nonNegativeInteger(rawCharacterCount)
  const earlyCharacterCount = Math.min(
    characterCount,
    nonNegativeInteger(rawEarlyCharacterCount)
  )
  const earlyCharacterFraction = characterCount ? earlyCharacterCount / characterCount : 0
  const suspicious =
    earlyCharacterCount >= CHARACTER_APPEARANCE_AUDIT_THRESHOLDS.minimumEarlyCharacters &&
    earlyCharacterFraction >= CHARACTER_APPEARANCE_AUDIT_THRESHOLDS.minimumEarlyFraction
  return {
    status: suspicious ? 'suspicious' : 'clear',
    ...(suspicious ? { code: CHARACTER_APPEARANCE_CLUSTER_CODE } : {}),
    textLength,
    characterCount,
    earlyCharacterCount,
    earlyCharacterFraction,
    earlyBoundaryTextOffset: earlyBoundary(textLength),
    thresholds: { ...CHARACTER_APPEARANCE_AUDIT_THRESHOLDS }
  }
}

export function auditCharacterAppearanceDistribution(markup) {
  const textLength = positiveTextLength(markup?.textLength ?? markup?.text_length)
  const characters = Array.isArray(markup?.characters) ? markup.characters : []
  const boundary = earlyBoundary(textLength)
  const earlyCharacterCount = characters.filter((character) => {
    const offset = Number(
      character?.firstAppearanceTextOffset ?? character?.first_appearance_text_offset
    )
    return Number.isSafeInteger(offset) && offset >= 0 && offset <= boundary
  }).length
  return characterAppearanceAuditFromCounts({
    textLength,
    characterCount: characters.length,
    earlyCharacterCount
  })
}
