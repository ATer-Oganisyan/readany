#!/usr/bin/env node
// Calls the actual native Expo service, using only new QA-owned cache files.
import WebSocket from "ws";

const platform =
  process.argv.find((arg) => arg.startsWith("--platform="))?.split("=")[1] ?? "android";
if (!["android", "ios"].includes(platform)) throw new Error("Use --platform=android|ios");
const fixtureBase = "http://127.0.0.1:8099";
if (new URL(fixtureBase).origin !== "http://127.0.0.1:8099")
  throw new Error("Only the local QA fixture server is allowed");
const targets = await (
  await fetch("http://127.0.0.1:8081/json/list", { signal: AbortSignal.timeout(5000) })
).json();
const candidates = targets.filter(
  (item) =>
    item.appId === "com.mishanaer.readany.dev" &&
    (platform === "android"
      ? item.deviceName?.includes("sdk_gphone64_arm64")
      : /^(iPhone|iPad) /.test(item.deviceName ?? "")),
);
if (candidates.length !== 1)
  throw new Error(`Expected one ${platform} Narra inspector, found ${candidates.length}`);
const target = candidates[0];
const socket = new WebSocket(target.webSocketDebuggerUrl, { origin: "http://127.0.0.1:8081" });
await Promise.race([
  new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  }),
  new Promise((_, reject) => setTimeout(() => reject(new Error("Connect timeout")), 10000).unref()),
]);
let nextId = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
};
async function evaluate(expression) {
  const id = ++nextId;
  const result = new Promise((resolve) => pending.set(id, resolve));
  socket.send(
    JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }),
  );
  const response = await Promise.race([
    result,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Evaluate timeout")), 5000).unref(),
    ),
  ]);
  if (response.error || response.result?.exceptionDetails)
    throw new Error(JSON.stringify(response));
  return response.result.result.value;
}
const key = `__narraNativeDownloadQa${Date.now()}`;
try {
  await evaluate(`(() => {
    const key = ${JSON.stringify(key)};
    const fixtureBase = ${JSON.stringify(fixtureBase)};
    globalThis[key] = { pending: true };
    (async () => {
      const modules = Array.from(__r.getModules());
      const serviceModule = modules.find(([, module]) => module.verboseName === 'src/lib/platform/expo-platform-service.ts');
      const fileModule = modules.find(([, module]) => /expo-file-system\\/src\\/index\\.ts$/.test(module.verboseName || ''));
      if (!serviceModule || !fileModule) throw new Error('Actual service/filesystem module not loaded');
      const service = new (__r(serviceModule[0]).ExpoPlatformService)();
      const { Paths } = __r(fileModule[0]);
      const prefix = Paths.cache.uri.replace(/\\/$/, '') + '/' + key;
      const paths = [prefix + '-stall.epub', prefix + '-retry.epub', prefix + '-precancel.epub'];
      for (const path of paths) if (await service.exists(path)) throw new Error('QA path collision');
      const report = { platform: ${JSON.stringify(platform)}, device: ${JSON.stringify(target.deviceName)}, module: serviceModule[1].verboseName, paths, progress: 0 };
      try {
        let started = Date.now();
        try {
          await service.downloadFile(fixtureBase + '/stall.epub', paths[0], {
            timeoutMs: 1000, onProgress: () => { report.progress++; },
          });
          report.timeout = { unexpectedSuccess: true };
        } catch (error) {
          report.timeout = { name: error.name, message: error.message, elapsedMs: Date.now() - started };
        }
        const settledProgress = report.progress;
        started = Date.now();
        await service.downloadFile(fixtureBase + '/01-river.epub', paths[1], { timeoutMs: 5000 });
        const bytes = await service.readFile(paths[1]);
        report.retry = { elapsedMs: Date.now() - started, bytes: bytes.length, zipMagic: Array.from(bytes.slice(0, 4)) };
        const controller = new AbortController();
        controller.abort();
        started = Date.now();
        try {
          await service.downloadFile(fixtureBase + '/stall.epub', paths[2], { timeoutMs: 1000, signal: controller.signal });
          report.precancel = { unexpectedSuccess: true };
        } catch (error) {
          report.precancel = { name: error.name, elapsedMs: Date.now() - started, fileExists: await service.exists(paths[2]) };
        }
        await new Promise(resolve => setTimeout(resolve, 1200));
        report.noLateProgress = report.progress === settledProgress;
        report.functionalPassed = report.timeout.name === 'TimeoutError' && report.retry.bytes > 0 && report.retry.zipMagic.join(',') === '80,75,3,4' && report.precancel.name === 'AbortError' && !report.precancel.fileExists && report.noLateProgress;
        report.timingPassed = report.timeout.elapsedMs >= 900 && report.timeout.elapsedMs < 3000 && report.precancel.elapsedMs < 200;
        report.passed = report.functionalPassed && report.timingPassed;
      } finally {
        for (const path of paths) await service.deleteFile(path);
        report.cleaned = (await Promise.all(paths.map(path => service.exists(path)))).every(exists => !exists);
      }
      return report;
    })().then(report => { globalThis[key] = report; }, error => { globalThis[key] = { error: String(error), stack: error.stack }; });
    return 'started';
  })()`);
  const started = Date.now();
  let result;
  while (Date.now() - started < 20000) {
    result = await evaluate(`globalThis[${JSON.stringify(key)}]`);
    if (!result?.pending) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result?.passed || !result?.cleaned) process.exitCode = 1;
} finally {
  await evaluate(`delete globalThis[${JSON.stringify(key)}]`).catch(() => {});
  socket.close();
}
