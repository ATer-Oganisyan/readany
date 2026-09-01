const BASE_URL = 'http://127.0.0.1:8787/operator/api/books'

const TARGETS = [
  ['narra-ru-9007-geroj-nashego-vremeni', ['рассказчик', 'печорин']],
  ['narra-ru-top100-vishnevyj-sad-018fddcb', ['лопахин', 'трофимов']],
  ['narra-ru-047-pikovaya-dama', ['графин']],
  ['narra-ru-top100-groza-f1a0e505', ['борис']],
  ['narra-ru-top100-dvadcat-tysyach-le-pod-vodoj-f3c0689b', ['рассказчик', 'профессор']],
  ['narra-ru-top100-voskresenie-fccfd322', ['маслов']],
  ['narra-ru-top100-ajvengo-c4f7533a', ['ровен']],
  ['narra-ru-top100-igrok-d71dfce5', ['полин', 'де-гри', 'де гри']],
  ['narra-ru-031-staruha-izergil', ['изергиль']],
  ['narra-ru-top100-dvoryanskoe-gnezdo-71a991f3', ['лаврецк']],
  ['narra-ru-034-zapiski-sumasshedshego', ['аксентий']],
  ['narra-ru-093-ruslan-i-lyudmila', ['голов']]
]

function authHeaders() {
  const username = String(process.env.BOOK_OPERATOR_USERNAME || '')
  const password = String(process.env.BOOK_OPERATOR_PASSWORD || '')
  if (!username || !password) throw new Error('operator credentials are unavailable')
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    accept: 'application/json'
  }
}

async function request(path = '') {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(30_000)
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${path || '/'}: HTTP ${response.status}: ${body?.error || 'request failed'}`)
  return body
}

function claim(value) {
  if (!value) return null
  if (typeof value === 'string') return { value }
  return {
    value: value.value,
    evidenceIds: value.evidenceIds ?? [],
    confidence: value.confidence
  }
}

function claims(values) {
  return (values ?? []).map(claim)
}

function characterSummary(character) {
  const finalSnapshot = character.personalitySnapshots?.at(-1)
  return {
    characterKey: character.characterKey,
    name: character.name,
    fullName: character.fullName,
    aliases: character.aliases ?? [],
    role: claim(character.role),
    description: claim(character.description),
    traits: claims(character.traits),
    finalPersonalitySnapshot: finalSnapshot ? {
      status: finalSnapshot.status,
      cutoffTextOffset: finalSnapshot.cutoffTextOffset,
      traits: claims(finalSnapshot.traits)
    } : null,
    identityEvidenceCount: character.identityEvidenceIds?.length ?? 0,
    firstAppearanceTextOffset: character.firstAppearanceTextOffset,
    warmupTextOffset: character.warmupTextOffset
  }
}

function characterEvidenceIds(character) {
  const ids = new Set((character.identityEvidenceIds ?? []).slice(0, 12))
  for (const field of ['role', 'description', 'age', 'gender', 'speechStyle']) {
    for (const id of character[field]?.evidenceIds ?? []) ids.add(id)
  }
  for (const field of ['traits', 'appearance', 'speechExamples']) {
    for (const item of character[field] ?? []) {
      for (const id of item?.evidenceIds ?? []) ids.add(id)
    }
  }
  const finalSnapshot = character.personalitySnapshots?.at(-1)
  for (const item of finalSnapshot?.traits ?? []) {
    for (const id of item?.evidenceIds ?? []) ids.add(id)
  }
  return ids
}

function matches(character, needles) {
  const haystack = [character.name, character.fullName, ...(character.aliases ?? [])]
    .filter(Boolean)
    .join('\n')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
  return needles.some((needle) => haystack.includes(needle))
}

const onlyCatalogKey = process.argv[2] || null
const includeEvidence = process.argv[3] === 'evidence'
const catalog = await request()
const books = Array.isArray(catalog) ? catalog : catalog.books
const result = []

for (const [catalogKey, needles] of TARGETS) {
  if (onlyCatalogKey && catalogKey !== onlyCatalogKey) continue
  const matchesByKey = books.filter((book) => book.catalogKey === catalogKey)
  if (matchesByKey.length !== 1) {
    result.push({ catalogKey, error: `expected one edition, found ${matchesByKey.length}` })
    continue
  }
  const listed = matchesByKey[0]
  const detail = await request(`/${listed.id}/json`)
  const publication = detail.publication
  const markup = publication?.data?.markup
  if (!publication || !markup) {
    result.push({ catalogKey, book: detail.book, error: 'published markup is unavailable' })
    continue
  }
  const canonicalMarkup = (detail.canonicalMarkupVersions ?? [])
    .find((item) => item.status === 'published') ?? detail.canonicalMarkupVersions?.[0]
  const selected = (markup.characters ?? []).filter((character) => matches(character, needles))
  const evidenceIds = new Set()
  for (const character of selected) {
    for (const id of characterEvidenceIds(character)) evidenceIds.add(id)
  }
  result.push({
    catalogKey,
    book: detail.book,
    base: {
      markupVersionId: publication.data?.markupVersionId ?? canonicalMarkup?.id,
      publicationId: publication.id,
      contentHash: publication.contentHash,
      publishedAt: publication.publishedAt
    },
    characterCount: markup.characters?.length ?? 0,
    characters: selected.map(characterSummary),
    ...(includeEvidence ? {
      evidence: (detail.evidence ?? [])
        .filter((item) => evidenceIds.has(item.id))
        .map((item) => ({
          id: item.id,
          type: item.type,
          entityCandidate: item.entityCandidate,
          fact: item.fact,
          quote: item.quote,
          startOffset: item.startOffset,
          endOffset: item.endOffset,
          confidence: item.confidence
        }))
    } : {})
  })
}

process.stdout.write(`${JSON.stringify({ collectedAt: new Date().toISOString(), books: result }, null, 2)}\n`)
