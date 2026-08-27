import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNarrativeGraph, buildStoryArcs } from '../book-narrative-graph.mjs'

test('narrative graph reuses published evidence for relationships and event links', () => {
  const graph = buildNarrativeGraph({
    markup: {
      characters: [
        { characterKey: 'anna', name: 'Анна', fullName: 'Анна', firstAppearanceTextOffset: 10 },
        { characterKey: 'vronsky', name: 'Вронский', fullName: 'Алексей Вронский', firstAppearanceTextOffset: 50 }
      ],
      locations: [{
        locationKey: 'station', name: 'Станция', description: 'Встреча', evidenceIds: ['obs-1']
      }],
      events: [{
        eventKey: 'meeting', title: 'Встреча', description: 'Первая встреча',
        participantCharacterKeys: ['anna', 'vronsky'],
        locationKeys: ['station'], evidenceIds: ['obs-1']
      }],
      relationships: [{
        relationshipKey: 'anna-vronsky', sourceCharacterKey: 'anna',
        targetCharacterKey: 'vronsky', description: 'влюблены', evidenceIds: ['obs-2']
      }]
    },
    observations: [
      { id: 'obs-1', startOffset: 100, endOffset: 140 },
      { id: 'obs-2', startOffset: 300, endOffset: 340 }
    ]
  })
  assert.equal(graph.nodes.length, 4)
  assert.equal(graph.edges.filter(({ type }) => type === 'event_participant').length, 2)
  assert.equal(graph.edges.filter(({ type }) => type === 'event_location').length, 1)
  const relationship = graph.edges.find(({ type }) => type === 'relationship')
  assert.equal(relationship.label, 'влюблены')
  assert.equal(relationship.startOffset, 300)
  assert.deepEqual(relationship.evidenceIds, ['obs-2'])
})

test('narrative graph drops dangling and self-referencing relations', () => {
  const graph = buildNarrativeGraph({
    markup: {
      characters: [{
        characterKey: 'hero', name: 'Герой', fullName: 'Герой', firstAppearanceTextOffset: 0
      }],
      relationships: [
        { sourceCharacterKey: 'hero', targetCharacterKey: 'missing', description: 'unknown' },
        { sourceCharacterKey: 'hero', targetCharacterKey: 'hero', description: 'self' }
      ]
    }
  })
  assert.equal(graph.nodes.length, 1)
  assert.deepEqual(graph.edges, [])
})

test('story arcs join chronological events through shared participants', () => {
  const storyArcs = buildStoryArcs({
    markup: {
      characters: [
        { characterKey: 'hero', name: 'Герой', fullName: 'Главный герой' },
        { characterKey: 'friend', name: 'Друг', fullName: 'Друг героя' }
      ],
      events: [
        {
          eventKey: 'departure', title: 'Отъезд', description: 'Герой уезжает.',
          participantCharacterKeys: ['hero'], evidenceIds: ['obs-1']
        },
        {
          eventKey: 'meeting', title: 'Встреча', description: 'Герой встречает друга.',
          participantCharacterKeys: ['hero', 'friend'], evidenceIds: ['obs-2']
        }
      ]
    },
    observations: [
      { id: 'obs-1', startOffset: 10, endOffset: 20 },
      { id: 'obs-2', startOffset: 100, endOffset: 120 }
    ]
  })
  assert.equal(storyArcs.length, 1)
  assert.deepEqual(storyArcs[0].eventKeys, ['departure', 'meeting'])
  assert.equal(storyArcs[0].startOffset, 10)
  assert.equal(storyArcs[0].endOffset, 120)
  assert.match(storyArcs[0].summary, /уезжает.*встречает/u)
})
