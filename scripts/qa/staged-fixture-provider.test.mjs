import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile, writeFile, rm, access } from 'node:fs/promises';
import { createStagedFixtureProvider, STAGED_OPERATIONS, STAGED_FIXTURE } from './staged-fixture-provider.mjs';

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
