import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import http from 'node:http';
import { createFixtureBridge, digest, MODEL } from './codex-fixture-bridge.mjs';

const body = JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'Own fixed QA fixture: say hello.' }] });
const success = text => `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } })}\n${JSON.stringify({ type: 'turn.completed' })}\n`;
function fakeRunner(action) {
  const calls = [];
  const spawnChild = (binary, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.killed = false; child.input = '';
    child.kill = signal => { child.killed = signal; setImmediate(() => child.emit('close', null)); };
    child.stdin = new Writable({ write(chunk, _enc, cb) { child.input += chunk; cb(); } });
    calls.push({ binary, args, options, child });
    child.stdin.on('finish', () => setImmediate(() => action?.(child)));
    return child;
  };
  return { calls, spawnChild };
}
async function setup(t, action, extras = {}, bodies = [body]) {
  const fake = fakeRunner(action);
  const bridge = await createFixtureBridge({ approvedHashes: bodies.map(digest), spawnChild: fake.spawnChild, ...extras });
  t.after(() => bridge.close());
  const request = (payload = body, headers = {}) => fetch(`${bridge.url}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json', ...headers }, body: payload,
  });
  return { ...bridge, ...fake, request };
}

test('approved exact body produces real JSON completion contract with pinned contained CLI args', async t => {
  const b = await setup(t, child => { child.stdout.write(success('Hello')); child.emit('close', 0); });
  const response = await b.request();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.object, 'chat.completion'); assert.equal(data.model, MODEL);
  assert.equal(data.choices[0].message.content, 'Hello'); assert.equal(data.choices[0].finish_reason, 'stop');
  assert.equal(data.usage, undefined); assert.equal(response.headers.get('access-control-allow-origin'), null);
  const call = b.calls[0];
  assert.equal(call.options.shell, false); assert.equal(call.options.detached, true);
  for (const arg of ['--ignore-user-config', '--strict-config', '--ephemeral', 'default_permissions="narra_fixture"', 'permissions.narra_fixture.network.enabled=false']) assert.ok(call.args.includes(arg));
  assert.ok(!call.args.includes('--sandbox'));
  assert.deepEqual(Object.keys(call.options.env).filter(k => !['PATH', 'HOME', 'CODEX_HOME', 'TMPDIR'].includes(k)), []);
  assert.ok(call.child.input.includes('Own fixed QA fixture'));
});

test('unknown bytes return only error code and hash, do not launch child', async t => {
  const b = await setup(t);
  const unknown = `${body} `;
  const response = await b.request(unknown);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: { code: 'request_not_approved', sha256: digest(unknown) } });
  assert.equal(b.calls.length, 0);
});

test('authentication and browser Origin are rejected before execution', async t => {
  const b = await setup(t);
  assert.equal((await b.request(body, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await b.request(body, { origin: 'http://example.invalid' })).status, 403);
  assert.equal(b.calls.length, 0);
});

for (const field of ['stream', 'tools', 'tool_choice', 'parallel_tool_calls']) {
  test(`approved request with ${field} gets explicit unsupported error`, async t => {
    const payload = JSON.stringify({ ...JSON.parse(body), [field]: field === 'stream' ? true : [] });
    const b = await setup(t, null, {}, [payload]);
    const response = await b.request(payload);
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'stream_and_tools_unsupported');
    assert.equal(b.calls.length, 0);
  });
}

test('actual structured-task body accepts stream:false and bounded advisory max_tokens', async t => {
  const payload = JSON.stringify({ ...JSON.parse(body), max_tokens: 8000, stream: false });
  const b = await setup(t, child => { child.stdout.write(success('Fixture')); child.emit('close', 0); }, {}, [payload]);
  assert.equal((await b.request(payload)).status, 200);
  assert.ok(b.calls[0].child.input.includes('advisory only'));
});

test('unsupported actual character-chat sampling options fail explicitly', async t => {
  const payload = JSON.stringify({ ...JSON.parse(body), temperature: 0.85, reasoning_effort: 'none' });
  const b = await setup(t, null, {}, [payload]);
  const response = await b.request(payload);
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'unsupported_parameter');
  assert.equal(b.calls.length, 0);
});

test('concurrent second request rejected; three lifetime calls maximum', async t => {
  const b = await setup(t);
  const first = b.request();
  while (!b.calls.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await b.request()).status, 409);
  b.calls[0].child.stdout.write(success('One')); b.calls[0].child.emit('close', 0);
  assert.equal((await first).status, 200);
  for (let i = 1; i < 3; i++) {
    const response = b.request();
    while (b.calls.length <= i) await new Promise(resolve => setImmediate(resolve));
    b.calls[i].child.stdout.write(success('More')); b.calls[i].child.emit('close', 0);
    assert.equal((await response).status, 200);
  }
  assert.equal((await b.request()).status, 429); assert.equal(b.calls.length, 3);
});

test('quota terminates child and permanently stops further calls without retry', async t => {
  const b = await setup(t, child => child.stderr.write('usage_limit_reached'));
  assert.equal((await b.request()).status, 429);
  assert.equal(b.calls[0].child.killed, 'SIGKILL');
  assert.equal((await b.request()).status, 429); assert.equal(b.calls.length, 1);
});

test('deadline kills child and returns gateway timeout', async t => {
  const b = await setup(t, null, { deadlineMs: 25 });
  const response = await b.request();
  assert.equal(response.status, 504); assert.equal((await response.json()).error.code, 'deadline_exceeded');
  assert.equal(b.calls[0].child.killed, 'SIGKILL');
});

test('combined output bound terminates child without exposing stderr', async t => {
  const b = await setup(t, child => child.stderr.write('x'.repeat(33)), { maxOutputBytes: 32 });
  const response = await b.request();
  assert.equal(response.status, 502); assert.equal((await response.json()).error.code, 'cli_output_limit');
  assert.equal(b.calls[0].child.killed, 'SIGKILL');
});

test('malformed and incomplete CLI output cannot masquerade as successful completion', async t => {
  for (const output of ['not json', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'partial' } })]) {
    const b = await setup(t, child => { child.stdout.write(output); child.emit('close', 0); });
    assert.equal((await b.request()).status, 502);
  }
});

test('disconnect cancels child', async t => {
  const b = await setup(t);
  const req = http.request(`${b.url}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${b.token}`, 'content-type': 'application/json' },
  });
  req.on('error', () => {}); req.end(body);
  while (!b.calls.length) await new Promise(resolve => setImmediate(resolve));
  req.destroy();
  for (let i = 0; i < 50 && !b.calls[0].child.killed; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(b.calls[0].child.killed, 'SIGKILL');
});

test('unsafe configured budgets fail before any listener starts', async () => {
  await assert.rejects(createFixtureBridge({ approvedHashes: [digest(body)], maxCalls: 4 }), /Unsafe limits/);
  await assert.rejects(createFixtureBridge({ approvedHashes: [] }), /approved SHA256/);
});

test('oversized HTTP input gets explicit 413 without child execution', async t => {
  const b = await setup(t);
  const response = await b.request('x'.repeat(32769));
  assert.equal(response.status, 413); assert.equal((await response.json()).error.code, 'request_too_large');
  assert.equal(b.calls.length, 0);
});

test('Russian completion survives split UTF8 child output', async t => {
  const b = await setup(t, child => {
    for (const byte of Buffer.from(success('Анна и Лев'))) child.stdout.write(Buffer.from([byte]));
    child.emit('close', 0);
  });
  assert.equal((await (await b.request()).json()).choices[0].message.content, 'Анна и Лев');
});

test('valid JSON primitive events return error without crashing HTTP process', async t => {
  for (const value of [null, 1, 'string', [], {}]) {
    const b = await setup(t, child => { child.stdout.write(`${JSON.stringify(value)}\n`); child.emit('close', 0); });
    const response = await b.request();
    assert.equal(response.status, 502); assert.equal((await response.json()).error.code, 'invalid_cli_event');
  }
});

test('close waits for delayed child reaping, not just kill delivery', async t => {
  const b = await setup(t);
  const pending = b.request().catch(() => null);
  while (!b.calls.length) await new Promise(resolve => setImmediate(resolve));
  const child = b.calls[0].child;
  child.kill = signal => { child.killed = signal; };
  let closed = false;
  const close = b.close().then(() => { closed = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(closed, false); assert.equal(child.killed, 'SIGKILL');
  child.emit('close', null);
  await close; await pending; assert.equal(closed, true);
});

test('CLI nonzero error exposes only known diagnostic class and exit code', async t => {
  const b = await setup(t, child => {
    child.stderr.write("sandbox-exec: execvp() of 'SECRET_SENTINEL' failed: Operation not permitted");
    child.emit('close', 71);
  });
  const response = await b.request();
  assert.deepEqual(await response.json(), { error: { code: 'cli_failed', diagnostic: { exitCode: 71, reason: 'sandbox_exec_denied' } } });
});
