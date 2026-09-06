// Model-free diagnostic. Exit 2 = the known stall reproduced; 0 = not reproduced.
// Executes the actual completeInternalChat method, recorder and SQL ledger with
// controlled provider/pool boundaries. No database connection or model request.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createWorkloadConcurrencyGate } from '../../services/narra-gateway/workload-concurrency.mjs';
import { createConcurrencyGate } from '../../services/narra-gateway/concurrency.mjs';
import { createBestEffortGenerationCostRecorder } from '../../services/narra-gateway/generation-cost-recorder.mjs';
import { createGenerationCostLedger } from '../../services/narra-gateway/generation-cost-ledger.mjs';
import { settleProviderResponse, validateChatCompletionPayload } from '../../services/narra-gateway/provider-response.mjs';
import { readBoundedBody } from '../../services/narra-gateway/safe-fetch.mjs';

const source = await readFile(new URL('../../services/narra-gateway/index.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function completeInternalChat(');
const end = source.indexOf('\nasync function generateInternalPortrait(', start);
if (start < 0 || end < 0) throw new Error('Actual method boundary changed; update diagnostic deliberately');
const method = source.slice(start, end);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Diagnostic cleanup exceeded 2 seconds')), 2000);
    })]);
  } finally { clearTimeout(timer); }
}

const gate = createWorkloadConcurrencyGate({ limit: 1, queueLimit: 2 });
const lifecycleGate = createConcurrencyGate({ limit: 1, queueLimit: 0, name: 'Internal lifecycle' });
let completeQuery;
let queryCalls = 0;
const mockQuery = new Promise(resolve => { completeQuery = resolve; });
const ledger = createGenerationCostLedger({ query: async () => { queryCalls++; return mockQuery; } });
const record = createBestEffortGenerationCostRecorder({ getLedger: () => ledger, logger: { warn() {} } });
const requestChat = async () => ({
  response: Response.json({
    choices: [{ message: { role: 'assistant', content: 'completed fixture' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  }),
  attempts: [{ attempt_id: randomUUID(), status: 'completed', provider: 'fixture', model: 'fixture' }],
  finalizeAttempt: async () => {},
});
// Source supplies executable behavior, not a source-string assertion. All I/O
// dependencies are explicit; importing index.mjs would start an actual gateway.
const execute = new Function('internalChatLifecycleGate', 'llmGate', 'randomUUID', 'requestChat', 'recordProviderAttemptMetric',
  'settleProviderResponse', 'readBoundedBody', 'LLM_RESPONSE_MAX_BYTES',
  'validateChatCompletionPayload', 'recordInternalGenerationCost',
  `${method}; return completeInternalChat;`)(lifecycleGate, gate, randomUUID, requestChat, () => {},
  settleProviderResponse, readBoundedBody, 4096, validateChatCompletionPayload, record);

const activeController = new AbortController();
const queuedController = new AbortController();
let outcome = 'pending';
let observation;
let waiter = Promise.resolve();
const active = execute({ messages: [], signal: activeController.signal,
  costContext: { bookEditionId: randomUUID(), operation: 'fixture', stage: 'fixture' },
}).then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; });
try {
  const cutoff = Date.now() + 1000;
  while (queryCalls === 0 && outcome === 'pending' && Date.now() < cutoff) await delay(5);
  if (queryCalls !== 1) throw new Error('Diagnostic did not reach the controlled ledger query');
  waiter = gate.acquire(queuedController.signal).then(release => release(), () => {});
  activeController.abort(Object.assign(new Error('Synthetic request deadline'), { code: 'TIMEOUT' }));
  await delay(40);
  const state = gate.status();
  observation = { outcome, queryCalls, activeSignalAborted: activeController.signal.aborted,
    active: state.active, waiting: state.waiting, lifecycleActive: lifecycleGate.status().active };
} finally {
  // Always settle our own fake query and queue; no dangling held resources.
  queuedController.abort();
  completeQuery({ rowCount: 1 });
  await bounded(Promise.all([active, waiter]));
}
const cleanup = gate.status();
if (cleanup.active !== 0 || cleanup.waiting !== 0) throw new Error('Diagnostic leaked a mock permit');
if (lifecycleGate.status().active !== 0) throw new Error('Diagnostic leaked lifecycle admission');
const reproduced = observation.outcome === 'pending' && observation.active === 1 && observation.waiting === 1;
console.log(JSON.stringify({ reproduced, observation, cleanup: { active: cleanup.active, waiting: cleanup.waiting },
  boundary: 'Actual method/recorder/ledger; fake provider and pool; no external writes' }, null, 2));
process.exitCode = reproduced ? 2 : 0;
