import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createInternalGenerationService } from '../internal-generation-service.mjs';
import { BOOK_ANALYSIS_SYNTHESIS_VERSION } from '../book-analysis-contracts.mjs';

const dialogue = 'Борис ответил: «Хорошо, Анна».';
function fixture(rows = [{ type: 'character_dialogue', quote: dialogue }]) {
  let text = '';
  const evidence = rows.map(row => {
    const startOffset = text.length; text += `${row.quote}\n`;
    return { id: randomUUID(), type: row.type, quote: row.quote, fact: 'Подтверждённый факт о Борисе', startOffset, endOffset: text.length - 1, confidence: 0.91, ...row };
  });
  const runId = randomUUID(); const snapshotId = randomUUID();
  return { idempotencyKey: `${runId}:synthesize:${snapshotId}:character:boris:${BOOK_ANALYSIS_SYNTHESIS_VERSION}`, runId, snapshotId,
    synthesisVersion: BOOK_ANALYSIS_SYNTHESIS_VERSION, bookTitle: 'Своя QA история', bookAuthor: 'QA', textLength: text.length,
    entity: { entityKey: 'character:boris', entityKind: 'character', canonicalName: 'Борис', aliases: [], resolutionStatus: 'confirmed', confidence: 1, evidenceIds: evidence.map(row => row.id), data: { firstEvidenceStartOffset: 0 } }, evidence };
}
function runtime({ examples = [], omitExamples = false } = {}) {
  const calls = []; const logs = []; const objects = new Map();
  const unused = async () => { throw new Error('Unexpected media'); };
  const service = createInternalGenerationService({
    storage: { async getBytes({ objectKey }) { if (!objects.has(objectKey)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' }); return { bytes: objects.get(objectKey) }; },
      async putBytes({ objectKey, bytes }) { objects.set(objectKey, Buffer.from(bytes)); return { objectKey }; } },
    logger: { info(...args) { logs.push(args); }, warn() {}, error() {} },
    async completeChat(input) {
      const operation = input.costContext.operation; calls.push(operation);
      if (operation === 'recall_character_traits') return '{"traits":[]}';
      if (operation === 'audit_character_profile') return '{"traits":[],"description":null}';
      assert.equal(operation, 'synthesize_character_profile', 'fallback must not add model calls');
      const line = input.messages[1].content.split('\n').find(value => value.startsWith('PERSONALITY_CHECKPOINTS: '));
      const checkpoints = line ? JSON.parse(line.slice('PERSONALITY_CHECKPOINTS: '.length)) : [];
      // Captured Boris step7 shape: all profile fields present, empty examples
      // despite dialogue in EVIDENCE; synthetic IDs rather than live UUIDs.
      return JSON.stringify({ role: null, age: null, gender: null, description: null, traits: [],
        personalitySnapshots: checkpoints.map(item => ({ cutoffTextOffset: item.cutoffTextOffset, traits: [] })),
        appearance: [], speechStyle: null, ...(omitExamples ? {} : { speechExamples: examples }),
        creative: { greeting: 'Здравствуйте. Чем могу помочь?', appearancePrompt: '', voice: 'Che' } });
    }, generatePortrait: unused, synthesizeSpeech: unused, generateIdleAnimation: unused,
  });
  return { service, calls, logs };
}
const expectedCalls = ['synthesize_character_profile', 'recall_character_traits', 'audit_character_profile'];

for (const omitExamples of [false, true]) test(`actual profile recovers the whole own quote when examples ${omitExamples ? 'are omitted' : 'are empty'}`, async () => {
  const request = fixture(); const r = runtime({ omitExamples });
  const result = await r.service.synthesizeCharacterProfile(request);
  assert.deepEqual(result.profile.speechExamples, [{ value: dialogue, evidenceIds: [request.evidence[0].id], confidence: 0.91 }]);
  assert.equal(result.profile.speechStyle, null, 'one quote does not establish a speaking style');
  assert.deepEqual(r.calls, expectedCalls);
  assert.deepEqual(await r.service.synthesizeCharacterProfile(request), result);
  assert.deepEqual(r.calls, expectedCalls, 'cache replay adds no calls');
  const stats = r.logs.flat().find(line => line.includes('event="synthesis.character_completed"'));
  assert.match(stats, /provider_claim_count=0/); assert.match(stats, /accepted_claim_count=0/);
});

test('preserves an accepted model example instead of appending or replacing it', async () => {
  const request = fixture();
  const examples = [{ value: 'Хорошо, Анна', evidenceIds: [request.evidence[0].id], confidence: 0.8 }];
  const r = runtime({ examples });
  assert.deepEqual((await r.service.synthesizeCharacterProfile(request)).profile.speechExamples, examples);
  assert.deepEqual(r.calls, expectedCalls);
});

test('fallback ignores non-dialogue, inconsistent spans and oversized quotes without truncation', async () => {
  const request = fixture([
    { type: 'character_action', quote: 'Борис положил ключ.' },
    { type: 'character_dialogue', quote: 'Борис сказал: «Нет».', endOffset: 25 },
    { type: 'character_dialogue', quote: 'я'.repeat(4001) },
    { type: 'character_dialogue', quote: dialogue },
  ]);
  const r = runtime(); const result = await r.service.synthesizeCharacterProfile(request);
  assert.deepEqual(result.profile.speechExamples.map(row => row.value), [dialogue]);
  assert.deepEqual(result.profile.speechExamples[0].evidenceIds, [request.evidence[3].id]);
  assert.deepEqual(r.calls, expectedCalls);
});

test('deduplicates exact quotes, orders by source offset and bounds fallback to three', async () => {
  const request = fixture([dialogue, dialogue, 'Борис сказал: «Да».', 'Борис сказал: «Спасибо».', 'Борис сказал: «Пора».'].map(quote => ({ type: 'character_dialogue', quote })));
  const expectedIds = [request.evidence[0].id, request.evidence[2].id, request.evidence[3].id];
  request.evidence.reverse();
  const r = runtime(); const result = await r.service.synthesizeCharacterProfile(request);
  assert.deepEqual(result.profile.speechExamples.flatMap(row => row.evidenceIds), expectedIds);
  assert.deepEqual(r.calls, expectedCalls);
});

test('no dialogue leaves examples empty; foreign model IDs cannot become fallback evidence', async () => {
  const request = fixture([{ type: 'character_action', quote: 'Борис закрыл окно.' }]);
  const r = runtime({ examples: [{ value: 'Чужая реплика', evidenceIds: [randomUUID()], confidence: 1 }] });
  assert.deepEqual((await r.service.synthesizeCharacterProfile(request)).profile.speechExamples, []);
  assert.deepEqual(r.calls, expectedCalls);
});

for (const invalid of ['foreign-owner', 'negative', 'beyond-text']) test(`invalid ${invalid} input is rejected before model execution`, async () => {
  const request = fixture(); const r = runtime();
  if (invalid === 'foreign-owner') request.entity.evidenceIds = [randomUUID()];
  if (invalid === 'negative') request.evidence[0].startOffset = -1;
  if (invalid === 'beyond-text') request.evidence[0].endOffset = request.textLength + 1;
  await assert.rejects(r.service.synthesizeCharacterProfile(request)); assert.deepEqual(r.calls, []);
});
