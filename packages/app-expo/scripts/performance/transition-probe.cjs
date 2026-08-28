// Local Debug-only probe; resolves dependencies from this worktree, never a fixed checkout.
const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("ws");
const port = Number(process.env.READANY_METRO_PORT || 8082);
const [command = "status", output] = process.argv.slice(2);
async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const target = targets.find((t) => t.appId === "com.mishanaer.readany.dev");
  if (!target) throw new Error(`No Narra Hermes runtime on Metro ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl, { origin: `http://127.0.0.1:${port}` });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  try {
    const expression =
      command === "start"
        ? "globalThis.__NARRA_PERF__?.start()"
        : command === "stop"
          ? "globalThis.__NARRA_PERF__?.stop()"
          : command === "gauges"
            ? "({catalog:globalThis.__NARRA_CATALOG_STATUS__?.(),covers:globalThis.__NARRA_COVER_STATUS__?.()})"
            : '({ready:!!globalThis.__NARRA_PERF__,dev:typeof __DEV__!=="undefined"&&__DEV__})';
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP timeout")), 15000);
      socket.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id !== 1) return;
        clearTimeout(timeout);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      });
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      );
    });
    if (response.exceptionDetails) throw new Error("Probe execution failed");
    const value = response.result?.value;
    if (!value) throw new Error("Probe unavailable or expired (45s watchdog)");
    const payload = {
      capturedAt: new Date().toISOString(),
      port,
      worktree: path.resolve(__dirname, "../../../.."),
      cpuProfiling: false,
      ...value,
    };
    if (output) fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(
      JSON.stringify(
        command === "stop"
          ? {
              ...payload,
              samples: payload.samples.length,
              maxDelayMs: Math.max(0, ...payload.samples.map((s) => s.delayMs)),
            }
          : payload,
      ),
    );
  } finally {
    socket.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
