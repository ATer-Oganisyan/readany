import { baseColors, primaryColors, accentColors, spacingTokens, radiusTokens } from './tokens.js';
const root = document.documentElement;
const tokens = {
  bg: baseColors.find(c => c.name === 'Background Primary').dark,
  panel: baseColors.find(c => c.name === 'Elevation 2').dark,
  fg: primaryColors.find(c => c.name === 'Primary').dark,
  secondary: primaryColors.find(c => c.name === 'Primary 60').dark,
  accent: accentColors.find(c => c.name === 'Orange').dark,
  space: spacingTokens[24], radius: radiusTokens[26], 'control-radius': radiusTokens[10],
};
for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--${name}`, value);
const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let svg, motion, raf = 0, graceTimer, readyTimer;
let state = 'play', target = 'play', phase = 'idle', currentClip = 'enter', progress = 0;
const label = { play: 'Play', pause: 'Pause', loading: 'Loading' };
const clipTarget = { forward: 'pause', reverse: 'play', enter: 'loading', settle: 'loading', spin: 'loading', exit: 'pause', cancel: 'play' };
const activePhases = new Set(['enter', 'settle', 'exit', 'cancel', 'forward', 'reverse']);

function speedFor(name) {
  return Number($((name === 'forward' || name === 'reverse') ? 'directSpeed' : 'spinnerSpeed').value);
}
function durationFor(name) {
  const base = name === 'spin' ? motion.turnMs : name === 'settle' ? motion.settleMs : name === 'exit' ? motion.exitMs : 300;
  return base / speedFor(name);
}
function updateSpeedValue(id) {
  $(`${id}Value`).value = `${Number($(id).value).toFixed(2)}×`;
}

function show(name, fraction) {
  currentClip = name; progress = Math.max(0, Math.min(1, fraction));
  const [from, to] = motion.clips[name];
  // Seek native SVG path animation, avoiding floating-point segment boundaries.
  svg.setCurrentTime(from + (to - from) * progress + (progress === 0 ? 0.00001 : 0));
  $('clip').value = name;
  $('frame').value = progress * 100;
  $('frameLabel').value = `${(progress * 100).toFixed(1)}%`;
}
function controls() {
  const loading = state === 'loading' || target === 'loading' || phase === 'enter';
  $('startLoad').disabled = !svg || !$('spinnerMorph').checked || loading;
  $('ready').disabled = !loading;
  $('cancel').disabled = !loading;
  $('toggle').setAttribute('aria-pressed', String(target === 'pause'));
}
function status(text) { $('status').textContent = text; controls(); }
function halt() {
  cancelAnimationFrame(raf); clearTimeout(graceTimer); clearTimeout(readyTimer); phase = 'idle';
}
function still(next) {
  if (!svg) return;
  halt(); state = target = next;
  show(next === 'play' ? 'enter' : 'exit', next === 'play' ? 0 : 1);
  status(label[next]);
}
function run(name, from, to, done, start = performance.now()) {
  cancelAnimationFrame(raf); phase = name;
  const duration = durationFor(name);
  const end = start + Math.max(1, duration * Math.abs(to - from));
  show(name, from);
  status($('clip').selectedOptions[0].textContent);
  if (reducedMotion.matches) { show(name, to); done(performance.now()); return; }
  function tick(now) {
    const t = Math.min(Math.max(0, now - start) / (end - start), 1);
    show(name, from + (to - from) * t);
    if (t < 1) raf = requestAnimationFrame(tick);
    else done(end);
  }
  tick(performance.now());
}
function settled(next) { state = next; phase = 'idle'; status(label[next]); drive(); }
function leaveLoader(start) {
  const next = target === 'play' ? 'play' : 'pause';
  run(next === 'pause' ? 'exit' : 'cancel', 0, 1, () => settled(next), start);
}
function beginSettle(start) {
  state = 'loading';
  spin(0, start);
}
function spin(initial = motion.entryPhase, startAt = performance.now()) {
  state = 'loading'; phase = 'spinning';
  status(target === 'loading' ? 'Loading…' : 'Aligning for exit…');
  if (initial === (target === 'play' ? 0 : motion.exitPhase) && target !== 'loading') { leaveLoader(startAt); return; }
  if (reducedMotion.matches) {
    show('spin', 0);
    if (target !== 'loading') leaveLoader();
    return;
  }
  const turnMs = durationFor('spin');
  const start = startAt - initial * turnMs;
  let previous = initial;
  function tick(now) {
    const elapsed = (now - start) / turnMs;
    const exitAt = target === 'play' ? 0 : motion.exitPhase;
    // The two identical arcs repeat visually every half turn.
    const period = target === 'pause' ? 0.5 : 1;
    const boundary = (Math.floor((previous - exitAt) / period) + 1) * period + exitAt;
    if (elapsed >= boundary && target !== 'loading') {
      show('spin', exitAt); leaveLoader(start + boundary * turnMs); return;
    }
    previous = elapsed;
    show('spin', elapsed % 1);
    raf = requestAnimationFrame(tick);
  }
  tick(performance.now());
}
function drive() {
  if (!svg || activePhases.has(phase)) return;
  if (phase === 'spinning') {
    status(target === 'loading' ? 'Loading…' : 'Aligning for exit…');
    if (reducedMotion.matches && target !== 'loading') leaveLoader();
    return;
  }
  if (phase === 'inspection') {
    if (currentClip === 'spin') { spin(progress % 1); return; }
    const name = currentClip, next = clipTarget[name];
    run(name, progress, 1, end => name === 'enter' ? beginSettle(end) : name === 'settle' ? spin(motion.settlePhase, end) : settled(next));
    return;
  }
  if (phase === 'delay') {
    if (target === 'loading') return;
    clearTimeout(graceTimer); phase = 'idle';
  }
  if (target === state) { status(label[state]); return; }
  if (target === 'loading') {
    if (state === 'pause') { run('exit', 1, 0, end => spin(motion.exitPhase, end)); return; }
    // Ready before 120ms uses the ordinary morph and never flashes the loader.
    phase = 'delay'; status('Waiting for load…');
    graceTimer = setTimeout(() => { phase = 'idle'; run('enter', 0, 1, beginSettle); }, 120);
    return;
  }
  run(target === 'pause' ? 'forward' : 'reverse', 0, 1, () => settled(clipTarget[currentClip]));
}
function request(next) {
  clearTimeout(readyTimer);
  target = next;
  if (next === 'loading' && $('loadTime').value !== 'manual') {
    readyTimer = setTimeout(() => { target = 'pause'; drive(); }, Number($('loadTime').value));
  }
  drive();
}
function inspect(name, fraction) {
  halt(); phase = 'inspection'; show(name, fraction);
  target = state = clipTarget[name]; status('Frame inspection');
}
async function load() {
  halt();
  const ids = ['toggle', 'play', 'pause', 'frame', 'reload', 'startLoad', 'ready', 'cancel', 'replay', 'clip'];
  ids.forEach(id => { $(id).disabled = true; });
  $('status').textContent = 'Loading SVG…';
  try {
    const response = await fetch('play-pause-loader.svg', { cache: 'no-store' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw Error('Invalid SVG');
    motion = JSON.parse(doc.querySelector('metadata').textContent);
    svg = document.importNode(doc.documentElement, true);
    $('icon').replaceChildren(svg); svg.pauseAnimations();
    ids.forEach(id => { $(id).disabled = false; });
    still('play');
  } catch (error) {
    svg = undefined; $('status').textContent = `Could not load SVG: ${error.message}`;
    $('reload').disabled = false;
  }
}
$('toggle').onclick = () => {
  if (target === 'loading') request('pause');
  else if (target === 'pause') {
    if ($('directMorph').checked) request('play');
    else still('play');
  } else if ($('spinnerMorph').checked) request('loading');
  else if ($('directMorph').checked) request('pause');
  else still('pause');
};
$('startLoad').onclick = () => request('loading');
$('ready').onclick = () => request('pause');
$('cancel').onclick = () => request('play');
$('play').onclick = () => still('play');
$('pause').onclick = () => still('pause');
$('reload').onclick = load;
$('clip').onchange = event => inspect(event.target.value, 0);
$('frame').oninput = event => inspect(currentClip, Number(event.target.value) / 100);
$('replay').onclick = () => {
  const name = currentClip; halt();
  run(name, 0, 1, () => { state = target = clipTarget[name]; phase = 'inspection'; status('Clip complete'); });
};
$('directSpeed').oninput = () => updateSpeedValue('directSpeed');
$('spinnerSpeed').oninput = () => updateSpeedValue('spinnerSpeed');
$('spinnerMorph').onchange = controls;
$('zoom').onchange = event => $('toggle').style.setProperty('--zoom', event.target.value);
$('guides').onchange = event => $('toggle').classList.toggle('guides', event.target.checked);
load();
