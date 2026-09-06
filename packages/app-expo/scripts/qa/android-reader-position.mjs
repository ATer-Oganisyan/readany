#!/usr/bin/env node
// Local native QA: physical Android taps, read-only WebView observations.
// Does not modify app state through CDP or clear application data.
import { execFileSync } from "node:child_process";

const adb = process.env.ANDROID_ADB ?? "adb";
const serial = process.env.ANDROID_SERIAL ?? "emulator-5554";
const appId = "com.mishanaer.readany.dev";
const turns = Number(process.argv.find((arg) => arg.startsWith("--turns="))?.split("=")[1] ?? 0);
const direction =
  process.argv.find((arg) => arg.startsWith("--direction="))?.split("=")[1] ?? "next";
const settleMs = Number(
  process.argv.find((arg) => arg.startsWith("--settle-ms="))?.split("=")[1] ?? 700,
);
const betweenMs = Number(
  process.argv.find((arg) => arg.startsWith("--between-ms="))?.split("=")[1] ?? 0,
);
if (
  !["next", "prev"].includes(direction) ||
  !Number.isInteger(turns) ||
  turns < 0 ||
  turns > 100 ||
  !Number.isFinite(settleMs) ||
  settleMs < 0 ||
  settleMs > 5000 ||
  !Number.isFinite(betweenMs) ||
  betweenMs < 0 ||
  betweenMs > 5000
) {
  throw new Error(
    "Use --direction=next|prev, --turns=0..100, --settle-ms=0..5000 and --between-ms=0..5000",
  );
}
const android = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8" });
const pid = android("shell", "pidof", appId).trim().split(/\s+/)[0];
if (!/^\d+$/.test(pid)) throw new Error("Narra must already be open in its reader");
android("forward", "tcp:9232", `localabstract:webview_devtools_remote_${pid}`);
const targets = await (
  await fetch("http://127.0.0.1:9232/json", { signal: AbortSignal.timeout(3000) })
).json();
const target = targets.find((item) => {
  const description = JSON.parse(item.description || "{}");
  return description.attached && description.height > 100 && description.width > 100;
});
if (!target) throw new Error("No attached Narra WebView; open a book first");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await Promise.race([
  new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  }),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("CDP connect timed out")), 3000).unref(),
  ),
]);
let nextId = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const result = JSON.parse(data);
  if (!result.id) return;
  pending.get(result.id)?.(result);
  pending.delete(result.id);
};
async function position() {
  const id = ++nextId;
  const response = new Promise((resolve) => pending.set(id, resolve));
  socket.send(
    JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: {
        expression: `JSON.stringify((()=>{const view=document.querySelector('foliate-view');const position=view?.lastLocation;return {asset:location.href,cfi:position?.cfi,fraction:position?.fraction,section:view?.renderer?.index,text:position?.range?.toString()?.slice(0,300),chapter:position?.tocItem?.label,frames:view?.renderer?.getContents()?.map(({doc,index})=>({index,url:doc?.URL,text:doc?.body?.innerText?.slice(0,100),sceneSlots:Array.from(doc?.querySelectorAll('.readany-scene-insert')??[]).map(slot=>({state:slot.getAttribute('data-readany-scene-state'),anchor:slot.getAttribute('data-readany-scene-anchor')})),images:Array.from(doc?.images??[]).map(img=>({loaded:img.complete,width:img.naturalWidth,height:img.naturalHeight}))}))}})())`,
        returnByValue: true,
      },
    }),
  );
  const result = await Promise.race([
    response,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("CDP position timed out")), 3000).unref(),
    ),
  ]);
  if (result.error || result.result.exceptionDetails) throw new Error(JSON.stringify(result));
  return JSON.parse(result.result.result.value);
}
try {
  const initial = await position();
  if (!initial.cfi) throw new Error("Attached WebView is not a loaded reader");
  console.log(JSON.stringify({ initial }));
  let previous = initial.cfi;
  for (let turn = 1; turn <= turns; turn++) {
    const start = Date.now();
    android("shell", "input", "tap", direction === "next" ? "1024" : "56", "1000");
    let state = await position();
    while (state.cfi === previous && Date.now() - start < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      state = await position();
    }
    const elapsedMs = Date.now() - start;
    const firstObservedCfi = state.cfi;
    if (betweenMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, betweenMs));
      state = await position();
    }
    console.log(
      JSON.stringify({
        turn,
        direction,
        elapsedMs,
        ...(betweenMs > 0 ? { firstObservedCfi, settledAfterMs: betweenMs } : {}),
        changed: state.cfi !== previous,
        ...state,
      }),
    );
    if (!state.cfi || state.cfi === previous) process.exitCode = 1;
    previous = state.cfi;
  }
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  console.log(JSON.stringify({ settled: await position(), settleMs }));
  if (process.argv.includes("--kill")) {
    android("shell", "am", "force-stop", appId);
    console.log(JSON.stringify({ forceStopped: true }));
  }
} finally {
  socket.close();
}
