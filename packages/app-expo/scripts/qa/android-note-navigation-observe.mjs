#!/usr/bin/env node
// Read-only Android QA navigation observation. Never dispatches a navigation action.
import WebSocket from "ws";

const origin = "http://127.0.0.1:8081";
const targets = await (
  await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(3000) })
).json();
const matches = targets.filter(
  (target) =>
    target.appId === "com.mishanaer.readany.dev" &&
    target.deviceName?.includes("sdk_gphone64_arm64"),
);
if (matches.length !== 1) throw new Error("Expected one Android Narra QA runtime");
const socket = new WebSocket(matches[0].webSocketDebuggerUrl, { origin });
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
        params: {
          returnByValue: true,
          expression: `(() => {
            const matches = Array.from(__r.getModules()).filter(([, m]) => m.isInitialized && /(?:^|\\/)lib\\/navigationRef\\.ts$/.test(m.verboseName || ''));
            if (matches.length !== 1) throw new Error('Expected one initialized navigation ref');
            const state = matches[0][1].publicModule.exports.navigationRef.getRootState();
            function clean(s) { return s ? {index:s.index,routes:s.routes.map(r=>({name:r.name,key:r.key,bookId:r.params?.bookId,cfi:r.params?.cfi,state:clean(r.state)}))} : null; }
            return {navigation:clean(state)};
          })()`,
        },
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
