import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile, writeFile, rm, access, chmod, link } from 'node:fs/promises';
import { createStagedFixtureProvider, STAGED_OPERATIONS, STAGED_FIXTURE } from './staged-fixture-provider.mjs';
import { MULTICHUNK_FIXTURE } from './multichunk-book-fixture.mjs';
import { createStableBookChunks } from '../../services/narra-gateway/book-analysis-chunking.mjs';
import { extractStructuredBookText } from '../../services/narra-gateway/book-source-text.mjs';

function childRunner(mode = 'success') {
  const calls = [];
  return { calls, spawnFixtureChild(_binary, _args, options) {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null)); };
    child.stdin.on('finish', () => setImmediate(() => {
      if (mode === 'quota') return child.stderr.write('usage_limit_reached');
      if (mode === 'hold') return;
      child.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}\n{"type":"turn.completed"}\n');
      child.emit('close', 0);
    }));
    calls.push({ child, cwd: options.cwd });
    return child;
  } };
}
const input = index => ({ messages: [{ role: 'user', content: `BOOK_TITLE: Окно\nCONTEXT_TEXT_BEGIN\n${STAGED_FIXTURE}\nCONTEXT_TEXT_END` }],
  costContext: { analysisRunId: 'own-run', operation: STAGED_OPERATIONS[index] } });
async function setup(t, options = {}) {
  const runner = childRunner(options.behavior);
  const captures = [];
  const provider = await createStagedFixtureProvider({ ...runner, approvalTimeoutMs: 1000, ...options, onCapture: item => captures.push(item) });
  t.after(async () => { await provider.close(); await rm(provider.directory, { recursive: true, force: true }); });
  async function captured(index) {
    for (let n = 0; n < 100 && !captures[index]; n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(captures[index]);
    return JSON.parse(await readFile(captures[index].manifestFile, 'utf8'));
  }
  return { provider, runner, captured };
}
// Explicit external test actor, not part of the controller being tested.
async function approve(manifest, overrides = {}) {
  await writeFile(manifest.approvalFile, JSON.stringify({ approved: true, index: manifest.index, sha256: manifest.sha256, nonce: manifest.nonce, ...overrides }), { mode: 0o600, flag: 'wx' });
}

test('exact four phases require four separate approvals and preserve prior evidence outside child roots', async t => {
  const { provider, runner, captured } = await setup(t);
  for (let index = 0; index < 4; index++) {
    const pending = provider.completeChat(input(index));
    const manifest = await captured(index);
    assert.equal(runner.calls.length, index, 'capture must not start model execution');
    await assert.rejects(access(manifest.approvalFile));
    assert.equal(manifest.phase, STAGED_OPERATIONS[index]);
    if (index) assert.ok(JSON.parse(await readFile(manifest.priorResponseFile, 'utf8')).choices);
    await approve(manifest);
    assert.equal(await pending, '{"ok":true}');
    assert.equal(runner.calls.length, index + 1);
    assert.ok(!provider.directory.startsWith(runner.calls[index].cwd));
  }
  await assert.rejects(provider.completeChat(input(0)), /stopped|extra/);
  assert.equal(runner.calls.length, 4);
});

test('wrong approval SHA latches failure without any model call or retry', async t => {
  const { provider, runner, captured } = await setup(t);
  const pending = provider.completeChat(input(0));
  const rejected = assert.rejects(pending, /does not match/);
  await approve(await captured(0), { sha256: '0'.repeat(64) });
  await rejected;
  await assert.rejects(provider.completeChat(input(0)), /stopped/);
  assert.equal(runner.calls.length, 0);
  const failure = JSON.parse(await readFile(`${provider.directory}/failure.json`, 'utf8'));
  assert.deepEqual(failure, { stage: 'approval', category: 'approval_mismatch', startedCalls: 0 });
});

test('non-private approval preserves a safe diagnostic without launching CLI', async t => {
  const { provider, runner, captured } = await setup(t);
  const pending = provider.completeChat(input(0));
  const rejected = assert.rejects(pending, /private regular file/);
  const manifest = await captured(0);
  const candidate = `${manifest.approvalFile}.candidate`;
  await writeFile(candidate, JSON.stringify({ approved: true, index: 1, sha256: manifest.sha256, nonce: manifest.nonce }), { mode: 0o644, flag: 'wx' });
  await chmod(candidate, 0o644);
  await link(candidate, manifest.approvalFile);
  await rejected;
  assert.equal(runner.calls.length, 0);
  const failure = JSON.parse(await readFile(`${provider.directory}/failure.json`, 'utf8'));
  assert.deepEqual(failure, { stage: 'approval', category: 'approval_file_unsafe', startedCalls: 0 });
});

test('post-capture body edits fail closed before execution', async t => {
  const { provider, runner, captured } = await setup(t);
  const pending = provider.completeChat(input(0));
  const rejected = assert.rejects(pending, /changed after review/);
  const manifest = await captured(0);
  await writeFile(manifest.bodyFile, '{}'); await approve(manifest); await rejected;
  assert.equal(runner.calls.length, 0);
});

test('approval deadline and cancellation stop waiting without model execution', async t => {
  const timed = await setup(t, { approvalTimeoutMs: 20 });
  await assert.rejects(timed.provider.completeChat(input(0)), /deadline/);
  assert.equal(timed.runner.calls.length, 0);
  const cancelled = await setup(t);
  const pending = cancelled.provider.completeChat(input(0));
  const rejected = assert.rejects(pending, /closed|aborted/);
  await cancelled.captured(0); await cancelled.provider.close(); await rejected;
  assert.equal(cancelled.runner.calls.length, 0);
});

test('quota stops the whole campaign after a single approved call', async t => {
  const { provider, runner, captured } = await setup(t, { behavior: 'quota' });
  const pending = provider.completeChat(input(0));
  const rejected = assert.rejects(pending, /HTTP 429/);
  await approve(await captured(0)); await rejected;
  await assert.rejects(provider.completeChat(input(1)), /stopped/);
  assert.equal(runner.calls.length, 1);
});

test('closing an executing approved step kills its mock CLI and drains activity', async t => {
  const { provider, runner, captured } = await setup(t, { behavior: 'hold' });
  const pending = provider.completeChat(input(0));
  const rejected = assert.rejects(pending);
  await approve(await captured(0));
  for (let n = 0; n < 100 && !runner.calls.length; n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(runner.calls.length, 1);
  await provider.close(); await rejected;
  assert.equal(runner.calls[0].child.killed, true);
  assert.equal(provider.status().active, false);
});

test('unapproved sequence/fixture and absent mock executor cannot activate models', async t => {
  await assert.rejects(createStagedFixtureProvider(), /MOCK mode/);
  const { provider, runner } = await setup(t);
  await assert.rejects(provider.completeChat(input(1)), /Unexpected pipeline phase/);
  assert.equal(runner.calls.length, 0);
});

test('explicit live mode captures but never executes without an external approval', async t => {
  let capture;
  const provider = await createStagedFixtureProvider({ mode: 'live', approvalTimeoutMs: 30, onCapture: metadata => { capture = metadata; } });
  t.after(async () => { await provider.close(); await rm(provider.directory, { recursive: true, force: true }); });
  // No approval is created in this test. Timeout occurs before bridge creation.
  await assert.rejects(provider.completeChat(input(0)), /Approval deadline/);
  assert.equal(provider.status().calls, 0);
  const manifest = JSON.parse(await readFile(capture.manifestFile, 'utf8'));
  assert.equal(manifest.mode, 'live');
  await assert.rejects(access(manifest.approvalFile));
});

test('live rejects every mock injection and unknown mode; other fixture content is refused', async t => {
  await assert.rejects(createStagedFixtureProvider({ mode: 'live', spawnFixtureChild: () => assert.fail('must not execute') }), /rejects mock/);
  await assert.rejects(createStagedFixtureProvider({ mode: 'live', spawnFixtureChild: null }), /rejects mock/);
  await assert.rejects(createStagedFixtureProvider({ mode: 'automatic' }), /Invalid staged mode/);
  const { provider, runner } = await setup(t);
  const changed = input(0);
  changed.messages[0].content = changed.messages[0].content.replace(STAGED_FIXTURE, `${STAGED_FIXTURE} Другая книга.`);
  await assert.rejects(provider.completeChat(changed), /exact own fixture/);
  assert.equal(runner.calls.length, 0);
});

async function siblingsInputs() {
  const structured = await extractStructuredBookText({ bytes: Buffer.from(MULTICHUNK_FIXTURE), format: 'txt', mimeType: 'text/plain' });
  const chunks = createStableBookChunks({ runId: 'siblings-run', text: structured.text, sections: structured.sections });
  assert.equal(chunks.length, 3);
  const scans = chunks.map(chunk => ({
    messages: [{ role: 'system', content: 'Fixture test scan' }, { role: 'user', content: `BOOK_TITLE: Siblings\nCORE_LOCAL_RANGE: ${chunk.coreStartOffset - chunk.contextStartOffset}-${chunk.coreEndOffset - chunk.contextStartOffset}\nCONTEXT_TEXT_BEGIN\n${structured.text.slice(chunk.contextStartOffset, chunk.contextEndOffset)}\nCONTEXT_TEXT_END` }],
    costContext: { analysisRunId: 'siblings-run', operation: 'scan_book_chunk', metadata: { chunk_id: chunk.id, adaptive_part: null } },
  }));
  const profiles = ['Борис', 'Анна'].flatMap(name => STAGED_OPERATIONS.slice(1).map(operation => ({
    messages: [{ role: 'user', content: `CHARACTER: ${JSON.stringify({ canonicalName: name, entityKey: `character:${name}` })}\nEVIDENCE: []` }],
    costContext: { analysisRunId: 'siblings-run', operation, metadata: { entity_key: `character:${name}` } },
  })));
  return [...[scans[2], scans[0], scans[1]], ...profiles];
}
async function approvedStep(runtime, request, index) {
  const pending = runtime.provider.completeChat(request);
  const manifest = await runtime.captured(index);
  assert.equal(runtime.runner.calls.length, index, 'no execution before separate approval');
  await approve(manifest);
  await pending;
  return manifest;
}

test('siblings fixed plan accepts three unique unordered default chunks then two complete profile triplets', async t => {
  const runtime = await setup(t, { fixtureId: 'siblings' });
  const requests = await siblingsInputs();
  for (let index = 0; index < requests.length; index++) {
    const manifest = await approvedStep(runtime, requests[index], index);
    assert.equal(manifest.fixtureId, 'siblings'); assert.equal(manifest.maxCalls, 9);
    assert.equal(manifest.runId, 'siblings-run');
    assert.ok(Buffer.byteLength(await readFile(manifest.bodyFile)) <= 32768);
    if (index < 3) assert.equal(manifest.subject.ordinal, [2, 0, 1][index]);
    else assert.equal(manifest.subject.character, index < 6 ? 'Борис' : 'Анна');
  }
  assert.equal(runtime.runner.calls.length, 9);
  await assert.rejects(runtime.provider.completeChat(requests[0]), /extra|stopped/);
  assert.equal(runtime.runner.calls.length, 9);
});

test('siblings duplicate chunk is terminal even with unused call budget', async t => {
  const runtime = await setup(t, { fixtureId: 'siblings' });
  const requests = await siblingsInputs();
  await approvedStep(runtime, requests[0], 0);
  await assert.rejects(runtime.provider.completeChat(requests[0]), /Duplicate fixture chunk/);
  await assert.rejects(runtime.provider.completeChat(requests[1]), /stopped/);
  assert.equal(runtime.runner.calls.length, 1);
});

for (const mutation of ['context', 'core', 'chunkId', 'adaptive', 'run']) {
  test(`siblings refuses wrong ${mutation} before capture or execution`, async t => {
    const runtime = await setup(t, { fixtureId: 'siblings' });
    const requests = await siblingsInputs();
    const bad = structuredClone(requests[1]);
    if (mutation === 'context') bad.messages[1].content = bad.messages[1].content.replace('CONTEXT_TEXT_END', 'foreign\nCONTEXT_TEXT_END');
    if (mutation === 'core') bad.messages[1].content = bad.messages[1].content.replace(/CORE_LOCAL_RANGE: \d+-\d+/, 'CORE_LOCAL_RANGE: 0-1');
    if (mutation === 'chunkId') bad.costContext.metadata.chunk_id = 'other';
    if (mutation === 'adaptive') bad.costContext.metadata.adaptive_part = 1;
    if (mutation === 'run') { await approvedStep(runtime, requests[0], 0); bad.costContext.analysisRunId = 'other-run'; }
    await assert.rejects(runtime.provider.completeChat(bad), /exact default|identity changed/);
    assert.equal(runtime.runner.calls.length, mutation === 'run' ? 1 : 0);
  });
}

test('siblings rejects early synthesis and unknown caller-defined plan', async t => {
  assert.throws(() => { STAGED_OPERATIONS[0] = 'arbitrary_operation'; }, TypeError);
  await assert.rejects(createStagedFixtureProvider({ fixtureId: { phases: [] } }), /Unknown fixed/);
  const runtime = await setup(t, { fixtureId: 'siblings' });
  await assert.rejects(runtime.provider.completeChat((await siblingsInputs())[3]), /Unexpected pipeline phase/);
  assert.equal(runtime.runner.calls.length, 0);
});

test('siblings prevents crossing characters inside a synthesis triplet', async t => {
  const runtime = await setup(t, { fixtureId: 'siblings' });
  const requests = await siblingsInputs();
  for (let i = 0; i < 4; i++) await approvedStep(runtime, requests[i], i);
  await assert.rejects(runtime.provider.completeChat(requests[7]), /Character changed/);
  assert.equal(runtime.runner.calls.length, 4);
});

test('siblings rejects repeating a completed character instead of the second character', async t => {
  const runtime = await setup(t, { fixtureId: 'siblings' });
  const requests = await siblingsInputs();
  for (let i = 0; i < 6; i++) await approvedStep(runtime, requests[i], i);
  await assert.rejects(runtime.provider.completeChat(requests[3]), /Duplicate fixture character/);
  assert.equal(runtime.runner.calls.length, 6);
});
