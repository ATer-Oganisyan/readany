import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { MULTICHUNK_FACTS, MULTICHUNK_FIXTURE } from './multichunk-book-fixture.mjs';
import { createStableBookChunks } from '../../services/narra-gateway/book-analysis-chunking.mjs';
import { evaluateMultichunkLiveAcceptance } from './multichunk-live-acceptance.mjs';

function gold() {
  const observations = MULTICHUNK_FACTS.map((fact, index) => ({
    id: `fact-${index}`, observation_type: fact.type, entity_candidate: fact.entityCandidate,
    fact: fact.fact, evidence_quote: fact.evidence.quote,
    evidence_start_offset: MULTICHUNK_FIXTURE.indexOf(fact.evidence.quote),
    evidence_end_offset: MULTICHUNK_FIXTURE.indexOf(fact.evidence.quote) + fact.evidence.quote.length,
  }));
  const claim = (value, index) => ({ value, evidenceIds: [`fact-${index}`] });
  const characters = ['Анна', 'Борис'].map((name, index) => {
    const traits = index ? [claim('терпение', 1)] : [claim('честность', 0), claim('любознательная', 8)];
    return { name, characterKey: `character-${index}`, traits,
      role: index ? null : claim('хранитель архива', 7),
      speechExamples: [claim(MULTICHUNK_FACTS[index ? 6 : 5].evidence.quote, index ? 6 : 5)],
      personalitySnapshots: [{ cutoffTextOffset: 100, traits: traits.slice(0, 1) }, { cutoffTextOffset: MULTICHUNK_FIXTURE.length, traits }],
    };
  });
  return { observations, markup: { characters, relationships: [{
    relationshipKey: 'relation-1', sourceCharacterKey: 'character-0', targetCharacterKey: 'character-1',
    description: MULTICHUNK_FACTS[2].fact, evidenceIds: ['fact-2'],
  }] }, chunks: createStableBookChunks({ runId: 'gold', text: MULTICHUNK_FIXTURE }).map(chunk => ({
    core_start_offset: chunk.coreStartOffset, core_end_offset: chunk.coreEndOffset,
  })) };
}

test('accepts unchanged recorded live publication without declaring full quality complete', () => {
  const evidence = JSON.parse(readFileSync(new URL('../../docs/reviews/evidence/subscription-multichunk-live-2026-09-06.json', import.meta.url)));
  const result = evaluateMultichunkLiveAcceptance(evidence);
  assert.equal(result.machinePassed, true);
  assert.equal(result.qualityComplete, false);
});

test('relationship participants, not its display label, identify the grounded pair', () => {
  const input = gold();
  input.observations[2].entity_candidate = 'родство Анны и Бориса';
  input.observations[2].related_entity_candidates = ['Борис', 'Анна'];
  assert.equal(evaluateMultichunkLiveAcceptance(input).machinePassed, true);
});

test('exact quoted utterance may retain its source guillemets and terminal period', () => {
  for (const value of ['«Борис, подожди здесь»', '«Борис, подожди здесь».']) {
    const input = gold(); input.markup.characters[0].speechExamples[0].value = value;
    assert.equal(evaluateMultichunkLiveAcceptance(input).machinePassed, true);
  }
});

test('relation cannot hide incorrect explicit participants behind a valid label', () => {
  for (const participants of [[], ['Анна'], ['Анна', 'Анна'], ['Анна', 'Пётр'], ['Анна', 'Борис', 'Пётр'], null, undefined, 'Анна и Борис', { 0: 'Анна', 1: 'Борис', length: 2 }]) {
    const input = gold(); input.observations[2].related_entity_candidates = participants;
    assert.throws(() => evaluateMultichunkLiveAcceptance(input));
  }
});

test('alternate relation label needs explicit participants and cannot disguise a duplicate', () => {
  const input = gold(); input.observations[2].entity_candidate = 'родство Анны и Бориса';
  assert.throws(() => evaluateMultichunkLiveAcceptance(input));
  input.observations[2].related_entity_candidates = ['Анна', 'Борис'];
  input.observations.push({ ...input.observations[2], id: 'same-pair-again', entity_candidate: 'другая подпись', related_entity_candidates: ['Борис', 'Анна'] });
  assert.throws(() => evaluateMultichunkLiveAcceptance(input), /duplicate/);
});

test('speech formatting never licenses word changes, ellipses, questions or a different speaker', () => {
  for (const value of ['«Борис, не подожди здесь».', '«Борис, подожди здесь?»', '«Борис, подожди здесь»...', '«Борис, подожди здесь»…', '«Хорошо, Анна».', 'Борис, подожди', '«Борис подожди здесь».']) {
    const input = gold(); input.markup.characters[0].speechExamples[0].value = value;
    assert.throws(() => evaluateMultichunkLiveAcceptance(input), /speech example/);
  }
});

test('structural gold passes but never claims completed manual quality review', () => {
  const result = evaluateMultichunkLiveAcceptance(gold());
  assert.equal(result.machinePassed, true);
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.qualityComplete, false);
});

test('predetermined expanded evidence, inner utterances and additional mentions are allowed', () => {
  const input = gold();
  input.observations[0].evidence_end_offset += 1;
  input.observations[0].evidence_quote += ' ';
  const speech = input.observations[5];
  speech.evidence_quote = 'Борис, подожди здесь';
  speech.evidence_start_offset = MULTICHUNK_FIXTURE.indexOf(speech.evidence_quote);
  speech.evidence_end_offset = speech.evidence_start_offset + speech.evidence_quote.length;
  input.markup.characters[0].speechExamples[0].value = speech.evidence_quote;
  input.observations.push({ id: 'extra-mention', observation_type: 'character_mention', entity_candidate: 'Анна', fact: 'Анна названа', evidence_quote: 'Анна', evidence_start_offset: 0, evidence_end_offset: 4 });
  assert.equal(evaluateMultichunkLiveAcceptance(input).machinePassed, true);
});

const mutations = {
  missingFact: input => input.observations.splice(3, 1),
  duplicateId: input => { input.observations[1].id = 'fact-0'; },
  duplicateOccurrence: input => input.observations.push({ ...input.observations[0], id: 'duplicate' }),
  unanchoredQuote: input => { input.observations[0].evidence_quote = 'не исходник'; },
  offset: input => { input.observations[0].evidence_start_offset = -1; },
  unknownOwner: input => { input.observations[0].entity_candidate = 'Мария'; },
  swappedIds: input => { input.markup.characters[0].traits[0].evidenceIds = ['fact-1']; },
  actionTrait: input => { input.markup.characters[0].traits[0].evidenceIds = ['fact-3']; },
  guessedTrait: input => { input.markup.characters[0].traits[0].value = 'тревожная'; },
  earlyFuture: input => { input.markup.characters[0].personalitySnapshots[0].traits = input.markup.characters[0].traits; },
  falseEarlyCitation: input => { input.markup.characters[0].personalitySnapshots[0].traits = [{ value: 'любознательная', evidenceIds: ['fact-0'] }]; },
  lateMissing: input => { input.markup.characters[0].personalitySnapshots[1].traits = []; },
  wrongRole: input => { input.markup.characters[0].role.value = 'врач'; },
  wrongRoleCitation: input => { input.markup.characters[0].role.evidenceIds = ['fact-3']; },
  inventedBorisRole: input => { input.markup.characters[1].role = input.markup.characters[0].role; },
  wrongSpeech: input => { input.markup.characters[0].speechExamples = input.markup.characters[1].speechExamples; },
  rewrittenSpeech: input => { input.markup.characters[0].speechExamples[0].value = 'Подожди меня'; },
  wrongRelation: input => { input.markup.relationships[0].description = 'Анна и Борис — супруги'; },
  wrongRelationCitation: input => { input.markup.relationships[0].evidenceIds = ['fact-0']; },
  wrongRelationKeys: input => { input.markup.relationships[0].targetCharacterKey = 'other'; },
  missingCharacter: input => input.markup.characters.pop(),
  chunkGap: input => { input.chunks[1].core_start_offset++; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`rejects ${name}`, () => {
  const input = gold(); mutate(input); assert.throws(() => evaluateMultichunkLiveAcceptance(input));
});

test('unverified fact prose remains a manual blocker even when anchors are valid', () => {
  const input = gold();
  input.observations[0].fact = 'Недоказанный пересказ';
  input.markup.characters[0].description = { value: 'Непроверенный текст', evidenceIds: ['fact-0'] };
  const result = evaluateMultichunkLiveAcceptance(input);
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.qualityComplete, false);
});

test('relationship accepts only terminal full-stop and surrounding whitespace equivalence', () => {
  for (const text of [
    'Анна и Борис — родные сестра и брат',
    'Анна и Борис были родными сестрой и братом',
    'Анна — сестра Бориса. Борис — брат Анны',
  ]) for (const ending of ['', '.']) for (const padding of ['', ' \n\t']) {
    const input = gold();
    input.markup.relationships[0].description = `${padding}${text}${ending}${padding}`;
    assert.equal(evaluateMultichunkLiveAcceptance(input).machinePassed, true);
  }
});

test('relationship formatting normalization does not accept different semantics or punctuation', () => {
  for (const text of [
    'Анна и Борис — супруги.',
    'Анна не сестра Бориса. Борис — брат Анны.',
    'Анна и Борис — родные сестра и брат. Они супруги.',
    'Анна и Борис — родные сестра и брат?',
    'Анна и Борис — родные сестра и брат...',
    'Анна и Борис — родные сестра и брат…',
    'Анна и Борис — родные сестра и брат..',
  ]) {
    const input = gold(); input.markup.relationships[0].description = text;
    assert.throws(() => evaluateMultichunkLiveAcceptance(input), /relationship meaning/);
  }
});

test('corrected relationship punctuation never waives missing Boris speech evidence', () => {
  const input = gold();
  input.markup.relationships[0].description += '.';
  input.markup.characters[1].speechExamples = [];
  assert.throws(() => evaluateMultichunkLiveAcceptance(input));
});
