// Staged control. Approval artifacts are written by a separate reviewer, never
// by this controller. Real CLI requires explicit live mode AND per-step approval.
import { mkdtemp, realpath, writeFile, readFile, open, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { requestChat } from '../../services/narra-gateway/providers.mjs';
import { createFixtureBridge, digest, MODEL } from './codex-fixture-bridge.mjs';
import { MULTICHUNK_FIXTURE } from './multichunk-book-fixture.mjs';
import { createStableBookChunks } from '../../services/narra-gateway/book-analysis-chunking.mjs';
import { extractStructuredBookText } from '../../services/narra-gateway/book-source-text.mjs';

export const STAGED_FIXTURE = 'Анна всегда была честной. Однажды Анна торопливо закрыла окно.';
export const STAGED_OPERATIONS = Object.freeze(['scan_book_chunk', 'synthesize_character_profile', 'recall_character_traits', 'audit_character_profile']);
const ENV = { LLM_ROUTE_DEFAULT: 'litellm', LLM_FALLBACK_DEFAULT: '', LLM_FALLBACK_STRUCTURED_TASK: '',
  LITELLM_MODEL: MODEL, LITELLM_BASE_URL: 'http://127.0.0.1:1', LITELLM_API_KEY: 'capture-only', LLM_MAX_TOKENS_COMPLETE: '8000' };

async function approvalAt(file) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077)) throw new Error('Approval must be a private regular file <=4096 bytes');
    return JSON.parse(await handle.readFile('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}

export async function createStagedFixtureProvider({ mode = 'mock', fixtureId = 'window', spawnFixtureChild, approvalTimeoutMs = 60000, signal, onCapture = () => {} } = {}) {
  if (!['window', 'siblings'].includes(fixtureId)) throw new Error('Unknown fixed staged fixture');
  if (!['mock', 'live'].includes(mode)) throw new Error('Invalid staged mode');
  if (mode === 'mock' && typeof spawnFixtureChild !== 'function') throw new Error('MOCK mode requires explicit spawnFixtureChild');
  if (mode === 'live' && spawnFixtureChild !== undefined) throw new Error('Live mode rejects mock/spawn injection');
  if (!Number.isInteger(approvalTimeoutMs) || approvalTimeoutMs < 1 || approvalTimeoutMs > 90000) throw new Error('Invalid approval deadline');
  const fixture = fixtureId === 'siblings' ? MULTICHUNK_FIXTURE : STAGED_FIXTURE;
  const maxCalls = fixtureId === 'siblings' ? 9 : STAGED_OPERATIONS.length;
  // Validate/normalize the fixed fixture before creating any retained directory.
  const structured = fixtureId === 'siblings'
    ? await extractStructuredBookText({ bytes: Buffer.from(fixture), format: 'txt', mimeType: 'text/plain' }) : null;
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'narra-staged-approval-')));
  const stop = new AbortController();
  const lifetime = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let failed = false; let active = false; let index = 0; let runId; let activeBridge;
  const manifests = [];
  const seenChunks = new Set();
  const characters = new Map();
  let currentCharacter;
  return {
    directory,
    status: () => ({ failed, active, calls: index, manifests: [...manifests] }),
    async completeChat(input) {
      if (failed || active || index >= maxCalls) {
        failed = true;
        const error = new Error('Staged campaign stopped or concurrent/extra request');
        stop.abort(error);
        throw error;
      }
      active = true;
      let bridge;
      try {
        lifetime.throwIfAborted();
        const operation = input.costContext?.operation;
        const expectedOperation = fixtureId === 'window' ? STAGED_OPERATIONS[index]
          : index < 3 ? STAGED_OPERATIONS[0] : STAGED_OPERATIONS[1 + (index - 3) % 3];
        if (operation !== expectedOperation) throw new Error('Unexpected pipeline phase; no fallback or retries allowed');
        const currentRun = input.costContext?.analysisRunId;
        if (typeof currentRun !== 'string' || !currentRun.trim() || (runId && runId !== currentRun)) throw new Error('Pipeline run identity changed');
        runId = currentRun;
        const messages = structuredClone(input.messages);
        if (fixtureId === 'window' && index === 0) {
          const context = messages.find(message => message.role === 'user')?.content?.match(/\nCONTEXT_TEXT_BEGIN\n([\s\S]*)\nCONTEXT_TEXT_END$/)?.[1];
          if (context !== STAGED_FIXTURE) throw new Error('Only the exact own fixture is supported');
        }
        let subject;
        if (fixtureId === 'siblings') {
          const users = messages.filter(message => message.role === 'user');
          if (users.length !== 1 || typeof users[0].content !== 'string') throw new Error('Expected one exact fixture user message');
          const user = users[0].content;
          if (index < 3) {
            const chunks = createStableBookChunks({ runId, text: structured.text, sections: structured.sections });
            if (chunks.length !== 3) throw new Error('Production default chunk plan changed; explicit review required');
            const context = user.match(/\nCONTEXT_TEXT_BEGIN\n([\s\S]*)\nCONTEXT_TEXT_END$/)?.[1];
            const ranges = user.split('\n').filter(line => line.startsWith('CORE_LOCAL_RANGE: '));
            const chunk = chunks.find(item =>
              context === structured.text.slice(item.contextStartOffset, item.contextEndOffset) &&
              ranges.length === 1 && ranges[0] === `CORE_LOCAL_RANGE: ${item.coreStartOffset - item.contextStartOffset}-${item.coreEndOffset - item.contextStartOffset}`);
            if (!chunk || input.costContext.metadata?.chunk_id !== chunk.id || input.costContext.metadata?.adaptive_part != null)
              throw new Error('Only exact default fixture context, core range and chunk identity are supported');
            if (seenChunks.has(chunk.id)) throw new Error('Duplicate fixture chunk; no retries allowed');
            seenChunks.add(chunk.id);
            subject = { chunkId: chunk.id, ordinal: chunk.ordinal };
          } else {
            const lines = user.split('\n').filter(line => line.startsWith('CHARACTER: '));
            if (lines.length !== 1) throw new Error('Expected one fixture character');
            const character = JSON.parse(lines[0].slice('CHARACTER: '.length));
            const name = character.canonicalName;
            const key = character.entityKey;
            if (!['Анна', 'Борис'].includes(name) || typeof key !== 'string' || !key || key !== input.costContext.metadata?.entity_key)
              throw new Error('Unexpected fixture character identity');
            if ((index - 3) % 3 === 0) {
              if (characters.has(name) || [...characters.values()].includes(key)) throw new Error('Duplicate fixture character');
              characters.set(name, key); currentCharacter = name;
            } else if (name !== currentCharacter || characters.get(name) !== key) throw new Error('Character changed within profile sequence');
            subject = { character: name, entityKey: key };
          }
        }
        const requestSignal = input.signal ? AbortSignal.any([lifetime, input.signal]) : lifetime;
        let body;
        const captured = await requestChat({ messages, purpose: 'structured_task', stream: false, env: ENV, signal: requestSignal,
          fetchImpl: async (_url, init) => { body = init.body; return new Response('{}'); } });
        await captured.response.text();
        // This capture isn't a completed model request; no provider-completed telemetry.
        if (Buffer.byteLength(body) > 32768) throw new Error('Actual provider request exceeds unchanged bridge 32KiB cap');
        const step = index + 1;
        const prefix = join(directory, `step-${step}`);
        const sha256 = digest(body);
        const nonce = randomUUID();
        const manifest = { index: step, phase: operation, sha256, nonce,
          bodyFile: `${prefix}.request.json`, approvalFile: `${prefix}.approval.json`, responseFile: `${prefix}.response.json`,
          priorResponseFile: index ? join(directory, `step-${index}.response.json`) : null,
          fixtureSha256: digest(fixture), fixtureId, runId, maxCalls, subject, mode, model: MODEL };
        await writeFile(manifest.bodyFile, body, { mode: 0o600, flag: 'wx' });
        const manifestFile = `${prefix}.manifest.json`;
        await writeFile(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
        manifests.push(manifestFile);
        // Notification only: never provide an approval-writing helper.
        onCapture({ manifestFile, phase: operation, sha256 });
        const deadline = Date.now() + approvalTimeoutMs;
        for (;;) {
          requestSignal.throwIfAborted();
          if (Date.now() >= deadline) throw new Error('Approval deadline exceeded; campaign stopped');
          const approval = await approvalAt(manifest.approvalFile);
          if (approval) {
            if (approval.approved !== true || approval.index !== step || approval.sha256 !== sha256 || approval.nonce !== nonce) throw new Error('Approval does not match exact captured request');
            break;
          }
          await delay(Math.min(50, Math.max(1, deadline - Date.now())), undefined, { signal: requestSignal });
        }
        if (digest(await readFile(manifest.bodyFile)) !== sha256) throw new Error('Captured request changed after review');
        requestSignal.throwIfAborted();
        bridge = await createFixtureBridge({ approvedHashes: [sha256], maxCalls: 1,
          ...(mode === 'mock' ? { spawnChild: spawnFixtureChild } : {}) });
        activeBridge = bridge;
        if (bridge.cwd === directory || bridge.cwd.startsWith(`${directory}/`) || directory.startsWith(`${bridge.cwd}/`)) throw new Error('Approval directory must be outside child-readable fixture directory');
        index++;
        // Send the exact immutable requestChat-produced bytes once. No routing,
        // reserialization, retry, fallback or provider telemetry that prints data.
        const response = await fetch(`${bridge.url}/v1/chat/completions`, {
          method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' },
          body, signal: AbortSignal.any([requestSignal, AbortSignal.timeout(50000)]),
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error(`Fixture bridge HTTP ${response.status}; campaign stopped`); }
        const payload = await response.json();
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new Error('Empty or invalid fixture completion');
        await writeFile(manifest.responseFile, JSON.stringify(payload, null, 2), { mode: 0o600, flag: 'wx' });
        return content;
      } catch (error) { failed = true; stop.abort(error); throw error; }
      finally {
        try { if (bridge) { await bridge.close(); await rm(bridge.cwd, { recursive: true, force: true }); } }
        catch (error) { failed = true; throw error; }
        finally { activeBridge = null; active = false; }
      }
    },
    async close() {
      failed = true; stop.abort(new Error('Staged campaign closed'));
      await activeBridge?.close();
      // Evidence intentionally retained; no approval/body/response deletion.
    },
  };
}
