import { createHash } from 'node:crypto'

function stableKey(prefix, parts) {
  const hash = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)
  return `${prefix}:${hash}`
}

function strings(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) =>
    typeof item === 'string' && item.trim()
  ).map((item) => item.trim()))] : []
}

function evidenceRange(evidenceIds, observationsById) {
  const evidence = strings(evidenceIds).map((id) => observationsById.get(id)).filter(Boolean)
  if (!evidence.length) return { startOffset: null, endOffset: null, evidenceIds: [] }
  return {
    startOffset: Math.min(...evidence.map((item) => item.startOffset)),
    endOffset: Math.max(...evidence.map((item) => item.endOffset)),
    evidenceIds: evidence.map((item) => item.id)
  }
}

function graphNode({ key, type, name, range, data = {} }) {
  if (typeof key !== 'string' || !key || typeof name !== 'string' || !name.trim()) return null
  return {
    key,
    type,
    name: name.trim(),
    firstEvidenceOffset: range.startOffset,
    lastEvidenceOffset: range.endOffset,
    data
  }
}

export function buildNarrativeGraph({ markup, observations = [] }) {
  if (!markup || typeof markup !== 'object' || Array.isArray(markup)) {
    throw new TypeError('markup is required')
  }
  const observationsById = new Map(observations.map((item) => [item.id, item]))
  const nodes = []
  const edges = []
  const known = new Set()

  for (const character of Array.isArray(markup.characters) ? markup.characters : []) {
    const offset = Number(character.firstAppearanceTextOffset)
    const range = Number.isSafeInteger(offset) && offset >= 0
      ? { startOffset: offset, endOffset: offset + 1 }
      : { startOffset: null, endOffset: null }
    const node = graphNode({
      key: character.characterKey,
      type: 'character',
      name: character.fullName || character.name,
      range,
      data: { aliases: strings(character.aliases), name: character.name }
    })
    if (node && !known.has(node.key)) {
      known.add(node.key)
      nodes.push(node)
    }
  }

  for (const location of Array.isArray(markup.locations) ? markup.locations : []) {
    const range = evidenceRange(location.evidenceIds, observationsById)
    const node = graphNode({
      key: location.locationKey,
      type: 'location',
      name: location.name,
      range,
      data: { description: location.description, evidenceIds: range.evidenceIds }
    })
    if (node && !known.has(node.key)) {
      known.add(node.key)
      nodes.push(node)
    }
  }

  for (const event of Array.isArray(markup.events) ? markup.events : []) {
    const range = evidenceRange(event.evidenceIds, observationsById)
    const node = graphNode({
      key: event.eventKey,
      type: 'event',
      name: event.title,
      range,
      data: { description: event.description, evidenceIds: range.evidenceIds }
    })
    if (!node || known.has(node.key)) continue
    known.add(node.key)
    nodes.push(node)
    for (const characterKey of strings(event.participantCharacterKeys)) {
      if (!known.has(characterKey)) continue
      edges.push({
        key: stableKey('event-participant', [event.eventKey, characterKey]),
        type: 'event_participant',
        sourceKey: event.eventKey,
        targetKey: characterKey,
        label: 'participant',
        ...range,
        data: {}
      })
    }
    for (const locationKey of strings(event.locationKeys)) {
      if (!known.has(locationKey)) continue
      edges.push({
        key: stableKey('event-location', [event.eventKey, locationKey]),
        type: 'event_location',
        sourceKey: event.eventKey,
        targetKey: locationKey,
        label: 'location',
        ...range,
        data: {}
      })
    }
  }

  for (const relationship of Array.isArray(markup.relationships) ? markup.relationships : []) {
    if (
      !known.has(relationship.sourceCharacterKey) ||
      !known.has(relationship.targetCharacterKey) ||
      relationship.sourceCharacterKey === relationship.targetCharacterKey
    ) continue
    const range = evidenceRange(relationship.evidenceIds, observationsById)
    edges.push({
      key: relationship.relationshipKey || stableKey('relationship', [
        relationship.sourceCharacterKey,
        relationship.targetCharacterKey,
        relationship.description || ''
      ]),
      type: 'relationship',
      sourceKey: relationship.sourceCharacterKey,
      targetKey: relationship.targetCharacterKey,
      label: relationship.description || 'relationship',
      ...range,
      data: {}
    })
  }

  nodes.sort((left, right) =>
    (left.firstEvidenceOffset ?? Number.MAX_SAFE_INTEGER) -
      (right.firstEvidenceOffset ?? Number.MAX_SAFE_INTEGER) ||
    left.key.localeCompare(right.key)
  )
  edges.sort((left, right) =>
    (left.startOffset ?? Number.MAX_SAFE_INTEGER) -
      (right.startOffset ?? Number.MAX_SAFE_INTEGER) ||
    left.key.localeCompare(right.key)
  )
  return { nodes, edges }
}

function boundedSummary(events, maxLength = 2_000) {
  let summary = ''
  for (const event of events) {
    const part = String(event.description || event.title || '').trim()
    if (!part) continue
    const candidate = summary ? `${summary} ${part}` : part
    if (candidate.length > maxLength) break
    summary = candidate
  }
  return summary || 'Сюжетная линия сформирована из связанных событий книги.'
}

export function buildStoryArcs({ markup, observations = [] }) {
  if (!markup || typeof markup !== 'object' || Array.isArray(markup)) {
    throw new TypeError('markup is required')
  }
  const observationsById = new Map(observations.map((item) => [item.id, item]))
  const characterNames = new Map((Array.isArray(markup.characters) ? markup.characters : [])
    .map((character) => [character.characterKey, character.fullName || character.name]))
  const events = (Array.isArray(markup.events) ? markup.events : []).map((event) => ({
    ...event,
    participantCharacterKeys: strings(event.participantCharacterKeys),
    range: evidenceRange(event.evidenceIds, observationsById)
  })).filter((event) => event.eventKey && event.range.startOffset !== null)
    .sort((left, right) =>
      left.range.startOffset - right.range.startOffset ||
      left.eventKey.localeCompare(right.eventKey)
    )
  const parent = events.map((_, index) => index)
  const find = (value) => {
    let current = value
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]]
      current = parent[current]
    }
    return current
  }
  const union = (left, right) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }
  const firstEventByParticipant = new Map()
  events.forEach((event, index) => {
    for (const characterKey of event.participantCharacterKeys) {
      const first = firstEventByParticipant.get(characterKey)
      if (first === undefined) firstEventByParticipant.set(characterKey, index)
      else union(first, index)
    }
  })
  const groups = new Map()
  events.forEach((event, index) => {
    const root = find(index)
    const group = groups.get(root) ?? []
    group.push(event)
    groups.set(root, group)
  })
  return [...groups.values()].map((group) => {
    const participantKeys = [...new Set(group.flatMap((event) =>
      event.participantCharacterKeys
    ))].sort()
    const names = participantKeys.map((key) => characterNames.get(key)).filter(Boolean)
    const evidenceIds = [...new Set(group.flatMap((event) => event.range.evidenceIds))]
    const startOffset = Math.min(...group.map((event) => event.range.startOffset))
    const endOffset = Math.max(...group.map((event) => event.range.endOffset))
    return {
      key: stableKey('story-arc', group.map((event) => event.eventKey).sort()),
      title: names.length ? names.slice(0, 3).join(' — ') : group[0].title,
      summary: boundedSummary(group),
      eventKeys: group.map((event) => event.eventKey),
      participantCharacterKeys: participantKeys,
      startOffset,
      endOffset,
      evidenceIds,
      data: { source: 'deterministic-event-components-v1' }
    }
  }).sort((left, right) => left.startOffset - right.startOffset || left.key.localeCompare(right.key))
}
