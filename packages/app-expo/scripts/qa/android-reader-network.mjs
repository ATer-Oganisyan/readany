#!/usr/bin/env node
// Read-only CDP observation. Open the intended QA book through native UI separately.
import { execFileSync } from "node:child_process";
const adb = process.env.ANDROID_ADB ?? "adb";
const android = (...args) =>
  execFileSync(adb, ["-s", "emulator-5554", ...args], { encoding: "utf8", timeout: 5000 });
const pid = android("shell", "pidof", "com.mishanaer.readany.dev").trim().split(/\s+/)[0];
if (!/^\d+$/.test(pid)) throw new Error("Open Android Narra first");
android("forward", "tcp:9232", `localabstract:webview_devtools_remote_${pid}`);
const started = Date.now();
let target;
while (!target && Date.now() - started < 90000) {
  const targets = await fetch("http://127.0.0.1:9232/json", { signal: AbortSignal.timeout(1000) })
    .then((response) => response.json())
    .catch(() => []);
  target = targets.find((item) => {
    const description = JSON.parse(item.description || "{}");
    return description.attached && description.height > 100 && description.width > 100;
  });
  if (!target) await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!target) throw new Error("No attached Android WebView within 90 seconds");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await Promise.race([
  new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  }),
  new Promise((_, reject) => setTimeout(() => reject(new Error("Connect timeout")), 5000).unref()),
]);
const responses = [];
const logs = [];
let nextId = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Network.responseReceived") {
    const response = message.params.response;
    if (/^http:\/\/127\.0\.0\.1:\d+\//.test(response.url))
      responses.push({ url: response.url, status: response.status, headers: response.headers });
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const text = message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ");
    if (/\[Reader\]|lazy|fallback/i.test(text)) logs.push(text);
  }
  pending.get(message.id)?.(message);
  pending.delete(message.id);
};
async function request(method, params = {}) {
  const id = ++nextId;
  const response = new Promise((resolve) => pending.set(id, resolve));
  socket.send(JSON.stringify({ id, method, params }));
  const result = await Promise.race([
    response,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${method} timeout`)), 5000).unref(),
    ),
  ]);
  if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
  return result.result;
}
try {
  await request("Network.enable");
  await request("Runtime.enable");
  let state;
  const observing = Date.now();
  while (Date.now() - observing < 45000) {
    state = (
      await request("Runtime.evaluate", {
        expression:
          "(()=>{const v=document.querySelector('foliate-view');return {asset:location.href,cfi:v?.lastLocation?.cfi,sections:v?.book?.sections?.length,title:v?.book?.metadata?.title}})()",
        returnByValue: true,
      })
    ).result.value;
    if (state?.cfi) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  console.log(
    JSON.stringify(
      {
        pid,
        state,
        responses,
        logs,
        observed206: responses.filter((response) => response.status === 206).length,
        fallbackObserved: logs.some((log) =>
          /Lazy loading failed|falling back to full fetch/.test(log),
        ),
      },
      null,
      2,
    ),
  );
} finally {
  socket.close();
}
