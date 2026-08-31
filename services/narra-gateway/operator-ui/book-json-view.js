function claimText(value) {
  if (typeof value === 'string') return value.trim()
  return typeof value?.value === 'string' ? value.value.trim() : ''
}

export function extractBookJsonCharacters(value) {
  const candidates = [
    value?.publication?.data?.markup?.characters,
    value?.publication?.data?.characters,
    value?.markup?.characters,
    value?.canonicalMarkupVersions?.[0]?.characters,
    value?.characters
  ]
  const characters = candidates.find(Array.isArray) ?? []
  return characters.map((row) => {
    const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? row.data
      : row
    const combined = { ...row, ...data }
    delete combined.data
    return combined
  })
}

function nonEmptyClaims(value) {
  return Array.isArray(value) ? value.map(claimText).filter(Boolean) : []
}

function timelineReady(character) {
  const first = Number(character.firstAppearanceTextOffset)
  const warmup = Number(character.warmupTextOffset)
  return Number.isSafeInteger(first) && first >= 0 &&
    Number.isSafeInteger(warmup) && warmup >= 0 && warmup <= first
}

function voiceGenderConsistent(character) {
  const gender = claimText(character.gender)
  const voice = String(character.creative?.voice || '').trim()
  if (gender === 'male') return voice === 'She'
  if (gender === 'female') return voice === 'Che' || voice === 'Erm'
  return voice === 'Erm'
}

export function summarizeBookJson(value) {
  const characters = extractBookJsonCharacters(value)
  const count = (predicate) => characters.filter(predicate).length
  const total = characters.length
  const fields = {
    identity: count((character) => Boolean(
      String(character.characterKey || character.entityKey || '').trim() &&
      String(character.fullName || character.name || '').trim()
    )),
    gender: count((character) => Boolean(claimText(character.gender))),
    traits: count((character) => nonEmptyClaims(character.traits).length > 0),
    description: count((character) => Boolean(claimText(character.description))),
    appearance: count((character) => nonEmptyClaims(character.appearance).length > 0),
    speechStyle: count((character) => Boolean(claimText(character.speechStyle))),
    speechExamples: count((character) => nonEmptyClaims(character.speechExamples).length > 0),
    aliases: count((character) => Array.isArray(character.aliases) && character.aliases.length > 0),
    greeting: count((character) => Boolean(String(character.creative?.greeting || '').trim())),
    voice: count((character) => Boolean(String(character.creative?.voice || '').trim())),
    timeline: count(timelineReady),
    voiceGenderConsistency: count(voiceGenderConsistent)
  }
  return {
    total,
    characters,
    fields,
    fractions: Object.fromEntries(Object.entries(fields).map(([name, value]) => [
      name,
      total > 0 ? value / total : 0
    ]))
  }
}

export function profileClaimText(value) {
  return claimText(value)
}

export function profileClaimValues(value) {
  return nonEmptyClaims(value)
}
