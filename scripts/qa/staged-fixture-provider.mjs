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

export const STAGED_FIXTURE = 'Анна всегда была честной. Однажды Анна торопливо закрыла окно.';
export const STAGED_OPERATIONS = ['scan_book_chunk', 'synthesize_character_profile', 'recall_character_traits', 'audit_character_profile'];
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

export async function createStagedFixtureProvider({ mode = 'mock', spawnFixtureChild, approvalTimeoutMs = 60000, signal, onCapture = () => {} } = {}) {
  if (!['mock', 'live'].includes(mode)) throw new Error('Invalid staged mode');
  if (mode === 'mock' && typeof spawnFixtureChild !== 'function') throw new Error('MOCK mode requires explicit spawnFixtureChild');
  if (mode === 'live' && spawnFixtureChild !== undefined) throw new Error('Live mode rejects mock/spawn injection');
  if (!Number.isInteger(approvalTimeoutMs) || approvalTimeoutMs < 1 || approvalTimeoutMs > 90000) throw new Error('Invalid approval deadline');
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'narra-staged-approval-')));
  const stop = new AbortController();
  const lifetime = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let failed = false; let active = false; let index = 0; let runId; let activeBridge;
  const manifests = [];
  return {
    directory,
    status: () => ({ failed, active, calls: index, manifests: [...manifests] }),
    async completeChat(input) {
      if (failed || active || index >= STAGED_OPERATIONS.length) {
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
        if (operation !== STAGED_OPERATIONS[index]) throw new Error('Unexpected pipeline phase; no fallback or retries allowed');
        const currentRun = input.costContext?.analysisRunId;
        if (!currentRun || (runId && runId !== currentRun)) throw new Error('Pipeline run identity changed');
        runId = currentRun;
        const messages = structuredClone(input.messages);
        if (index === 0) {
          const context = messages.find(message => message.role === 'user')?.content?.match(/\nCONTEXT_TEXT_BEGIN\n([\s\S]*)\nCONTEXT_TEXT_END$/)?.[1];
          if (context !== STAGED_FIXTURE) throw new Error('Only the exact own fixture is supported');
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
          fixtureSha256: digest(STAGED_FIXTURE), mode, model: MODEL };
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
