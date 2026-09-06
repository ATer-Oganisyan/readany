#!/usr/bin/env node
// Explicit QA process-termination test, NOT a SIGKILL guarantee.
// No app/filesystem writes, except terminating this one dev app.
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import WebSocket from "ws";

export const SIMULATOR_ID = "391D4246-C13E-42B6-B7AF-15D3B7FD9DC6";
export const APP_ID = "com.mishanaer.readany.dev";
const ORIGIN = "http://127.0.0.1:8081";
const execute = promisify(execFile);

export function parseOptions(args) {
  const options = { bookId: "", delayMs: 700 };
  const seen = new Set();
  for (const argument of args) {
    const match = /^--(book-id|delay-ms)=(.+)$/.exec(argument);
    if (!match || seen.has(match[1]))
      throw new Error("Use --book-id=UUID [--delay-ms=700], once each");
    seen.add(match[1]);
    if (match[1] === "book-id") options.bookId = match[2];
    else options.delayMs = Number(match[2]);
  }
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(options.bookId))
    throw new Error("An explicit expected --book-id=UUID is required");
  if (!Number.isInteger(options.delayMs) || options.delayMs < 500 || options.delayMs > 2000)
    throw new Error("--delay-ms must be an integer from 500 to 2000");
  return options;
}

export function selectTarget(targets, devices) {
  const booted = Object.values(devices.devices ?? {})
    .flat()
    .filter((item) => item.state === "Booted");
  if (booted.length !== 1 || booted[0].udid !== SIMULATOR_ID)
    throw new Error("Only the fixed QA Simulator may be booted");
  const candidates = targets.filter(
    (item) => item.appId === APP_ID && /^(iPhone|iPad) /.test(item.deviceName ?? ""),
  );
  if (candidates.length !== 1)
    throw new Error(`Expected one iOS Narra inspector, found ${candidates.length}`);
  const target = candidates[0];
  if (target.deviceName !== booted[0].name)
    throw new Error("Inspector must be on the fixed QA Simulator");
  const url = new URL(target.webSocketDebuggerUrl);
  if (
    url.protocol !== "ws:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "8081" ||
    url.username ||
    url.password
  )
    throw new Error("Inspector must use local Metro port 8081");
  return target;
}

// Do not require/initialize modules or write globals. Read only already initialized exports.
export const CONTEXT_EXPRESSION = `(() => {
  if (typeof HermesInternal !== 'object' || HermesInternal === null) throw new Error('Hermes runtime required');
  if (typeof __r !== 'function' || typeof __r.getModules !== 'function') throw new Error('Metro modules unavailable');
  const matches = Array.from(__r.getModules()).filter(([, module]) =>
    module.isInitialized === true && /(?:^|\\/)core\\/src\\/ai\\/reading-context-service\\.ts$/.test(module.verboseName || ''));
  if (matches.length !== 1) throw new Error('Expected one initialized reading context service');
  const service = matches[0][1].publicModule?.exports?.readingContextService;
  if (!service || typeof service.getContext !== 'function') throw new Error('Reading context export unavailable');
  const context = service.getContext();
  if (!context) return null;
  return { bookId: context.bookId, cfi: context.currentPosition?.cfi,
    percentage: context.currentPosition?.percentage, timestamp: context.timestamp,
    chapterIndex: context.currentChapter?.index };
})()`;

function checkedContext(context, bookId) {
  if (
    !context ||
    context.bookId !== bookId ||
    typeof context.cfi !== "string" ||
    !context.cfi.trim() ||
    !Number.isFinite(context.timestamp) ||
    context.timestamp <= 0
  )
    throw new Error(
      "Expected book must remain loaded with a published CFI and timestamp; no termination performed",
    );
  return context;
}

async function beforeDeadline(operation, remainingMs) {
  let timer;
  try {
    return await Promise.race([
      operation().then((value) => ({ expired: false, value })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ expired: true }), Math.max(0, remainingMs));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Dependencies are injectable so tests never connect to or terminate a native app. */
export async function observeThenTerminate({
  bookId,
  delayMs,
  readContext,
  terminate,
  assertConnected = () => {},
  log = () => {},
  now = () => performance.now(),
}) {
  const initialRead = await beforeDeadline(readContext, 2500);
  if (initialRead.expired)
    throw new Error("Initial context read timed out; no termination performed");
  const initial = checkedContext(initialRead.value, bookId);
  const armedAt = now();
  log({
    event: "armed",
    initial,
    delayMs,
    timingOrigin: "first observed changed bridge-published CFI, NOT physical tap",
  });
  let latest = initial;
  let observedAt = armedAt;
  let firstChangedAt = null;
  let readPendingAtKill = false;
  while (true) {
    const deadline = firstChangedAt === null ? armedAt + 45000 : firstChangedAt + delayMs;
    const remaining = deadline - now();
    if (remaining <= 0) {
      if (firstChangedAt === null)
        throw new Error("No changed CFI within 45 seconds; no termination performed");
      break;
    }
    const read = await beforeDeadline(
      readContext,
      Math.min(firstChangedAt === null ? 2500 : remaining, remaining),
    );
    if (read.expired) {
      if (firstChangedAt === null)
        throw new Error("Context read stalled before a changed CFI; no termination performed");
      readPendingAtKill = true;
      break;
    }
    const context = checkedContext(read.value, bookId);
    observedAt = now();
    if (context.cfi !== latest.cfi) {
      latest = context;
      if (firstChangedAt === null) firstChangedAt = observedAt;
      log({ event: "position", context, sinceFirstChangeMs: observedAt - firstChangedAt });
    } else latest = context;
    const nextDeadline = firstChangedAt === null ? armedAt + 45000 : firstChangedAt + delayMs;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, Math.min(50, nextDeadline - now()))),
    );
  }
  assertConnected();
  const requestedAt = now();
  const report = {
    initial,
    latestObserved: latest,
    delayMs,
    observedToKillRequestMs: requestedAt - firstChangedAt,
    latestObservationAgeMs: requestedAt - observedAt,
    readPendingAtKill,
  };
  log({ event: "killRequested", ...report });
  await terminate();
  const result = {
    event: "terminated",
    ...report,
    observedToTerminationCompleteMs: now() - firstChangedAt,
  };
  log(result);
  return result;
}

async function connectInspector(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl, { origin: ORIGIN });
  const pending = new Map();
  let nextId = 0;
  let failed = null;
  function fail(error) {
    failed = error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  }
  socket.on("error", () => fail(new Error("Inspector connection failed")));
  socket.on("close", () => fail(new Error("Inspector disconnected")));
  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error || message.result?.exceptionDetails)
      entry.reject(new Error("Read-only context evaluation failed"));
    else entry.resolve(message.result?.result?.value);
  });
  try {
    const connected = await beforeDeadline(
      () =>
        new Promise((resolve, reject) => {
          socket.once("open", resolve);
          socket.once("error", reject);
        }),
      5000,
    );
    if (connected.expired) throw new Error("Inspector connect timed out");
  } catch (error) {
    socket.terminate();
    throw error;
  }
  return {
    assertConnected: () => {
      if (failed || socket.readyState !== WebSocket.OPEN)
        throw new Error("Inspector disconnected; no termination performed");
    },
    readContext: () => {
      if (failed) return Promise.reject(failed);
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(
          JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression: CONTEXT_EXPRESSION, returnByValue: true },
          }),
          (error) => {
            if (error) {
              pending.delete(id);
              reject(new Error("Inspector send failed"));
            }
          },
        );
      });
    },
    close: () => {
      fail(new Error("QA observer closed"));
      socket.terminate();
    },
  };
}

/** @param {(file: string, args: string[], options: {timeout: number, maxBuffer: number}) => Promise<unknown>} run */
export async function terminateFixedApp(run = execute) {
  await run("/usr/bin/xcrun", ["simctl", "terminate", SIMULATOR_ID, APP_ID], {
    timeout: 10000,
    maxBuffer: 65536,
  });
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const response = await fetch(`${ORIGIN}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Local Metro inspector list unavailable");
  const { stdout } = await execute(
    "/usr/bin/xcrun",
    ["simctl", "list", "devices", "booted", "--json"],
    { timeout: 5000, maxBuffer: 1048576 },
  );
  const target = selectTarget(await response.json(), JSON.parse(stdout));
  const inspector = await connectInspector(target);
  try {
    await observeThenTerminate({
      ...options,
      readContext: inspector.readContext,
      assertConnected: inspector.assertConnected,
      terminate: terminateFixedApp,
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  } finally {
    inspector.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "failed", message: error.message }));
    process.exitCode = 1;
  });
}
