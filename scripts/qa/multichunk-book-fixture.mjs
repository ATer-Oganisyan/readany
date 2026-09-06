// Authored, deterministic QA text. Never substitute arbitrary uploaded books.
import assert from 'node:assert/strict';

const landscape = 'За окном тянулась пустая дорога. Свет ложился на деревянный пол, а дождь ровно стучал по крыше. На столе лежал чистый лист бумаги. В комнате было тихо. ';
const opening = 'Анна всегда была честной. Борис всегда был терпеливым. Анна и Борис были родными сестрой и братом.';
const middle = 'Анна торопливо закрыла окно. Борис положил ключ на стол. Анна сказала: «Борис, подожди здесь». Борис ответил: «Хорошо, Анна». ';
const ending = 'Анна работала хранителем архива. Анна всегда была любознательной. Борис вернул ключ Анне. Анна открыла дверь архива.';
export const MULTICHUNK_FIXTURE = `${opening}\n\n${landscape.repeat(28)}\n\n${middle}\n\n${landscape.repeat(30)}\n\n${ending}`;

export const MULTICHUNK_FACTS = [
  ['character_trait', 'Анна', 'Анна честная', 'Анна всегда была честной.'],
  ['character_trait', 'Борис', 'Борис терпеливый', 'Борис всегда был терпеливым.'],
  ['relationship', 'Анна и Борис', 'Анна и Борис — родные сестра и брат', 'Анна и Борис были родными сестрой и братом.'],
  ['character_action', 'Анна', 'Анна закрыла окно', 'Анна торопливо закрыла окно.'],
  ['character_action', 'Борис', 'Борис положил ключ на стол', 'Борис положил ключ на стол.'],
  ['character_dialogue', 'Анна', 'Анна просит Бориса подождать', 'Анна сказала: «Борис, подожди здесь».'],
  ['character_dialogue', 'Борис', 'Борис согласился подождать', 'Борис ответил: «Хорошо, Анна».'],
  ['character_role', 'Анна', 'Анна — хранитель архива', 'Анна работала хранителем архива.'],
  ['character_trait', 'Анна', 'Анна любознательная', 'Анна всегда была любознательной.'],
  ['character_action', 'Борис', 'Борис вернул ключ Анне', 'Борис вернул ключ Анне.'],
  ['character_action', 'Анна', 'Анна открыла дверь архива', 'Анна открыла дверь архива.'],
].map(([type, entityCandidate, fact, quote]) => Object.freeze({
  type, entityKind: type === 'relationship' ? 'relationship' : 'character', entityCandidate, fact,
  // Deliberately omit participants: actual resolver can recover this explicit
  // composite label; assembler must not silently drop its resolved relation.
  relatedEntityCandidates: [],
  evidence: { quote }, confidence: 0.98,
}));

const field = (input, name, fallback) => {
  const line = input.messages[1].content.split('\n').find(value => value.startsWith(`${name}: `));
  return line ? JSON.parse(line.slice(name.length + 2)) : fallback;
};

export function createMultichunkFixtureModel(calls = []) {
  return async input => {
    const operation = input.costContext?.operation;
    calls.push({ operation, messagesBytes: Buffer.byteLength(JSON.stringify(input.messages)) });
    if (calls.length > 10) throw new Error('Multi-chunk mock call budget exceeded');
    if (operation === 'scan_book_chunk') {
      const context = input.messages[1].content.match(/\nCONTEXT_TEXT_BEGIN\n([\s\S]*)\nCONTEXT_TEXT_END$/)?.[1];
      assert.equal(typeof context, 'string');
      // Return overlap observations too: the real service/worker must assign
      // ownership to a core range and remove duplicates, not this mock.
      return JSON.stringify({ observations: MULTICHUNK_FACTS.filter(item => context.includes(item.evidence.quote)) });
    }
    if (operation === 'reconcile_character_identities') return '{"merges":[]}';
    if (operation === 'recall_character_traits') return '{"traits":[]}';
    const evidence = field(input, 'EVIDENCE', []);
    const character = field(input, 'CHARACTER', {});
    if (operation === 'synthesize_character_profile') {
      const trait = evidence.find(item => item.type === 'character_trait');
      assert.ok(trait, 'each character must retain their own stable trait');
      const value = character.canonicalName === 'Анна' ? 'честная' : 'терпеливый';
      const traitClaims = evidence.filter(item => item.type === 'character_trait').map(item => ({
        value: /любознатель/u.test(item.quote) ? 'любознательная' : value,
        evidenceIds: [item.id], confidence: 0.98,
      }));
      const action = evidence.find(item => item.type === 'character_action');
      assert.ok(action, 'character must retain evidence outside first chunk');
      const role = evidence.find(item => item.type === 'character_role');
      if (character.canonicalName === 'Анна') assert.ok(role, 'Anna must retain her explicit profession');
      const dialogue = evidence.filter(item => item.type === 'character_dialogue');
      assert.equal(dialogue.length, 1, 'each mock character has one own dialogue example');
      return JSON.stringify({
        role: role ? { value: 'хранитель архива', evidenceIds: [role.id], confidence: 0.98 } : null,
        speechExamples: dialogue.map(item => ({ value: item.quote, evidenceIds: [item.id], confidence: 0.98 })),
        traits: [...traitClaims, { value: 'тревожная', evidenceIds: [action.id], confidence: 0.9 }],
        description: { value: `${character.canonicalName} — ${value} персонаж.`, evidenceIds: [trait.id, action.id], confidence: 0.98 },
        personalitySnapshots: field(input, 'PERSONALITY_CHECKPOINTS', []).map(checkpoint => ({
          cutoffTextOffset: checkpoint.cutoffTextOffset,
          traits: traitClaims.filter(claim => checkpoint.evidenceIds.includes(claim.evidenceIds[0])),
        })),
        creative: { greeting: 'Здравствуйте.', appearancePrompt: '', voice: '' },
      });
    }
    if (operation === 'audit_character_profile') {
      const candidate = field(input, 'CANDIDATE_PROFILE', {});
      return JSON.stringify({
        traits: candidate.traits.flatMap((trait, index) => ['честная', 'терпеливый', 'любознательная'].includes(trait.value) ? [{ index, evidenceIds: trait.evidenceIds }] : []),
        description: candidate.description,
      });
    }
    throw new Error(`Unexpected multi-chunk operation: ${operation}`);
  };
}

export function assertMultichunkAcceptance({ observations, profiles, markup, chunks }) {
  const traitQuotes = {
    честная: 'Анна всегда была честной.',
    терпеливый: 'Борис всегда был терпеливым.',
    любознательная: 'Анна всегда была любознательной.',
  };
  const assertTrait = (trait, character, cutoff = MULTICHUNK_FIXTURE.length) => {
    assert.ok(Object.hasOwn(traitQuotes, trait.value), 'unsupported personality concept');
    assert.ok(Array.isArray(trait.evidenceIds) && trait.evidenceIds.length > 0);
    for (const id of trait.evidenceIds) {
      const source = observations.find(row => row.id === id);
      assert.ok(source && source.entity_candidate === character.name, 'personality evidence belongs to another character');
      assert.equal(source.observation_type, 'character_trait', 'single action cannot establish this fixture trait');
      assert.equal(source.evidence_quote, traitQuotes[trait.value], 'trait concept must match its own exact assertion');
      assert.ok(Number(source.evidence_end_offset) <= cutoff, 'future evidence leaked into earlier personality checkpoint');
    }
  };
  const assertEvidence = (ids, expected) => {
    assert.ok(Array.isArray(ids) && ids.length > 0, 'claim must retain evidence');
    for (const id of ids) {
      const source = observations.find(row => row.id === id);
      assert.ok(source, 'claim evidence must exist');
      assert.equal(source.entity_candidate, expected.entityCandidate, 'claim evidence must belong to its owner');
      assert.equal(source.observation_type, expected.type, 'claim evidence type must match');
      assert.equal(source.evidence_quote, expected.evidence.quote, 'claim must cite its exact supporting assertion');
    }
  };
  assert.equal(chunks.length, 3, 'must use three production-default chunks');
  let end = 0;
  for (const chunk of chunks) {
    assert.equal(Number(chunk.core_start_offset), end, 'chunk cores must cover without gaps');
    end = Number(chunk.core_end_offset);
  }
  assert.equal(end, MULTICHUNK_FIXTURE.length);
  assert.equal(observations.length, MULTICHUNK_FACTS.length, 'all facts exactly once, including overlap');
  for (const item of MULTICHUNK_FACTS) {
    const matches = observations.filter(row => row.observation_type === item.type && row.evidence_quote === item.evidence.quote);
    assert.equal(matches.length, 1, `missing/duplicate fact: ${item.fact}`);
  }
  for (const row of observations) assert.equal(MULTICHUNK_FIXTURE.slice(Number(row.evidence_start_offset), Number(row.evidence_end_offset)), row.evidence_quote);
  assert.equal(profiles.length, 2);
  assert.deepEqual(markup.characters.map(item => item.name).sort(), ['Анна', 'Борис']);
  for (const character of markup.characters) {
    if (character.name === 'Анна') {
      assert.equal(character.role?.value, 'хранитель архива', 'explicit profession must survive publication');
      assertEvidence(character.role.evidenceIds, MULTICHUNK_FACTS.find(item => item.type === 'character_role'));
    } else assert.equal(character.role, null, 'no profession is established for Boris');
    const dialogue = MULTICHUNK_FACTS.find(item => item.type === 'character_dialogue' && item.entityCandidate === character.name);
    assert.equal(character.speechExamples?.length, 1, 'own dialogue must survive publication');
    assert.equal(character.speechExamples[0].value, dialogue.evidence.quote, 'speech example must be verbatim, not rewritten');
    assertEvidence(character.speechExamples[0].evidenceIds, dialogue);
    const expected = character.name === 'Анна' ? ['любознательная', 'честная'] : ['терпеливый'];
    assert.deepEqual(character.traits.map(item => item.value).sort(), expected);
    for (const trait of character.traits) assertTrait(trait, character);
    assert.ok(character.personalitySnapshots.length > 0, 'timeline is required');
    for (const snapshot of character.personalitySnapshots) {
      for (const trait of snapshot.traits) assertTrait(trait, character, snapshot.cutoffTextOffset);
    }
  }
  const anna = markup.characters.find(item => item.name === 'Анна');
  const lateOffset = MULTICHUNK_FIXTURE.indexOf('Анна всегда была любознательной.');
  assert.ok(anna.personalitySnapshots.some(item => item.cutoffTextOffset < lateOffset), 'must check a pre-reveal checkpoint');
  assert.ok(anna.personalitySnapshots.at(-1).traits.some(item => item.value === 'любознательная'), 'late evidence must eventually appear');
  assert.equal(markup.relationships.length, 1, 'sibling relationship must survive publication');
  assert.deepEqual(new Set([markup.relationships[0].sourceCharacterKey, markup.relationships[0].targetCharacterKey]), new Set(markup.characters.map(item => item.characterKey)));
  const kinship = MULTICHUNK_FACTS.find(item => item.type === 'relationship');
  assert.equal(markup.relationships[0].description, kinship.fact, 'published relationship must retain sibling semantics');
  assertEvidence(markup.relationships[0].evidenceIds, kinship);
}
