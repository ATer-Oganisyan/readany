const WORD = /[\p{L}\p{M}\p{N}]+/gu

function normalizedText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('und')
}

function tokens(value) {
  return [...new Set((normalizedText(value).match(WORD) ?? []).filter((word) => word.length > 1))]
}

function stringValues(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : []
}

function searchableValues(item, kind) {
  if (kind === 'node') {
    return [
      item.name,
      item.data?.name,
      item.data?.description,
      ...stringValues(item.data?.aliases)
    ]
  }
  if (kind === 'edge') return [item.label, item.data?.description]
  return [item.title, item.summary]
}

function queryAffinity(query, queryTokens, values) {
  const normalizedQuery = normalizedText(query)
  let score = 0
  for (const value of values) {
    const normalized = normalizedText(value).trim()
    if (!normalized) continue
    const valueTokens = tokens(normalized)
    if (normalized.length > 1 && normalizedQuery.includes(normalized)) {
      score = Math.max(score, 12 + Math.min(4, valueTokens.length))
    }
    const overlap = valueTokens.filter((token) => queryTokens.has(token)).length
    if (overlap) score = Math.max(score, overlap * 3 + overlap / valueTokens.length)
  }
  return score
}

function rangeOf(item) {
  const start = item.startOffset ?? item.firstEvidenceOffset
  const end = item.endOffset ?? item.lastEvidenceOffset
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start
    ? { start, end }
    : null
}

function rangeAffinity(item, seedRanges) {
  const range = rangeOf(item)
  if (!range) return 0
  let nearest = Number.POSITIVE_INFINITY
  for (const seed of seedRanges) {
    if (!Number.isSafeInteger(seed.startOffset) || !Number.isSafeInteger(seed.endOffset)) continue
    if (range.start < seed.endOffset && range.end > seed.startOffset) return 8
    const distance = range.end <= seed.startOffset
      ? seed.startOffset - range.end
      : range.start - seed.endOffset
    nearest = Math.min(nearest, distance)
  }
  return Number.isFinite(nearest) && nearest <= 8_000 ? Math.max(0.5, 4 - nearest / 2_000) : 0
}

function scored(item, kind, query, queryTokens, seedRanges) {
  const textScore = queryAffinity(query, queryTokens, searchableValues(item, kind))
  const evidenceScore = rangeAffinity(item, seedRanges)
  const matchedBy = []
  if (textScore) matchedBy.push(kind === 'node' ? 'entity_text' : `${kind}_text`)
  if (evidenceScore) matchedBy.push('text_evidence')
  return { item, score: textScore + evidenceScore, matchedBy: new Set(matchedBy), depth: null }
}

function roundScore(value) {
  return Number(value.toFixed(6))
}

function publicScore(record) {
  return {
    ...record.item,
    score: roundScore(record.score),
    matchedBy: [...record.matchedBy].sort(),
    graphDistance: record.depth
  }
}

function compareRecords(left, right) {
  return right.score - left.score || String(left.item.key).localeCompare(String(right.item.key))
}

function boundedInteger(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}`)
  }
  return value
}

export function retrieveNarrativeSubgraph(snapshot, {
  query,
  seedRanges = [],
  limit = 10,
  maxHops = 2
}) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('snapshot is required')
  if (typeof query !== 'string' || query.trim().length < 2) throw new TypeError('query is required')
  if (!Array.isArray(seedRanges)) throw new TypeError('seedRanges must be an array')
  boundedInteger(limit, 'limit', 1, 20)
  boundedInteger(maxHops, 'maxHops', 1, 2)

  const queryTokenSet = new Set(tokens(query))
  const nodeRecords = new Map((snapshot.nodes ?? []).map((node) => [
    node.key,
    scored(node, 'node', query, queryTokenSet, seedRanges)
  ]))
  const edgeRecords = (snapshot.edges ?? []).map((edge) => (
    scored(edge, 'edge', query, queryTokenSet, seedRanges)
  ))
  const arcRecords = (snapshot.storyArcs ?? []).map((arc) => (
    scored(arc, 'arc', query, queryTokenSet, seedRanges)
  ))

  const adjacency = new Map()
  for (const edgeRecord of edgeRecords) {
    const { sourceKey, targetKey } = edgeRecord.item
    if (!nodeRecords.has(sourceKey) || !nodeRecords.has(targetKey)) continue
    for (const [from, to] of [[sourceKey, targetKey], [targetKey, sourceKey]]) {
      const values = adjacency.get(from) ?? []
      values.push({ to, edge: edgeRecord })
      adjacency.set(from, values)
    }
    if (edgeRecord.score > 0) {
      for (const key of [sourceKey, targetKey]) {
        const node = nodeRecords.get(key)
        const contribution = edgeRecord.score * 0.75
        if (contribution > node.score) node.score = contribution
        node.matchedBy.add('related_fact')
      }
    }
  }

  for (const arcRecord of arcRecords) {
    if (arcRecord.score <= 0) continue
    const relatedKeys = [
      ...stringValues(arcRecord.item.eventKeys),
      ...stringValues(arcRecord.item.participantCharacterKeys)
    ]
    for (const key of relatedKeys) {
      const node = nodeRecords.get(key)
      if (!node) continue
      const contribution = arcRecord.score * 0.6
      if (contribution > node.score) node.score = contribution
      node.matchedBy.add('story_arc')
    }
  }

  const queue = [...nodeRecords.values()].filter((record) => record.score > 0)
  for (const record of queue) record.depth = 0
  queue.sort(compareRecords)
  while (queue.length) {
    const current = queue.shift()
    if (current.depth >= maxHops) continue
    for (const { to, edge } of adjacency.get(current.item.key) ?? []) {
      const neighbor = nodeRecords.get(to)
      const nextDepth = current.depth + 1
      const candidate = current.score * (edge.score > 0 ? 0.72 : 0.52)
      if (candidate <= 0 || (
        neighbor.depth !== null && neighbor.depth <= nextDepth && neighbor.score >= candidate
      )) continue
      neighbor.score = Math.max(neighbor.score, candidate)
      neighbor.depth = nextDepth
      neighbor.matchedBy.add('graph_hop')
      queue.push(neighbor)
      queue.sort(compareRecords)
    }
  }

  for (const edge of edgeRecords) {
    const source = nodeRecords.get(edge.item.sourceKey)
    const target = nodeRecords.get(edge.item.targetKey)
    edge.score += Math.max(source?.score ?? 0, target?.score ?? 0) * 0.35
    edge.score += Math.min(source?.score ?? 0, target?.score ?? 0) * 0.15
    if (edge.score > 0 && !edge.matchedBy.size) edge.matchedBy.add('graph_hop')
  }
  for (const arc of arcRecords) {
    const relatedScores = [
      ...stringValues(arc.item.eventKeys),
      ...stringValues(arc.item.participantCharacterKeys)
    ].map((key) => nodeRecords.get(key)?.score ?? 0)
    arc.score += Math.max(0, ...relatedScores) * 0.3
    if (arc.score > 0 && !arc.matchedBy.size) arc.matchedBy.add('related_entity')
  }

  const selectedNodes = [...nodeRecords.values()].filter((record) => record.score > 0)
    .sort(compareRecords).slice(0, limit)
  const selectedKeys = new Set(selectedNodes.map((record) => record.item.key))
  const selectedEdges = edgeRecords.filter((record) => record.score > 0 &&
      selectedKeys.has(record.item.sourceKey) && selectedKeys.has(record.item.targetKey))
    .sort(compareRecords).slice(0, limit * 2)
  const selectedArcs = arcRecords.filter((record) => record.score > 0)
    .sort(compareRecords).slice(0, Math.max(3, Math.ceil(limit / 2)))
  const evidenceIds = [...new Set([
    ...selectedNodes.flatMap((record) => stringValues(record.item.data?.evidenceIds)),
    ...selectedEdges.flatMap((record) => stringValues(record.item.evidenceIds)),
    ...selectedArcs.flatMap((record) => stringValues(record.item.evidenceIds))
  ])].slice(0, 64)

  return {
    nodes: selectedNodes.map(publicScore),
    edges: selectedEdges.map(publicScore),
    storyArcs: selectedArcs.map(publicScore),
    evidenceIds
  }
}
