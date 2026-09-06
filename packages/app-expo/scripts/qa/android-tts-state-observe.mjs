// Read-only RN state observation after real UI Start/Stop actions. No playback calls.
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
        const matches = Array.from(__r.getModules()).filter(([, m]) => m.isInitialized && /(?:^|\\/)stores\\/tts-store\\.ts$/.test(m.verboseName || ''));
        const selected = matches.filter(([, m]) => m.verboseName === 'src/stores/tts-store.ts' || (m.verboseName || '').includes('/app-expo/src/stores/tts-store.ts'));
        if(selected.length !== 1) throw new Error('Expected initialized mobile TTS store: ' + matches.map(([,m]) => m.verboseName).join(', '));
        const state = selected[0][1].publicModule.exports.useTTSStore.getState();
        return { playState: state.playState, explicitCancellationEpoch: state.explicitCancellationEpoch, currentBookId: state.currentBookId, currentBookTitle: state.currentBookTitle, currentLocationCfi: state.currentLocationCfi, currentText: state.currentText?.slice(0,300), currentSegmentText: state.currentSegmentText?.slice(0,300), currentChunkIndex: state.currentChunkIndex, totalChunks: state.totalChunks };
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
