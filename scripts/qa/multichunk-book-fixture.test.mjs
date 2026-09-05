import test from 'node:test';
import assert from 'node:assert/strict';
import { createStableBookChunks } from '../../services/narra-gateway/book-analysis-chunking.mjs';
import { MULTICHUNK_FIXTURE, MULTICHUNK_FACTS, assertMultichunkAcceptance } from './multichunk-book-fixture.mjs';
import { runPipelineCanary } from './book-analysis-pipeline-canary.mjs';

function gold() {
  const chunks = createStableBookChunks({ runId: 'gold', text: MULTICHUNK_FIXTURE }).map(item => ({
    core_start_offset: item.coreStartOffset, core_end_offset: item.coreEndOffset,
  }));
  const observations = MULTICHUNK_FACTS.map((item, index) => ({
    id: `fact-${index}`, entity_candidate: item.entityCandidate, observation_type: item.type,
    evidence_quote: item.evidence.quote, evidence_start_offset: MULTICHUNK_FIXTURE.indexOf(item.evidence.quote),
    evidence_end_offset: MULTICHUNK_FIXTURE.indexOf(item.evidence.quote) + item.evidence.quote.length,
  }));
  const characters = ['Анна', 'Борис'].map(name => {
    const ownTraits = observations.filter(item => item.observation_type === 'character_trait' && item.entity_candidate === name);
    const traits = ownTraits.map(item => ({
      value: /любознатель/u.test(item.evidence_quote) ? 'любознательная' : name === 'Анна' ? 'честная' : 'терпеливый',
      evidenceIds: [item.id],
    }));
    return { name, characterKey: name, traits, personalitySnapshots: [
      { cutoffTextOffset: 100, traits: traits.filter(item => observations.find(row => row.id === item.evidenceIds[0]).evidence_end_offset <= 100) },
      { cutoffTextOffset: MULTICHUNK_FIXTURE.length, traits },
    ] };
  });
  return { chunks, observations, profiles: [{}, {}], markup: { characters, relationships: [{ sourceCharacterKey: 'Анна', targetCharacterKey: 'Борис' }] } };
}

test('authored fixture crosses three default cores with actual duplicated overlap evidence', () => {
  const chunks = createStableBookChunks({ runId: 'geometry', text: MULTICHUNK_FIXTURE });
  assert.equal(chunks.length, 3);
  const contexts = chunks.map(item => MULTICHUNK_FIXTURE.slice(item.contextStartOffset, item.contextEndOffset));
  assert.ok(MULTICHUNK_FACTS.some(item => contexts.filter(context => context.includes(item.evidence.quote)).length > 1));
  assert.doesNotThrow(() => assertMultichunkAcceptance(gold()));
});

test('multi-chunk acceptance rejects dropped/duplicate facts, lost relation, gaps, mixed identities and future leakage', () => {
  const mutations = [
    input => input.observations.pop(),
    input => input.observations.push(input.observations[0]),
    input => { input.observations[0].evidence_start_offset++; },
    input => { input.chunks[1].core_start_offset++; },
    input => { input.markup.relationships = []; },
    input => { input.markup.characters[0].traits[0].evidenceIds = ['fact-1']; },
    input => { input.markup.characters[0].traits[0].value = 'тревожная'; },
    input => { input.markup.characters[0].traits[0].evidenceIds = ['fact-3']; },
    input => { input.markup.characters[0].personalitySnapshots[0].traits = [{ value: 'любознательная', evidenceIds: ['fact-0'] }]; },
    input => { input.markup.characters[0].personalitySnapshots[0].traits = input.markup.characters[0].traits; },
    input => { input.markup.characters[0].personalitySnapshots = input.markup.characters[0].personalitySnapshots.slice(1); },
  ];
  for (const mutate of mutations) {
    const input = gold(); mutate(input);
    assert.throws(() => assertMultichunkAcceptance(input));
  }
});

test('multi-chunk never enables a live provider implicitly', async () => {
  await assert.rejects(runPipelineCanary({ fixtureId: 'unknown' }), /Unknown own fixture/);
  await assert.rejects(runPipelineCanary({ fixtureId: 'siblings', stagedLive: true }), /mock-only/);
  await assert.rejects(runPipelineCanary({ fixtureId: 'siblings', stagedMock: true }), /mock-only/);
});

test('three default chunks -> actual PostgreSQL workers -> two grounded profiles -> publication, replay idle', {
  skip: !process.env.QA_MULTI_DB_URL ? 'requires fresh dedicated QA_MULTI_DB_URL and QA_MULTI_DB_CONFIRM' : false,
  timeout: 60000,
}, async () => {
  const result = await runPipelineCanary({ fixtureId: 'siblings', databaseUrl: process.env.QA_MULTI_DB_URL, confirmation: process.env.QA_MULTI_DB_CONFIRM });
  assert.equal(result.live, false);
  assert.equal(result.chunkCount, 3);
  assert.equal(result.characterCount, 2);
  assert.equal(result.jobsCompleted, 10);
  assert.equal(result.observations, 11);
  assert.equal(result.calls.length, 9);
  assert.deepEqual(result.traits.sort(), ['любознательная', 'терпеливый', 'честная']);
  assert.equal(result.publications, 1);
  assert.equal(result.idempotent, true);
});
