import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFrozenProfileRequests } from '../book-analysis-profile-replay.mjs'
import { loadPersonalityFixture } from '../evaluation/score-frozen-personality.mjs'

test('frozen profile replay selects identities but never puts personality gold in requests', async () => {
  const fixture = await loadPersonalityFixture()
  const target = fixture.characters[0]
  const observation = {
    id: 'evidence-1', type: 'character_trait', entityCandidate: 'Mr. Darcy',
    fact: 'Mr. Darcy is reserved', confidence: 0.99,
    evidence: { quote: 'Mr. Darcy was reserved.', startOffset: 100, endOffset: 123 }
  }
  const input = {
    runId: 'run-1', snapshotId: 'snapshot-1', title: 'Pride and Prejudice', author: 'Jane Austen',
    textLength: 10_000, observations: [observation]
  }
  const entity = {
    entityKey: 'character:darcy', entityKind: 'character', canonicalName: 'Mr. Darcy', aliases: [],
    resolutionStatus: 'confirmed', confidence: 0.99, evidenceIds: [observation.id],
    data: { observationCount: 2, firstEvidenceStartOffset: 100, lastEvidenceEndOffset: 123 }
  }
  const onlyTarget = { ...fixture, characters: [target] }
  const result = buildFrozenProfileRequests({ input, entities: [entity], fixture: onlyTarget })
  assert.equal(result.requests.length, 1)
  assert.equal(result.requests[0].goldCharacterId, target.id)
  const serialized = JSON.stringify(result.requests[0].request)
  assert.doesNotMatch(serialized, /self-disciplined|BAP75|SWCPQ/)
  assert.match(serialized, /Mr\. Darcy was reserved/)
})
