import assert from 'node:assert/strict';
import { MULTICHUNK_FACTS, MULTICHUNK_FIXTURE } from './multichunk-book-fixture.mjs';

const names = ['Анна', 'Борис'];
const concepts = new Map([
  ...['честная', 'честный', 'честность'].map(value => [value, 0]),
  ...['терпеливый', 'терпеливая', 'терпеливость', 'терпение'].map(value => [value, 1]),
  ...['любознательная', 'любознательный', 'любознательность'].map(value => [value, 8]),
]);
const normalize = value => typeof value === 'string' ? value.trim().toLocaleLowerCase('ru-RU') : '';
// Formatting equivalence only: strip at most one terminal full stop. Preserve
// interior punctuation, negation, extra assertions, questions and ellipses.
const relationshipText = value => typeof value === 'string' ? value.trim().replace(/\.$/u, '').trim() : '';
const utterance = fact => fact.evidence.quote.match(/«([^»]+)»/u)?.[1];
function isFixturePair(row) {
  if (!Object.hasOwn(row, 'related_entity_candidates')) {
    // Historical evidence omitted participant fields and encoded the pair in the label.
    return ['Анна и Борис', 'Борис и Анна'].includes(row.entity_candidate);
  }
  const participants = row.related_entity_candidates;
  return Array.isArray(participants) && participants.length === 2 &&
    new Set(participants).size === 2 && participants.every(name => names.includes(name));
}
function exactSpeechForms(fact) {
  const spoken = utterance(fact);
  return [fact.evidence.quote, spoken, `«${spoken}»`, `«${spoken}».`]
    .filter(value => typeof value === 'string' && fact.evidence.quote.includes(value));
}
const types = new Set(['character_mention', 'character_alias', 'character_action', 'character_dialogue', 'character_trait', 'character_appearance', 'character_role', 'character_age', 'character_gender', 'event', 'location', 'relationship']);

/** Machine evidence checks only; not an automatic judgement of prose semantics. */
export function evaluateMultichunkLiveAcceptance({ observations, markup, chunks }) {
  assert.ok(Array.isArray(observations) && observations.length > 0 && observations.length <= 480);
  const byId = new Map();
  const signatures = new Set();
  for (const row of observations) {
    assert.ok(typeof row.id === 'string' && row.id.trim() && !byId.has(row.id), 'observation IDs must be unique');
    assert.ok(types.has(row.observation_type), 'unknown observation type');
    assert.ok(typeof row.entity_candidate === 'string' && row.entity_candidate.trim(), 'observation owner required');
    if (row.observation_type.startsWith('character_')) assert.ok(names.includes(row.entity_candidate), 'unexpected character owner');
    if (row.observation_type === 'relationship') assert.ok(isFixturePair(row), 'unexpected relationship participants');
    const start = Number(row.evidence_start_offset), end = Number(row.evidence_end_offset);
    assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end <= MULTICHUNK_FIXTURE.length, 'invalid evidence offsets');
    assert.equal(MULTICHUNK_FIXTURE.slice(start, end), row.evidence_quote, 'evidence must be verbatim');
    const owner = row.observation_type === 'relationship' ? names : row.entity_candidate;
    const signature = JSON.stringify([row.observation_type, owner, start, end]);
    assert.ok(!signatures.has(signature), 'duplicate observation occurrence');
    signatures.add(signature); byId.set(row.id, row);
  }
  const supports = (row, fact) => {
    if (row.observation_type !== fact.type || (fact.type === 'relationship'
      ? !isFixturePair(row) : row.entity_candidate !== fact.entityCandidate)) return false;
    const text = fact.evidence.quote;
    const expectedStart = MULTICHUNK_FIXTURE.indexOf(text);
    const start = Number(row.evidence_start_offset), end = Number(row.evidence_end_offset);
    if (start <= expectedStart && end >= expectedStart + text.length) return true;
    if (fact.type !== 'character_dialogue') return false;
    const spoken = utterance(fact), spokenStart = MULTICHUNK_FIXTURE.indexOf(spoken, expectedStart);
    return row.evidence_quote === spoken && start === spokenStart && end === spokenStart + spoken.length;
  };
  for (const fact of MULTICHUNK_FACTS) assert.ok(observations.some(row => supports(row, fact)), `missing mandatory evidence: ${fact.fact}`);
  // Extra trait candidates must also belong to the closed, authored fact bank.
  for (const row of observations.filter(row => row.observation_type === 'character_trait')) {
    assert.ok([0, 1, 8].some(index => supports(row, MULTICHUNK_FACTS[index])), 'unsupported personality evidence');
  }
  assert.equal(chunks.length, 3);
  let end = 0;
  for (const chunk of chunks) {
    assert.equal(Number(chunk.core_start_offset), end);
    const next = Number(chunk.core_end_offset);
    assert.ok(Number.isSafeInteger(next) && next > end); end = next;
  }
  assert.equal(end, MULTICHUNK_FIXTURE.length);
  assert.deepEqual(markup.characters.map(character => character.name).sort(), names);
  const keys = new Set(markup.characters.map(character => character.characterKey));
  assert.equal(keys.size, 2);
  assert.ok([...keys].every(key => typeof key === 'string' && key.length > 0));
  const checkClaim = (claim, fact, cutoff = MULTICHUNK_FIXTURE.length) => {
    assert.ok(Array.isArray(claim?.evidenceIds) && claim.evidenceIds.length > 0, 'claim evidence required');
    for (const id of claim.evidenceIds) {
      const row = byId.get(id);
      assert.ok(row && supports(row, fact), 'wrong claim citation/owner/type');
      assert.ok(Number(row.evidence_end_offset) <= cutoff, 'future citation');
    }
  };
  const traitIndex = (claim, character, cutoff) => {
    const index = concepts.get(normalize(claim.value));
    assert.notEqual(index, undefined, 'unsupported trait concept');
    assert.equal(MULTICHUNK_FACTS[index].entityCandidate, character.name, 'trait belongs to another character');
    checkClaim(claim, MULTICHUNK_FACTS[index], cutoff); return index;
  };
  for (const character of markup.characters) {
    const indices = character.traits.map(claim => traitIndex(claim, character));
    assert.deepEqual(indices.sort((a, b) => a - b), character.name === 'Анна' ? [0, 8] : [1], 'required traits without synonyms or extras');
    if (character.name === 'Анна') {
      assert.ok(['хранитель архива', 'хранительница архива', 'архивист', 'архивистка'].includes(normalize(character.role?.value)), 'wrong profession');
      checkClaim(character.role, MULTICHUNK_FACTS[7]);
    } else assert.equal(character.role, null, 'unsupported Boris profession');
    const dialogue = MULTICHUNK_FACTS[character.name === 'Анна' ? 5 : 6];
    assert.ok(Array.isArray(character.speechExamples) && character.speechExamples.length > 0);
    for (const example of character.speechExamples) {
      assert.ok(exactSpeechForms(dialogue).includes(example.value), 'invented speech example');
      checkClaim(example, dialogue);
    }
    assert.ok(Array.isArray(character.personalitySnapshots) && character.personalitySnapshots.length > 0);
    let previous = -1;
    for (const snapshot of character.personalitySnapshots) {
      assert.ok(Number.isSafeInteger(snapshot.cutoffTextOffset) && snapshot.cutoffTextOffset > previous && snapshot.cutoffTextOffset <= MULTICHUNK_FIXTURE.length);
      previous = snapshot.cutoffTextOffset;
      const seen = snapshot.traits.map(claim => traitIndex(claim, character, previous));
      assert.equal(new Set(seen).size, seen.length);
    }
    if (character.name === 'Анна') {
      const late = MULTICHUNK_FIXTURE.indexOf(MULTICHUNK_FACTS[8].evidence.quote);
      assert.ok(character.personalitySnapshots.some(snapshot => snapshot.cutoffTextOffset < late));
      assert.ok(character.personalitySnapshots.at(-1).traits.some(claim => concepts.get(normalize(claim.value)) === 8), 'late curiosity missing');
    }
  }
  assert.equal(markup.relationships.length, 1);
  const relation = markup.relationships[0];
  assert.deepEqual(new Set([relation.sourceCharacterKey, relation.targetCharacterKey]), keys);
  assert.ok([
    'Анна и Борис — родные сестра и брат',
    'Анна и Борис были родными сестрой и братом.',
    'Анна — сестра Бориса. Борис — брат Анны.',
  ].map(relationshipText).includes(relationshipText(relation.description)), 'relationship meaning requires explicit sibling statement');
  checkClaim(relation, MULTICHUNK_FACTS[2]);
  return {
    machinePassed: true, requiresManualReview: true, qualityComplete: false, status: 'manual-review-required',
    reviewRequired: ['Additional observation fact meanings', 'Description/bio grounding and readability', 'Speech style and creative greeting', 'Public-client spoiler policy'],
  };
}
