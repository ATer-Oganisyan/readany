#!/usr/bin/env node
// QA cleanup: restore native Fast Refresh on the fixed iOS dev client only.
import { execFileSync } from "node:child_process";
import WebSocket from "ws";
import { selectTarget } from "./ios-reader-checkpoint-kill.mjs";

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
  const found = Array.from(__r.getModules()).filter(([,m]) => m.isInitialized && (m.verboseName||'').endsWith('/src/private/specs_DEPRECATED/modules/NativeDevSettings.js'));
  if(found.length !== 1) throw new Error('Expected one initialized native DevSettings module');
  const settings = found[0][1].publicModule.exports.default;
  if(typeof settings?.setHotLoadingEnabled !== 'function') throw new Error('Native Fast Refresh setter unavailable');
  settings.setHotLoadingEnabled(true);
  return {requestedFastRefresh:true,method:'native DevSettings.setHotLoadingEnabled; verify persisted RCTDevMenu separately'};
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
    JSON.stringify({
      at: new Date().toISOString(),
      readOnly: false,
      ...result.result.result.value,
    }),
  );
} finally {
  socket.close();
}
