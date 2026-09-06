// Offline replay of one authored fixture. Never repairs recorded model mistakes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createStableBookChunks } from '../../services/narra-gateway/book-analysis-chunking.mjs';
import { MULTICHUNK_FIXTURE } from './multichunk-book-fixture.mjs';

function readRecording(recording) {
  assert.ok(['2026-09-05', '2026-09-06'].includes(recording), 'Unknown fixed recording');
  const recorded = JSON.parse(readFileSync(new URL(`../../docs/reviews/evidence/subscription-multichunk-live-${recording}.json`, import.meta.url), 'utf8'));
  assert.equal(recorded.fixtureId, 'siblings');
  assert.equal(recorded.fixtureHash, createHash('sha256').update(MULTICHUNK_FIXTURE).digest('hex'));
  assert.equal(recorded.steps.length, 9);
  const chunks = createStableBookChunks({ runId: 'recorded-replay-geometry', text: MULTICHUNK_FIXTURE });
  assert.equal(chunks.length, 3);
  for (const [index, chunk] of chunks.entries()) {
    for (const [field, column] of [['coreStartOffset','core_start_offset'],['coreEndOffset','core_end_offset'],['contextStartOffset','context_start_offset'],['contextEndOffset','context_end_offset']]) {
      assert.equal(chunk[field], Number(recorded.chunks[index][column]), 'Recorded chunk geometry changed');
    }
  }
  if (recording === '2026-09-06') {
    for (const step of recorded.steps) {
      assert.equal(step.response.choices.length, 1);
      assert.equal(step.response.choices[0].finish_reason, 'stop');
      step.response = JSON.parse(step.response.choices[0].message.content);
    }
  }
  return { recorded, chunks };
}
const key = (type, quote, owner) => JSON.stringify([type, quote, owner]);
function field(content, name) {
  const lines = content.split('\n').filter(line => line.startsWith(`${name}: `));
  assert.equal(lines.length, 1, `Expected exactly one ${name}`);
  return JSON.parse(lines[0].slice(name.length + 2));
}

export function createRecordedMultichunkModel(calls = [], { recording = '2026-09-05' } = {}) {
  assert.ok(Array.isArray(calls));
  const { recorded, chunks } = readRecording(recording);
  const used = new Set();
  return async function completeChat(input) {
    assert.ok(used.size < 9, 'Recorded call budget exceeded');
    const operation = input.costContext?.operation;
    const content = input.messages?.[1]?.content;
    assert.equal(typeof content, 'string');
    let step; let response;
    if (operation === 'scan_book_chunk') {
      const match = content.match(/(?:^|\n)CONTEXT_TEXT_BEGIN\n([\s\S]*)\nCONTEXT_TEXT_END$/);
      assert.ok(match, 'Missing structured scan context');
      const matches = chunks.filter(chunk => MULTICHUNK_FIXTURE.slice(chunk.contextStartOffset, chunk.contextEndOffset) === match[1]);
      assert.equal(matches.length, 1, 'Unknown scan context');
      step = recorded.steps.find(item => item.phase === operation && item.subject.ordinal === matches[0].ordinal);
      response = step?.response;
    } else {
      assert.ok(['synthesize_character_profile','recall_character_traits','audit_character_profile'].includes(operation), 'Unknown recorded phase');
      const character = field(content, 'CHARACTER');
      step = recorded.steps.find(item => item.phase === operation && item.subject.character === character.canonicalName);
      assert.ok(step, 'Unknown character identity');
      assert.equal(character.entityKey, step.subject.entityKey, 'Character identity key mismatch');
      const evidence = field(content, 'EVIDENCE');
      assert.ok(Array.isArray(evidence));
      const current = new Map(); const ids = new Set();
      for (const item of evidence) {
        assert.ok(typeof item.id === 'string' && item.id.length > 0 && !ids.has(item.id), 'Ambiguous evidence ID');
        ids.add(item.id);
        const identity = key(item.type, item.quote, character.canonicalName);
        assert.ok(!current.has(identity), 'Ambiguous evidence mapping');
        assert.ok(recorded.observations.some(old => key(old.observation_type,old.evidence_quote,old.entity_candidate) === identity), 'Unknown evidence identity');
        current.set(identity, item.id);
      }
      const mapping = new Map();
      for (const old of recorded.observations) {
        const id = current.get(key(old.observation_type, old.evidence_quote, old.entity_candidate));
        if (id) mapping.set(old.id, id);
      }
      const replace = (value, property) => {
        if (Array.isArray(value)) {
          if (property === 'evidenceIds') return value.map(id => {
            assert.ok(mapping.has(id), `Missing evidence mapping: ${id}`);
            return mapping.get(id);
          });
          return value.map(item => replace(item));
        }
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,replace(v,k)]));
        return value;
      };
      response = replace(step.response);
      if (operation === 'audit_character_profile') {
        const candidate = field(content, 'CANDIDATE_PROFILE');
        const synthesis = recorded.steps.find(item => item.phase === 'synthesize_character_profile' && item.subject.character === character.canonicalName);
        const expected = replace(synthesis.response).traits;
        assert.deepEqual(candidate.traits?.map(trait => trait.evidenceIds), expected.map(trait => trait.evidenceIds), 'Audit candidate order/evidence changed');
      }
    }
    assert.ok(step && response, 'Missing recorded response');
    assert.ok(!used.has(step.index), 'Duplicate recorded phase/subject');
    used.add(step.index);
    calls.push({ operation, recordedStep: step.index, messagesBytes: Buffer.byteLength(JSON.stringify(input.messages)) });
    return JSON.stringify(response);
  };
}
