#!/usr/bin/env node
// Authorized, reversible diagnostic for the ORIGINAL audit 26 EPUB only.
// --allow temporarily stops propagation at the own frame window WITHOUT
// preventing default, before the document's blanket blocker. --restore removes
// that temporary boundary. No text, progress, settings, SQLite, or assets change.
import { execFileSync } from "node:child_process";

const mode = process.argv.includes("--allow")
  ? "allow"
  : process.argv.includes("--restore")
    ? "restore"
    : "inspect";
const adb = process.env.ANDROID_ADB ?? "adb";
const android = (...args) =>
  execFileSync(adb, ["-s", "emulator-5554", ...args], { encoding: "utf8", timeout: 15000 });
const pid = android("shell", "pidof", "com.mishanaer.readany.dev").trim().split(/\s+/)[0];
if (!/^\d+$/.test(pid)) throw new Error("Open the original QA book first");
android("forward", "tcp:9232", `localabstract:webview_devtools_remote_${pid}`);
const targets = await (
  await fetch("http://127.0.0.1:9232/json", { signal: AbortSignal.timeout(3000) })
).json();
const target = targets.find((item) => {
  const description = JSON.parse(item.description || "{}");
  return description.attached && description.height > 100 && description.width > 100;
});
if (!target) throw new Error("The own QA reader must be visible");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await Promise.race([
  new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  }),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("CDP connect timeout")), 3000).unref(),
  ),
]);
try {
  const result = new Promise((resolve) => {
    socket.onmessage = ({ data }) => resolve(JSON.parse(data));
  });
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        includeCommandLineAPI: true,
        returnByValue: true,
        expression: `(() => {
      const view = document.querySelector('foliate-view');
      const docs = view?.renderer?.getContents()?.map(({ doc }) => doc) ?? [];
      if (!docs.some(doc => doc.body?.textContent.includes('Аудит 26'))) throw new Error('Only own audit 26 is in scope');
      const mode = ${JSON.stringify(mode)};
      if (mode === 'restore') {
        const saved = window.__narraAuditContextMenuSaved ?? [];
        for (const { target, listener } of saved) target.removeEventListener('contextmenu', listener, true);
        delete window.__narraAuditContextMenuSaved;
        return { restored: saved.length, cfi: view.lastLocation?.cfi };
      }
      const groups = docs.map(doc => ({ doc, entries: (getEventListeners(doc).contextmenu ?? []).filter(entry => {
        const source = String(entry.listener);
        return source.includes('preventDefault') && source.includes('stopPropagation');
      }) }));
      const count = groups.reduce((n, item) => n + item.entries.length, 0);
      const evidence = { mode, cfi: view.lastLocation?.cfi, count, documents: docs.map(doc => {
        const event = new doc.defaultView.MouseEvent('contextmenu', {bubbles: true, cancelable: true});
        doc.body.dispatchEvent(event);
        return {url: doc.URL, connected: doc.isConnected, selection: doc.getSelection()?.toString(), hasSelectionWiring: doc.__readany_selection, contextDefaultPrevented: event.defaultPrevented, eventTypes: Object.keys(getEventListeners(doc)), context: (getEventListeners(doc).contextmenu ?? []).map(entry => ({keys: Object.keys(entry), source: String(entry.listener)}))};
      }), callbacks: groups.flatMap(({ entries }) => entries.map(entry => ({ capture: entry.useCapture, source: String(entry.listener) }))) };
      if (mode === 'allow') {
        if (!evidence.documents.every(doc => doc.contextDefaultPrevented) || window.__narraAuditContextMenuSaved) throw new Error('Expected untouched blocked own document');
        const boundaries = docs.map(doc => ({target: doc.defaultView, listener: event => event.stopImmediatePropagation()}));
        window.__narraAuditContextMenuSaved = boundaries;
        for (const { target, listener } of boundaries) target.addEventListener('contextmenu', listener, true);
        evidence.afterDefaultPrevented = docs.map(doc => {
          const event = new doc.defaultView.MouseEvent('contextmenu', {bubbles:true, cancelable:true});
          doc.body.dispatchEvent(event);
          return event.defaultPrevented;
        });
      }
      return evidence;
    })()`,
      },
    }),
  );
  const response = await Promise.race([
    result,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("CDP evaluate timeout")), 3000).unref(),
    ),
  ]);
  if (response.error || response.result?.exceptionDetails)
    throw new Error(JSON.stringify(response));
  console.log(JSON.stringify(response.result.result.value));
} finally {
  socket.close();
}
