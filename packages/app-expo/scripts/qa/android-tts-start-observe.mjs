// Observe sentence extraction in an already-open QA book; never requests audio.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const adb = process.env.ANDROID_ADB ?? 'adb';
const serial = process.env.ANDROID_SERIAL ?? 'emulator-5554';
const android = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 5000 });
const pid = android('shell', 'pidof', 'com.mishanaer.readany.dev').trim().split(/\s+/)[0];
assert.match(pid, /^\d+$/);
android('forward', 'tcp:9232', `localabstract:webview_devtools_remote_${pid}`);
const targets = await (await fetch('http://127.0.0.1:9232/json', { signal: AbortSignal.timeout(3000) })).json();
const target = targets.find(item => {
  const info = JSON.parse(item.description || '{}');
  return info.attached && info.height > 100 && info.width > 100;
});
assert.ok(target, 'Open an audit fixture in the reader first');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const deadline = setTimeout(() => { socket.close(); throw new Error('Native TTS observation timed out'); }, 12000);
try {
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const response = new Promise(resolve => { socket.onmessage = ({ data }) => resolve(JSON.parse(data)); });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const view = document.querySelector('foliate-view');
      const cfiBefore = view?.lastLocation?.cfi;
      const visibleText = view?.lastLocation?.range?.toString() || '';
      const body = view?.renderer?.getContents()?.map(item => item.doc?.body?.innerText || '').join('') || '';
      if (!body.includes('Эпизод 2.4.') || !body.includes('Михаил')) throw new Error('This probe requires audit fixture 27, chapter 2');
      await ensureTTSEngine();
      const segments = extractVisibleTTSSegments(null);
      return { asset: location.href, cfiBefore, cfiAfter: view.lastLocation.cfi, visibleText: visibleText.slice(0, 200), segments: segments.slice(0, 3), diagnostics: window.__lastVisibleTTSDiagnostics };
    })()`
  } }));
  const result = await response;
  assert.ok(!result.error && !result.result?.exceptionDetails, JSON.stringify(result));
  const observed = result.result.result.value;
  console.log(JSON.stringify(observed, null, 2));
  assert.equal(observed.cfiBefore, observed.cfiAfter, 'Extracting speech must not move the reader');
  const first = observed.segments[0]?.text;
  assert.ok(first && observed.visibleText.trimStart().startsWith(first), 'Speech must start at the visible page boundary');
  console.log('PASS: native DOM speech starts at the visible boundary without changing reading position; no audio/API request.');
} finally {
  clearTimeout(deadline);
  socket.close();
}
