import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { approvedFixture, APPROVED_SHA256, runGatewayHttpCanary, mockFixtureChild } from './gateway-http-canary.mjs';

test('character fixture sends the real mounted mobile request through authenticated HTTP', async () => {
  const tracker = gatewayTracker();
  let calls = 0;
  const reply = 'Я заметила течь и позвала Льва: он принёс доску, чтобы помочь.';
  const result = await runGatewayHttpCanary({ fixtureId: 'character-chat',
    spawnGatewayChild: tracker.spawnGatewayChild,
    spawnFixtureChild() {
      calls++;
      return heldChild(child => {
        child.stdout.end(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: reply } })}\n${JSON.stringify({ type: 'turn.completed' })}\n`);
        child.emit('close', 0);
      });
    },
  });
  assert.equal(result.fixtureId, 'character-chat');
  assert.equal(result.sha256, '7d6447e6b37eebc4e482a2381e921be09aa9fc05b9d378dfc65dfa1875c76259');
  assert.equal(result.result.text, reply);
  assert.equal(result.result.qualityAccepted, false);
  assert.equal(result.live, false);
  assert.equal(calls, 1);
  await tracker.assertCleaned();
});

test('unknown fixture is rejected before any process starts', async () => {
  let started = false;
  await assert.rejects(runGatewayHttpCanary({ fixtureId: 'arbitrary-book',
    spawnFixtureChild: () => { started = true; return mockFixtureChild(); },
    spawnGatewayChild: () => { started = true; throw new Error('must not start'); },
  }), /Unknown fixed fixture/);
  assert.equal(started, false);
});

function gatewayTracker() {
  const calls = [];
  return {
    calls,
    spawnGatewayChild(binary, args, options) {
      const child = spawn(binary, args, options);
      calls.push({ child, options });
      return child;
    },
    async assertCleaned() {
      assert.equal(calls.length, 1);
      assert.ok(calls[0].child.exitCode !== null || calls[0].child.signalCode);
      await assert.rejects(access(calls[0].options.env.DATA_DIR));
    },
  };
}

test('dry fixture uses exact previously approved provider bytes without model execution', async () => {
  const fixture = await approvedFixture();
  assert.equal(fixture.sha256, APPROVED_SHA256);
  assert.equal(fixture.live, false);
  assert.equal(fixture.request.stream, false);
  assert.equal(fixture.request.max_tokens, 512);
});

test('actual gateway registration and HTTP completion reach bridge once with isolated env; cleanup is awaited', async () => {
  const tracker = gatewayTracker();
  let fixtureCalls = 0;
  let fixtureRoot;
  const result = await runGatewayHttpCanary({
    spawnGatewayChild: tracker.spawnGatewayChild,
    spawnFixtureChild(_binary, _args, options) {
      fixtureCalls++; fixtureRoot = options.cwd;
      return mockFixtureChild();
    },
  });
  assert.equal(result.live, false);
  assert.equal(result.sha256, APPROVED_SHA256);
  assert.match(result.request_id, /^[a-f0-9-]{36}$/);
  assert.ok(result.requestElapsedMs >= 0 && result.requestElapsedMs <= result.elapsedMs);
  assert.equal(fixtureCalls, 1);
  assert.deepEqual(result.result.characters.map(character => character.name), ['Анна', 'Лев']);
  const env = tracker.calls[0].options.env;
  assert.deepEqual(Object.keys(env).sort(), [
    'PATH', 'NODE_ENV', 'GATEWAY_HOST', 'PORT', 'DATA_DIR', 'GATEWAY_TOKEN_SECRET',
    'LLM_ROUTE_DEFAULT', 'LLM_FALLBACK_DEFAULT', 'LLM_FALLBACK_STRUCTURED_TASK',
    'LITELLM_BASE_URL', 'LITELLM_API_KEY', 'LITELLM_MODEL', 'LLM_MAX_TOKENS_COMPLETE',
    'ALLOW_INSECURE_LLM_HTTP', 'LLM_INSECURE_HTTP_HOSTS', 'COVER_JOB_WORKER_ENABLED', 'SCENE_JOB_WORKER_ENABLED',
  ].sort());
  assert.match(env.LITELLM_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(env.GATEWAY_TOKEN_SECRET, /^[a-f0-9]{64}$/);
  assert.notEqual(env.GATEWAY_TOKEN_SECRET, env.LITELLM_API_KEY);
  await tracker.assertCleaned();
  await assert.rejects(access(fixtureRoot));
});

function heldChild(onFinish) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null)); return true; };
  child.stdin.on('finish', () => setImmediate(() => onFinish(child)));
  return child;
}

test('provider failure is not retried and both gateway and temporary state are cleaned', async () => {
  const tracker = gatewayTracker(); let calls = 0;
  await assert.rejects(runGatewayHttpCanary({
    spawnGatewayChild: tracker.spawnGatewayChild,
    spawnFixtureChild() { calls++; return heldChild(child => child.emit('close', 1)); },
  }), /HTTP 502/);
  assert.equal(calls, 1);
  await tracker.assertCleaned();
});

test('abort during fixture execution kills CLI child and reaps gateway before returning', async () => {
  const tracker = gatewayTracker(); const controller = new AbortController(); let fixtureChild;
  await assert.rejects(runGatewayHttpCanary({
    signal: controller.signal, spawnGatewayChild: tracker.spawnGatewayChild,
    spawnFixtureChild() {
      fixtureChild = heldChild(() => controller.abort(new Error('explicit stop')));
      return fixtureChild;
    },
  }), /explicit stop/);
  assert.equal(fixtureChild.killed, true);
  await tracker.assertCleaned();
});

test('default library invocation cannot accidentally execute a live model', async () => {
  await assert.rejects(runGatewayHttpCanary(), /explicit mock/);
  await assert.rejects(runGatewayHttpCanary({ live: true, spawnFixtureChild: mockFixtureChild }), /cannot use a mock/);
});

test('cleanup waits for delayed close, not merely gateway exit', async () => {
  let closeObserved = false;
  await runGatewayHttpCanary({
    spawnFixtureChild: mockFixtureChild,
    spawnGatewayChild(binary, args, options) {
      const actual = spawn(binary, args, options);
      const proxy = new EventEmitter();
      proxy.pid = actual.pid;
      proxy.kill = signal => actual.kill(signal);
      actual.on('error', error => proxy.emit('error', error));
      actual.on('exit', (code, signal) => proxy.emit('exit', code, signal));
      actual.on('close', (code, signal) => setTimeout(() => {
        closeObserved = true; proxy.emit('close', code, signal);
      }, 50));
      return proxy;
    },
  });
  assert.equal(closeObserved, true);
});
