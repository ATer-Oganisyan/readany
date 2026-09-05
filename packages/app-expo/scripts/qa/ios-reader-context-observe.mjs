#!/usr/bin/env node
// Bounded, read-only observation of the already initialized native reading context.
import { execFileSync } from "node:child_process";
import WebSocket from "ws";
import { CONTEXT_EXPRESSION, selectTarget } from "./ios-reader-checkpoint-kill.mjs";

const durationMs = Number(
  process.argv.find((arg) => arg.startsWith("--duration-ms="))?.split("=")[1] ?? 180000,
);
if (!Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 300000) {
  throw new Error("Use --duration-ms=1000..300000");
}
const origin = "http://127.0.0.1:8081";
const targets = await (
  await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(3000) })
).json();
const devices = JSON.parse(
  execFileSync("xcrun", ["simctl", "list", "devices", "booted", "--json"], {
    encoding: "utf8",
    timeout: 5000,
  }),
);
const target = selectTarget(targets, devices);
const socket = new WebSocket(target.webSocketDebuggerUrl, { origin });
let nextId = 0;
let closed = false;
const pending = new Map();
socket.on("message", (data) => {
  const message = JSON.parse(String(data));
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.error || message.result?.exceptionDetails)
    waiter.reject(new Error("Context unavailable"));
  else waiter.resolve(message.result?.result?.value);
});
socket.on("close", () => {
  closed = true;
});
socket.on("error", () => {
  closed = true;
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Inspector connection timeout")), 5000);
  socket.once("open", () => {
    clearTimeout(timer);
    resolve();
  });
  socket.once("error", () => {
    clearTimeout(timer);
    reject(new Error("Inspector connection failed"));
  });
});
function read() {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Context read timeout"));
    }, 3000);
    pending.set(id, { resolve, reject, timer });
    socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression: CONTEXT_EXPRESSION, returnByValue: true },
      }),
    );
  });
}
const started = performance.now();
let previous = "";
console.log(
  JSON.stringify({ event: "observing", at: new Date().toISOString(), durationMs, readOnly: true }),
);
try {
  while (!closed && performance.now() - started < durationMs) {
    try {
      const context = await read();
      const signature = JSON.stringify(context);
      if (signature !== previous) {
        console.log(
          JSON.stringify({
            event: "context",
            at: new Date().toISOString(),
            elapsedMs: performance.now() - started,
            context,
          }),
        );
        previous = signature;
      }
    } catch (error) {
      console.log(
        JSON.stringify({
          event: "readError",
          elapsedMs: performance.now() - started,
          message: error.message,
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
} finally {
  socket.close();
  console.log(
    JSON.stringify({
      event: "stopped",
      elapsedMs: performance.now() - started,
      disconnected: closed,
    }),
  );
}
