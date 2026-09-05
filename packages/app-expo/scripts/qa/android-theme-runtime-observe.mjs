#!/usr/bin/env node
// Read-only native theme observation; --expect-system-light asserts the final QA state.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import WebSocket from "ws";

const adb = process.env.ANDROID_ADB ?? "adb";
const osNightMode = execFileSync(adb, ["-s", "emulator-5554", "shell", "cmd", "uimode", "night"], {
  encoding: "utf8",
  timeout: 5000,
}).trim();
const origin = "http://127.0.0.1:8081";
const targets = await (
  await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(3000) })
).json();
const targetsAndroid = targets.filter(
  (target) =>
    target.appId === "com.mishanaer.readany.dev" &&
    target.deviceName?.includes("sdk_gphone64_arm64"),
);
if (targetsAndroid.length !== 1) throw new Error("Expected one Android Narra QA runtime");
const socket = new WebSocket(targetsAndroid[0].webSocketDebuggerUrl, { origin });
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
  const response = await new Promise((resolve, reject) => {
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
            const modules=Array.from(__r.getModules()).filter(([,m])=>m.isInitialized);
            const appearance=modules.find(([,m])=>m.verboseName?.endsWith('Libraries/Utilities/Appearance.js'));
            const native=modules.find(([,m])=>m.verboseName?.endsWith('uniwind/src/core/config/config.native.ts'));
            if (!appearance || !native) throw new Error('Actual native appearance/theme modules missing');
            const api=appearance[1].publicModule.exports.default??appearance[1].publicModule.exports;
            const config=native[1].publicModule.exports.Uniwind;
            return {appearance:api.getColorScheme(),uniwind:{module:native[1].verboseName,current:config.currentTheme,adaptive:config.hasAdaptiveThemes}};
          })()`,
        },
      }),
    );
  });
  if (response.error || response.result?.exceptionDetails)
    throw new Error(JSON.stringify(response));
  const result = { at: new Date().toISOString(), osNightMode, ...response.result.result.value };
  console.log(JSON.stringify(result));
  if (process.argv.includes("--expect-system-light")) {
    assert.equal(osNightMode, "Night mode: no");
    assert.equal(result.appearance, "light");
    assert.equal(result.uniwind.current, "light");
    assert.equal(result.uniwind.adaptive, true);
  }
} finally {
  socket.close();
}
