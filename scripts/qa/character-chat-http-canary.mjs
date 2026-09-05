// Fixed own-book fixture only. Never a general model endpoint or auto-approval.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createFixtureBridge, digest, MODEL } from './codex-fixture-bridge.mjs';
import { captureCharacterProviderFixture } from './capture-character-provider-fixture.mjs';
import { gatewayEnvironment } from './gateway-http-canary.mjs';

export const CHARACTER_APPROVED_SHA256 = '7d6447e6b37eebc4e482a2381e921be09aa9fc05b9d378dfc65dfa1875c76259';
export const MOCK_REPLY = 'Я заметила течь и позвала Льва: он принёс доску, чтобы помочь.';
const SCOPE = 'Own Anna fixture: captured mobile body -> authenticated gateway HTTP -> exact approved provider bytes. Native UI and live response mobile-parser replay are separate gates. Gateway omits finish_reason: truncation and semantic quality require separate review.';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function validateApprovedCharacterFixture(fixture) {
  assert.equal(fixture.live, false);
  assert.equal(fixture.fixtureId, 'anna-boat-character-chat-v1');
  assert.equal(fixture.upstreamSha256, CHARACTER_APPROVED_SHA256, 'Fixture changed: independent approval required');
  assert.equal(digest(fixture.requestBytes), CHARACTER_APPROVED_SHA256);
  assert.equal(JSON.stringify(fixture.request), fixture.requestBytes);
  assert.equal(fixture.request.model, MODEL);
  assert.equal(fixture.request.stream, false);
  assert.equal(fixture.request.max_tokens, 512);
  assert.equal(fixture.mobileRequest.purpose, 'character_chat');
  assert.equal(fixture.mobileRequest.origin, 'user');
  assert.equal(fixture.mobileRequest.analytics_tier, 'essential');
  assert.equal(fixture.mobileRequestSha256, digest(JSON.stringify(fixture.mobileRequest)));
  return fixture;
}

export function characterGatewayEnvironment(options) {
  return { ...gatewayEnvironment(options), LLM_ROUTE_CHARACTER_CHAT: 'litellm',
    LLM_FALLBACK_CHARACTER_CHAT: '', LITELLM_MODEL_CHARACTER_CHAT: MODEL,
    LLM_MAX_TOKENS_CHARACTER_CHAT: '512' };
}

export function mockCharacterChild({ reply = MOCK_REPLY } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  let closed = false;
  const close = code => { if (!closed) { closed = true; child.emit('close', code); } };
  child.kill = () => { setImmediate(() => close(null)); return true; };
  child.stdin.on('finish', () => setImmediate(() => {
    if (closed) return;
    child.stdout.end(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: reply } })}\n${JSON.stringify({ type: 'turn.completed' })}\n`);
    close(0);
  }));
  return child;
}

export async function runCharacterChatHttpCanary({ live = false, spawnFixtureChild, signal } = {}) {
  if (!live && typeof spawnFixtureChild !== 'function') throw new Error('Mock mode requires explicit fake child');
  if (live && spawnFixtureChild) throw new Error('Live mode cannot use fake child');
  const fixture = validateApprovedCharacterFixture(await captureCharacterProviderFixture());
  signal?.throwIfAborted();
  const dataDir = await mkdtemp(join(tmpdir(), 'narra-character-http-'));
  let bridge; let child; let exited; let childDone = false; let childFailed = false;
  const started = Date.now();
  try {
    bridge = await createFixtureBridge({ approvedHashes: [CHARACTER_APPROVED_SHA256], maxCalls: 1,
      ...(spawnFixtureChild ? { spawnChild: spawnFixtureChild } : {}) });
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['index.mjs'], {
      cwd: fileURLToPath(new URL('../../services/narra-gateway/', import.meta.url)),
      env: characterGatewayEnvironment({ port, dataDir, bridge }), detached: true,
      stdio: ['ignore', 'ignore', 'ignore'], shell: false,
    });
    exited = new Promise(resolve => {
      child.once('close', () => { childDone = true; resolve(); });
      child.once('error', () => { childFailed = true; });
    });
    const json = async (route, body, token, timeout = 5000) => {
      const response = await fetch(`${base}${route}`, {
        method: body ? 'POST' : 'GET',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
        headers: { 'content-type': 'application/json', connection: 'close',
          ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`${route}: HTTP ${response.status} (${error.code || error.error?.code || 'unknown'})`);
      }
      return response.json();
    };
    const startupDeadline = Date.now() + 8000;
    for (;;) {
      signal?.throwIfAborted();
      if (childDone || childFailed) throw new Error('Isolated gateway exited during startup');
      try { await json('/health', null, null, 500); break; }
      catch { if (Date.now() >= startupDeadline) throw new Error('Gateway startup deadline'); await delay(25); }
    }
    const registration = await json('/v2/installations/register', {
      installation_id: randomUUID(), installation_secret: randomBytes(32).toString('hex'),
    });
    assert.equal(typeof registration.token, 'string');
    const requestStarted = Date.now();
    const completion = await json('/v2/ai/chat/complete', fixture.mobileRequest, registration.token, 50000);
    assert.equal(completion.attempts, 1, 'No retry/fallback is permitted');
    assert.equal(typeof completion.request_id, 'string');
    assert.equal(typeof completion.text, 'string');
    assert.ok(completion.text.trim().length > 0, 'Empty reply is not acceptance');
    return { live, model: MODEL, fixtureId: fixture.fixtureId,
      upstreamSha256: CHARACTER_APPROVED_SHA256, mobileRequestSha256: fixture.mobileRequestSha256,
      elapsedMs: Date.now() - started, requestElapsedMs: Date.now() - requestStarted,
      completion, transportPassed: true, requiresManualReview: live,
      qualityAccepted: false, scope: SCOPE };
  } finally {
    let cleanupError;
    if (child && !childDone) {
      child.kill('SIGTERM');
      const force = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }, 1500);
      let deadline;
      try {
        await Promise.race([exited, new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Gateway close unconfirmed; own temporary data retained')), 3500);
        })]);
      } catch (error) { cleanupError = error; }
      finally { clearTimeout(force); clearTimeout(deadline); }
    }
    let bridgeClosed = false;
    try { if (bridge) await bridge.close(); bridgeClosed = true; }
    catch (error) { cleanupError ||= error; }
    if (!child || childDone) await rm(dataDir, { recursive: true, force: true });
    if (bridge && bridgeClosed) await rm(bridge.cwd, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  assert.ok(flags.length <= 1 && flags.every(flag => ['--dry-run', '--mock', '--live'].includes(flag)),
    'Usage: character-chat-http-canary.mjs [--dry-run|--mock|--live]');
  const mode = flags[0] || '--dry-run';
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Canary interrupted'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = mode === '--dry-run'
      ? { ...validateApprovedCharacterFixture(await captureCharacterProviderFixture()), mode: 'dry-run; no listeners or model calls', scope: SCOPE }
      : await runCharacterChatHttpCanary({ ...(mode === '--live' ? { live: true } : { spawnFixtureChild: () => mockCharacterChild() }), signal: controller.signal });
    console.log(JSON.stringify(result));
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
