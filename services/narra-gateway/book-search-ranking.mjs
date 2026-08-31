function finiteVector(value, name) {
  if (!Array.isArray(value) || !value.length || value.some((item) =>
    typeof item !== 'number' || !Number.isFinite(item)
  )) throw new TypeError(`${name} must contain finite numbers`)
  return value
}

export function cosineSimilarity(leftValue, rightValue) {
  const left = finiteVector(leftValue, 'left')
  const right = finiteVector(rightValue, 'right')
  if (left.length !== right.length) throw new RangeError('vectors must have equal dimensions')
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}

export function reciprocalRankFusion(rankings, { k = 60, limit = 10 } = {}) {
  if (!Array.isArray(rankings)) throw new TypeError('rankings must be an array')
  if (!Number.isSafeInteger(k) || k < 1) throw new RangeError('k must be positive')
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('limit must be positive')
  const fused = new Map()
  for (const ranking of rankings) {
    if (!ranking || !Array.isArray(ranking.items)) throw new TypeError('ranking.items is required')
    const source = String(ranking.source || '').trim()
    const weight = Number(ranking.weight ?? 1)
    if (!source || !Number.isFinite(weight) || weight <= 0) {
      throw new TypeError('ranking source and positive weight are required')
    }
    ranking.items.forEach((item, index) => {
      if (!item?.chunkId) throw new TypeError('ranked item chunkId is required')
      const current = fused.get(item.chunkId) ?? {
        ...item,
        score: 0,
        matchedBy: []
      }
      current.score += weight / (k + index + 1)
      if (!current.matchedBy.includes(source)) current.matchedBy.push(source)
      fused.set(item.chunkId, current)
    })
  }
  return [...fused.values()]
    .sort((left, right) => right.score - left.score || left.ordinal - right.ordinal)
    .slice(0, limit)
}

function normalizedTerms(query) {
  return String(query || '').toLocaleLowerCase('ru-RU')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((value) => value.length > 1)
    .sort((left, right) => right.length - left.length)
}

export function searchSnippet(text, query, { maxCharacters = 320 } = {}) {
  if (typeof text !== 'string') throw new TypeError('text is required')
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 40) {
    throw new RangeError('maxCharacters must be at least 40')
  }
  if (text.length <= maxCharacters) return { text, localStartOffset: 0, localEndOffset: text.length }
  const lower = text.toLocaleLowerCase('ru-RU')
  const hits = normalizedTerms(query)
    .map((term) => lower.indexOf(term))
    .filter((offset) => offset >= 0)
  const center = hits.length ? Math.min(...hits) : 0
  let start = Math.max(0, center - Math.floor(maxCharacters / 3))
  let end = Math.min(text.length, start + maxCharacters)
  if (end - start < maxCharacters) start = Math.max(0, end - maxCharacters)
  const leading = text.slice(start, Math.min(end, start + 80)).search(/\s/u)
  if (start > 0 && leading >= 0) start += leading + 1
  const trailing = text.slice(Math.max(start, end - 80), end).lastIndexOf(' ')
  if (end < text.length && trailing >= 0) end = Math.max(start, end - 80) + trailing
  return {
    text: text.slice(start, end).trim(),
    localStartOffset: start,
    localEndOffset: end
  }
}
