#!/usr/bin/env node
// Bounded, read-only CPU sampling of the Android debug runtime, never iOS.
import WebSocket from "ws";
const targets = await (
  await fetch("http://127.0.0.1:8081/json/list", { signal: AbortSignal.timeout(5000) })
).json();
const target = targets.find(
  (item) =>
    item.appId === "com.mishanaer.readany.dev" && item.deviceName?.includes("sdk_gphone64_arm64"),
);
if (!target) throw new Error("Android Narra Hermes inspector is not available");
const socket = new WebSocket(target.webSocketDebuggerUrl, {
  origin: "http://127.0.0.1:8081",
});
await Promise.race([
  new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = (event) => reject(event.error ?? new Error(event.message));
  }),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Inspector connection timeout")), 10000).unref(),
  ),
]);
let nextId = 0;
const pending = new Map();
const traceEvents = [];
let completeTrace;
const tracingComplete = new Promise((resolve) => {
  completeTrace = resolve;
});
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Tracing.dataCollected") traceEvents.push(...message.params.value);
  if (message.method === "Tracing.tracingComplete") completeTrace();
  pending.get(message.id)?.(message);
  pending.delete(message.id);
};
async function request(method, params) {
  const id = ++nextId;
  const response = new Promise((resolve) => pending.set(id, resolve));
  socket.send(JSON.stringify({ id, method, params }));
  const result = await Promise.race([
    response,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${method} timeout`)), 15000).unref(),
    ),
  ]);
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.result;
}
try {
  await request("Tracing.start", {
    categories: "disabled-by-default-v8.cpu_profiler,devtools.timeline",
  });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await request("Tracing.end");
  await Promise.race([
    tracingComplete,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Trace flush timeout")), 15000).unref(),
    ),
  ]);
  console.log(JSON.stringify({ traceEvents }));
} finally {
  socket.close();
}
