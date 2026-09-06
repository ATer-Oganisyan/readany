#!/usr/bin/env node
// Explicit QA navigation action, only the prevalidated own PDF in the fixed Simulator.
// Does not write SQLite/files or inject renderer completion. Trigger is not a UI tap.
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
  const lookup = (suffix) => { const found = Array.from(__r.getModules()).filter(([, m]) => m.isInitialized && (m.verboseName || '').endsWith(suffix)); if (found.length !== 1) throw new Error('Expected initialized module '+suffix); return found[0][1].publicModule.exports; };
  const ref = lookup('/lib/navigationRef.ts').navigationRef;
  const books = lookup('/stores/library-store.ts').useLibraryStore.getState().books;
  const bookId = '0e53a2f5-4985-4691-bd68-b2832405f380';
  const book = books.find(b => b.id === bookId);
  if (!book || book.meta.title !== '11-river-library' || book.currentCfi !== 'epubcfi(/6/10)') throw new Error('Own PDF must be saved on page 5');
  const before = ref.getRootState();
  if (before.routes.some(r => r.name === 'Reader')) throw new Error('No Reader may already exist');
  const navigation = { getState: () => ref.getRootState(), dispatch: a => ref.dispatch(a), navigate: (name, params) => ref.navigate(name, params) };
  lookup('/lib/library/open-mobile-book.ts').openMobileBook({bookId, cfi:'epubcfi(/6/8)', navigation, t:(_key,fallback)=>fallback}).catch(error => console.error('[QA initial note request]',error));
  return {requestedBookId:bookId, savedCfi:book.currentCfi, requestedCfi:'epubcfi(/6/8)', beforeRouteNames:before.routes.map(r=>r.name), trigger:'actual native openMobileBook through inspector; NOT a physical UI entry'};
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
