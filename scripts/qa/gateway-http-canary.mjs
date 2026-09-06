// Bounded synthetic fixture only; not a book pipeline or general inference server.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createFixtureBridge, digest, MODEL } from './codex-fixture-bridge.mjs';
import { captureCharacterChatFixture } from './capture-character-chat-fixture.mjs';
import { requestChat } from '../../services/narra-gateway/providers.mjs';

const execute = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const SAFE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
export const APPROVED_SHA256 = '9fac970ca53225b2b7ee5a2727c367afd5c1471897072f0253b833acbc785e26';
// Root reviewed the complete own-story mobile prompt and the exact requestChat
// envelope. Changing either requires a new independent review, not auto-approval.
export const APPROVED_CHARACTER_SHA256 = '9890b4c1a6b41bf86e7ca44ada198e012b3958c8fb81b791e805621aaacc6525';
const SCOPE = 'actual HTTP installation/register -> gateway chat/complete -> exact fixture bridge; not mobile/full book pipeline';

export async function approvedFixture(fixtureId = 'analysis') {
  if (!['analysis', 'character-chat'].includes(fixtureId)) throw new Error('Unknown fixed fixture');
  if (fixtureId === 'character-chat') {
    const captured = await captureCharacterChatFixture();
    let body;
    const result = await requestChat({ messages: captured.request.messages,
      purpose: captured.request.purpose, stream: false,
      env: gatewayEnvironment({ port: 1, dataDir: '', bridge: { url: 'http://127.0.0.1:1', token: 'capture-only' } }),
      fetchImpl: async (_url, init) => { body = init.body; return new Response('{}'); },
    });
    await result.response.text();
    assert.equal(digest(body), APPROVED_CHARACTER_SHA256, 'Character fixture changed: separate review required');
    return { live: false, sha256: APPROVED_CHARACTER_SHA256,
      request: JSON.parse(body), mobileRequest: captured.request,
      mobileRequestSha256: captured.mobileRequestSha256 };
  }
  // Reuse the existing canary's actual requestChat serialization. Its default
  // execution captures fetch in memory; --live is never passed here.
  const { stdout } = await execute(process.execPath, [fileURLToPath(new URL('./codex-provider-canary.mjs', import.meta.url))], {
    env: { PATH: SAFE_PATH }, timeout: 5000, maxBuffer: 65536,
  });
  const outputs = stdout.trim().split('\n').map(line => JSON.parse(line));
  const fixture = outputs.find(item => item.live === false && item.request);
  assert.ok(fixture, 'provider dry-run did not supply fixture');
  assert.equal(fixture.sha256, APPROVED_SHA256, 'fixture changed: separate review required');
  assert.equal(digest(JSON.stringify(fixture.request)), APPROVED_SHA256);
  assert.equal(fixture.request.model, MODEL);
  return fixture;
}

export function gatewayEnvironment({ port, dataDir, bridge }) {
  // No inherited DB/API keys, HOME, NODE_OPTIONS, dotenv, analytics sinks or
  // object storage. The only provider credential is this one-use bridge token.
  return {
    PATH: SAFE_PATH, NODE_ENV: 'test', GATEWAY_HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir,
    GATEWAY_TOKEN_SECRET: randomBytes(32).toString('hex'),
    LLM_ROUTE_DEFAULT: 'litellm', LLM_FALLBACK_DEFAULT: '', LLM_FALLBACK_STRUCTURED_TASK: '',
    LITELLM_BASE_URL: bridge.url, LITELLM_API_KEY: bridge.token, LITELLM_MODEL: MODEL,
    LLM_MAX_TOKENS_COMPLETE: '512', ALLOW_INSECURE_LLM_HTTP: 'true', LLM_INSECURE_HTTP_HOSTS: '127.0.0.1',
    COVER_JOB_WORKER_ENABLED: 'false', SCENE_JOB_WORKER_ENABLED: 'false',
  };
}

function validateCompletion(completion, fixtureId) {
  // Public gateway contract is {text, request_id, route, attempts}, not the
  // upstream OpenAI envelope used by the lower-level provider canary.
  const content = completion.text;
  assert.equal(completion.attempts, 1, 'canary must not retry or fall back');
  assert.equal(typeof completion.request_id, 'string');
  assert.equal(typeof content, 'string');
  if (fixtureId === 'character-chat') {
    assert.ok(content.trim().length > 0 && Buffer.byteLength(content) <= 16384);
    return { text: content, qualityAccepted: false };
  }
  const result = JSON.parse(content);
  assert.deepEqual(result.characters.map(character => character.name).sort(), ['Анна', 'Лев']);
  assert.ok(result.characters.every(character => typeof character.trait === 'string' && character.trait.length > 0));
  assert.ok(typeof result.summary === 'string' && result.summary.length > 0);
  return result;
}

export function mockFixtureChild(fixtureId = 'analysis') {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  let closed = false;
  const close = code => { if (!closed) { closed = true; child.emit('close', code); } };
  child.kill = () => { setImmediate(() => close(null)); return true; };
  child.stdin.on('finish', () => setImmediate(() => {
    if (closed) return;
    const text = fixtureId === 'character-chat'
      ? 'Я заметила течь и позвала Льва: он принёс доску, чтобы помочь.'
      : JSON.stringify({ characters: [{ name: 'Анна', trait: 'Спокойная' }, { name: 'Лев', trait: 'Отзывчивый' }], summary: 'Анна и Лев вместе починили лодку и вернулись на берег.' });
    child.stdout.end(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } })}\n${JSON.stringify({ type: 'turn.completed' })}\n`);
    close(0);
  }));
  return child;
}

export async function runGatewayHttpCanary({ live = false, fixtureId = 'analysis', spawnFixtureChild, spawnGatewayChild = spawn, signal } = {}) {
  if (!live && typeof spawnFixtureChild !== 'function') throw new Error('Non-live mode requires an explicit mock child');
  if (live && spawnFixtureChild) throw new Error('Live mode cannot use a mock child');
  const fixture = await approvedFixture(fixtureId);
  signal?.throwIfAborted();
  const dataDir = await mkdtemp(join(tmpdir(), 'narra-gateway-canary-'));
  let bridge; let child; let exited; let childDone = false; let childFailed = false;
  const started = Date.now();
  try {
    bridge = await createFixtureBridge({ approvedHashes: [fixture.sha256], maxCalls: 1, ...(spawnFixtureChild ? { spawnChild: spawnFixtureChild } : {}) });
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    child = spawnGatewayChild(process.execPath, ['index.mjs'], {
      cwd: fileURLToPath(new URL('../../services/narra-gateway/', import.meta.url)),
      env: gatewayEnvironment({ port, dataDir, bridge }), detached: true,
      stdio: ['ignore', 'ignore', 'ignore'], shell: false,
    });
    exited = new Promise(resolve => {
      const done = () => { childDone = true; resolve(); };
      child.once('close', done);
      child.once('error', () => { childFailed = true; });
    });
    const json = async (route, body, token, timeout = 5000) => {
      const response = await fetch(`${base}${route}`, {
        method: body ? 'POST' : 'GET', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
        headers: { 'content-type': 'application/json', connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}) },
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
      try { await json('/health', null, null, 500); break; } catch {
        if (Date.now() >= startupDeadline) throw new Error('Isolated gateway startup deadline');
        await delay(25);
      }
    }
    const registration = await json('/v2/installations/register', {
      installation_id: randomUUID(), installation_secret: randomBytes(32).toString('hex'),
    });
    assert.equal(typeof registration.token, 'string');
    // Exactly one model-bearing HTTP attempt. No application retries/fallback.
    const requestStarted = Date.now();
    const completion = await json('/v2/ai/chat/complete', fixture.mobileRequest || {
      messages: fixture.request.messages, purpose: 'structured_task', origin: 'user',
    }, registration.token, 50000);
    const requestElapsedMs = Date.now() - requestStarted;
    return { live, fixtureId, model: MODEL, sha256: fixture.sha256,
      ...(fixture.mobileRequestSha256 ? { mobileRequestSha256: fixture.mobileRequestSha256 } : {}), elapsedMs: Date.now() - started,
      requestElapsedMs, request_id: completion.request_id,
      checks: fixtureId === 'character-chat'
        ? 'mounted-screen request capture, registration, authenticated HTTP completion, exact approved upstream bytes, nonempty text; manual quality review required'
        : 'registration, authenticated HTTP completion, exact approved provider bytes, JSON schema and two names',
      result: validateCompletion(completion, fixtureId), scope: SCOPE };
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
          deadline = setTimeout(() => reject(new Error('Gateway child close unconfirmed after termination deadline; temporary data retained')), 3500);
        })]);
      } catch (error) { cleanupError = error; }
      finally { clearTimeout(force); clearTimeout(deadline); }
    }
    let bridgeClosed = false;
    try { if (bridge) await bridge.close(); bridgeClosed = true; }
    catch (error) { cleanupError ||= error; }
    // Never delete either directory before its owner has confirmed closure.
    if (!child || childDone) await rm(dataDir, { recursive: true, force: true });
    if (bridge && bridgeClosed) await rm(bridge.cwd, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  const modes = flags.filter(flag => ['--dry-run', '--mock', '--live'].includes(flag));
  if (flags.length > 2 || modes.length > 1 || new Set(flags).size !== flags.length ||
    flags.some(flag => !['--dry-run', '--mock', '--live', '--character-chat'].includes(flag)))
    throw new Error('Usage: gateway-http-canary.mjs [--dry-run|--mock|--live] [--character-chat]');
  const mode = modes[0] || '--dry-run';
  const fixtureId = flags.includes('--character-chat') ? 'character-chat' : 'analysis';
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Canary interrupted'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = mode === '--dry-run'
      ? { ...(await approvedFixture(fixtureId)), fixtureId, scope: SCOPE, mode: 'dry-run; no listeners or model execution' }
      : await runGatewayHttpCanary({ fixtureId, ...(mode === '--live' ? { live: true } : { spawnFixtureChild: () => mockFixtureChild(fixtureId) }), signal: controller.signal });
    console.log(JSON.stringify(result));
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
