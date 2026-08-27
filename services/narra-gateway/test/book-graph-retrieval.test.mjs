import assert from 'node:assert/strict'
import test from 'node:test'
import { retrieveNarrativeSubgraph } from '../book-graph-retrieval.mjs'

function snapshot() {
  return {
    nodes: [
      { key: 'prometheus', type: 'character', name: 'Прометей', data: { aliases: [] } },
      { key: 'zeus', type: 'character', name: 'Зевс', data: { aliases: [] } },
      { key: 'binding', type: 'event', name: 'Приковывание', data: {} },
      { key: 'ocean', type: 'character', name: 'Океан', data: { aliases: [] } }
    ],
    edges: [
      {
        key: 'conflict', type: 'relationship', sourceKey: 'prometheus', targetKey: 'zeus',
        label: 'конфликтует', startOffset: 100, endOffset: 140,
        evidenceIds: ['123e4567-e89b-42d3-a456-426614174010'], data: {}
      },
      {
        key: 'binding-prometheus', type: 'event_participant', sourceKey: 'binding',
        targetKey: 'prometheus', label: 'participant', startOffset: null, endOffset: null,
        evidenceIds: [], data: {}
      },
      {
        key: 'binding-ocean', type: 'event_participant', sourceKey: 'binding',
        targetKey: 'ocean', label: 'participant', startOffset: null, endOffset: null,
        evidenceIds: [], data: {}
      }
    ],
    storyArcs: [{
      key: 'arc-1', title: 'Прометей — Зевс', summary: 'Конфликт Прометея и Зевса.',
      eventKeys: ['binding'], participantCharacterKeys: ['prometheus', 'zeus'],
      startOffset: 100, endOffset: 200,
      evidenceIds: ['123e4567-e89b-42d3-a456-426614174010'], data: {}
    }]
  }
}

test('graph retrieval combines named entities, relation text and chunk evidence', () => {
  const result = retrieveNarrativeSubgraph(snapshot(), {
    query: 'Почему Прометей конфликтует с Зевсом?',
    seedRanges: [{ startOffset: 90, endOffset: 160 }],
    limit: 5,
    maxHops: 2
  })
  assert.deepEqual(result.nodes.slice(0, 2).map((node) => node.key).sort(), [
    'prometheus', 'zeus'
  ])
  assert.equal(result.edges[0].key, 'conflict')
  assert.ok(result.edges[0].matchedBy.includes('edge_text'))
  assert.deepEqual(result.evidenceIds, ['123e4567-e89b-42d3-a456-426614174010'])
})

test('graph traversal is bounded to two hops', () => {
  const graph = snapshot()
  graph.storyArcs = []
  const oneHop = retrieveNarrativeSubgraph(graph, {
    query: 'Прометей', limit: 10, maxHops: 1
  })
  const twoHops = retrieveNarrativeSubgraph(graph, {
    query: 'Прометей', limit: 10, maxHops: 2
  })
  assert.equal(oneHop.nodes.some((node) => node.key === 'ocean'), false)
  assert.equal(twoHops.nodes.some((node) => node.key === 'ocean'), true)
})
