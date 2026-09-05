import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStableBookChunks } from '../../services/narra-gateway/book-analysis-chunking.mjs';
import { MULTICHUNK_FIXTURE } from './multichunk-book-fixture.mjs';
import { createRecordedMultichunkModel } from './recorded-multichunk-model.mjs';
const artifact = JSON.parse(readFileSync(new URL('../../docs/reviews/evidence/subscription-multichunk-live-2026-09-05.json', import.meta.url)));
const request = (phase, name, mutate = x => x) => {
  const step = artifact.steps.find(s => s.phase === phase && s.subject.character === name);
  const evidence = artifact.observations.filter(o => o.entity_candidate === name).map(o => ({id:`fresh-${o.id}`,type:o.observation_type,quote:o.evidence_quote}));
  const synthesis = artifact.steps.find(s => s.phase === 'synthesize_character_profile' && s.subject.character === name);
  const candidate = synthesis && JSON.parse(JSON.stringify(synthesis.response).replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g,id=>`fresh-${id}`));
  const data = mutate({character:{canonicalName:name,entityKey:step?.subject.entityKey},evidence,candidate});
  return {costContext:{operation:phase},messages:[{content:''},{content:`CHARACTER: ${JSON.stringify(data.character)}\nEVIDENCE: ${JSON.stringify(data.evidence)}\nCANDIDATE_PROFILE: ${JSON.stringify(data.candidate)}`}]};
};
test('replays nine captured outputs, remaps nested IDs, preserves missing Boris speech and audit indices', async () => {
  const calls=[]; const model=createRecordedMultichunkModel(calls);
  for(const chunk of createStableBookChunks({runId:'fresh',text:MULTICHUNK_FIXTURE}).reverse()) {
    const context=MULTICHUNK_FIXTURE.slice(chunk.contextStartOffset,chunk.contextEndOffset);
    const got=JSON.parse(await model({costContext:{operation:'scan_book_chunk'},messages:[{content:''},{content:`CONTEXT_TEXT_BEGIN\n${context}\nCONTEXT_TEXT_END`}]}));
    assert.deepEqual(got,artifact.steps.find(s=>s.phase==='scan_book_chunk'&&s.subject.ordinal===chunk.ordinal).response);
  }
  for(const name of ['Анна','Борис']) for(const phase of ['synthesize_character_profile','recall_character_traits','audit_character_profile']) {
    const got=JSON.parse(await model(request(phase,name)));
    const old=artifact.steps.find(s=>s.phase===phase&&s.subject.character===name).response;
    const expected=JSON.parse(JSON.stringify(old).replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g,id=>`fresh-${id}`));
    assert.deepEqual(got,expected);
    if(name==='Борис'&&phase==='synthesize_character_profile') assert.deepEqual(got.speechExamples,[]);
  }
  assert.equal(calls.length,9);
  await assert.rejects(model(request('recall_character_traits','Анна')),/budget|duplicate/i);
});
test('fails closed on unknown context, phase, identity, missing/ambiguous mapping and changed audit order', async () => {
  const cases=[
    {costContext:{operation:'scan_book_chunk'},messages:[{content:''},{content:'CONTEXT_TEXT_BEGIN\nwrong\nCONTEXT_TEXT_END'}]},
    request('unknown','Анна'),
    request('synthesize_character_profile','Ева'),
    request('synthesize_character_profile','Анна',x=>({...x,character:{...x.character,entityKey:'wrong'}})),
    request('synthesize_character_profile','Анна',x=>({...x,evidence:[]})),
    request('synthesize_character_profile','Анна',x=>({...x,evidence:x.evidence.map((e,i)=>i?e:{...e,quote:'foreign book'})})),
    request('synthesize_character_profile','Анна',x=>({...x,evidence:x.evidence.map((e,i)=>i?e:{...e,id:x.evidence[1].id})})),
    request('synthesize_character_profile','Анна',x=>({...x,evidence:[...x.evidence,x.evidence[0]]})),
    request('audit_character_profile','Анна',x=>({...x,candidate:{...x.candidate,traits:[...x.candidate.traits].reverse()}})),
  ];
  for(const input of cases) await assert.rejects(createRecordedMultichunkModel()(input));
});
test('fresh replay instances do not mutate artifact, input or share consumed steps', async () => {
  const before=JSON.stringify(artifact);
  const input=request('synthesize_character_profile','Борис');
  const inputBefore=JSON.stringify(input);
  const first=createRecordedMultichunkModel();
  const response=await first(input);
  await assert.rejects(first(input),/Duplicate/);
  const parsed=JSON.parse(response); parsed.speechExamples.push({value:'invented'});
  assert.equal(await createRecordedMultichunkModel()(input),response);
  assert.equal(JSON.stringify(input),inputBefore);
  assert.equal(JSON.stringify(artifact),before);
  assert.equal(JSON.stringify(JSON.parse(readFileSync(new URL('../../docs/reviews/evidence/subscription-multichunk-live-2026-09-05.json',import.meta.url)))),before);
});
