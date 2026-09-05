// Read-only inspector for the isolated Air only; never selects TEST devices.
import WebSocket from "ws";
const origin = "http://127.0.0.1:8082";
const targets = await (
  await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(3000) })
).json();
const selected = targets.filter(
  (t) => t.appId === "com.mishanaer.readany.dev" && t.deviceName === "iPhone Air",
);
if (selected.length !== 1) throw new Error("Expected unique isolated Air runtime");
const socket = new WebSocket(selected[0].webSocketDebuggerUrl, { origin });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Connect timeout")), 5000);
  socket.once("open", () => {
    clearTimeout(timer);
    resolve();
  });
  socket.once("error", reject);
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
      const get=(suffix)=>modules.find(([,m])=>(m.verboseName||'').endsWith(suffix))?.[1].publicModule.exports;
      const profile=get('src/lib/ai/narra-gateway-config.ts')?.getEffectiveNarraGatewayProfile();
      const library=get('src/stores/library-store.ts')?.useLibraryStore.getState();
      const context=get('core/src/ai/reading-context-service.ts')?.readingContextService.getContext();
      return {profile,books:library?.books.map(b=>({id:b.id,title:b.title,progress:b.progress,cfi:b.cfi})),context:context&&{bookId:context.bookId,cfi:context.currentPosition?.cfi,percentage:context.currentPosition?.percentage}};
    })()`,
        },
      }),
    );
  });
  if (response.error || response.result?.exceptionDetails)
    throw new Error(JSON.stringify(response));
  console.log(
    JSON.stringify(
      { at: new Date().toISOString(), readOnly: true, ...response.result.result.value },
      null,
      2,
    ),
  );
} finally {
  socket.close();
}
