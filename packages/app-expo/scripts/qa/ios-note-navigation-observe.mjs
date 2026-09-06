#!/usr/bin/env node
// Read-only, bounded observation of navigation/context in the fixed QA Simulator.
import { execFileSync } from "node:child_process";
import WebSocket from "ws";
import { CONTEXT_EXPRESSION, selectTarget } from "./ios-reader-checkpoint-kill.mjs";

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
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Inspector timeout")), 5000);
  socket.once("open", () => {
    clearTimeout(timer);
    resolve();
  });
  socket.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
});
const expression = `(() => {
  const matches = Array.from(__r.getModules()).filter(([, m]) => m.isInitialized && /(?:^|\\/)lib\\/navigationRef\\.ts$/.test(m.verboseName || ''));
  if (matches.length !== 1) throw new Error('Expected one initialized navigation ref');
  const state = matches[0][1].publicModule.exports.navigationRef.getRootState();
  function clean(s) { return s ? { index: s.index, routes: s.routes.map(r => ({name:r.name,key:r.key,bookId:r.params?.bookId,cfi:r.params?.cfi,highlight:r.params?.highlight,state:clean(r.state)}))} : null; }
  return {navigation:clean(state), context:${CONTEXT_EXPRESSION}};
})()`;
try {
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Read timeout")), 5000);
    socket.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)));
    });
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }),
    );
  });
  if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
  console.log(
    JSON.stringify({ at: new Date().toISOString(), readOnly: true, ...result.result.result.value }),
  );
} finally {
  socket.close();
}
