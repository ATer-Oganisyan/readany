// One-time Lottie → SVG conversion. The exported SVG needs no player or scripts.
// Rebuild after editing the source: node tools/lottie-preview/build-svg.mjs
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { loaderGeometry, mix, rotate } from './loader-geometry.mjs';

const source = JSON.parse(await readFile(new URL('animation.json', import.meta.url), 'utf8'));
const axis = (value, index) => Array.isArray(value) ? value[index] ?? value[0] : value;
const bezier = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
function ease(progress, key, index = 0) {
  if (progress <= 0 || progress >= 1) return progress;
  let low = 0, high = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    if (bezier(mid, axis(key.o.x, index), axis(key.i.x, index)) < progress) low = mid;
    else high = mid;
  }
  return bezier((low + high) / 2, axis(key.o.y, index), axis(key.i.y, index));
}
function interval(keys, frame) {
  let index = 0;
  while (index < keys.length - 1 && frame >= keys[index + 1].t) index++;
  const key = keys[index], next = keys[index + 1];
  return { key, next, progress: next ? Math.max(0, (frame - key.t) / (next.t - key.t)) : 0 };
}
function value(property, frame) {
  if (!property.a) return property.k;
  const { key, next, progress } = interval(property.k, frame);
  return key.s.map((start, i) => !next ? start : start + (next.s[i] - start) * ease(progress, key, i));
}
function shape(property, frame) {
  const { key, next, progress } = interval(property.k, frame);
  const start = key.s[0], end = next?.s[0] ?? start;
  const t = next ? ease(progress, key) : 0;
  return Object.fromEntries(['v', 'i', 'o'].map(name => [name, start[name].map((point, j) =>
    point.map((coordinate, k) => coordinate + (end[name][j][k] - coordinate) * t))]));
}
// Half an app pixel in the 320-unit / 65.641px artwork coordinate system.
const extraCornerRadius = 2.4375;
function softenCorners(path, frame) {
  const result = [...path];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  for (let i = 0; i < 8; i++) {
    // The overlapping play halves contain internal seam corners; do not enlarge them.
    const pauseWeight = frame <= 39 ? Math.min(frame / 30, 1) : Math.max(0, (82 - frame) / 30);
    const amount = i === 6 ? 1 : pauseWeight;
    if (amount === 0) continue;
    const j = (i + 1) % 8, a = i * 6, b = j * 6;
    const p = path.slice(a, a + 2), q = path.slice(b, b + 2);
    const u = sub(path.slice(a + 4, a + 6), p), v = sub(q, path.slice(b + 2, b + 4));
    const lu = Math.hypot(...u), lv = Math.hypot(...v), determinant = cross(u, v);
    if (lu < 0.01 || lv < 0.01 || Math.abs(determinant) < 0.01 || Math.hypot(...sub(q, p)) > 45) continue;
    const d = cross(sub(q, p), v) / determinant;
    const corner = p.map((x, k) => x + u[k] * d);
    const first = Math.hypot(...sub(corner, p)), second = Math.hypot(...sub(corner, q));
    const cosine = Math.max(-1, Math.min(1, (u[0]*v[0]+u[1]*v[1])/(lu*lv)));
    const turn = Math.acos(cosine);
    if (d <= 0 || turn < 0.3 || turn > 2.8 || first < 1 || second < 1 || first > 40 || second > 40) continue;
    const radius = Math.min(first, second) / Math.tan(turn / 2);
    const scale = Math.min(1 + extraCornerRadius * amount / radius, 2.8);
    for (const offset of [a, a + 4, b + 2, b]) for (let k = 0; k < 2; k++) result[offset+k] = corner[k] + (path[offset+k]-corner[k])*scale;
    for (let k = 0; k < 2; k++) {
      result[a+2+k] += result[a+k]-path[a+k];
      result[b+4+k] += result[b+k]-path[b+k];
    }
  }
  return result;
}
// Bake transforms into the same eight cubic Bézier nodes, never into a polygon.
function contour(layer, frame) {
  const group = layer.shapes[0];
  const path = group.it.find(item => item.ty === 'sh');
  const transform = group.it.find(item => item.ty === 'tr');
  assert.deepEqual(transform.p.k, [0, 0]);
  assert.deepEqual(transform.s.k, [100, 100]);
  const points = shape(path.ks, frame);
  const position = value(layer.ks.p, frame), anchor = value(layer.ks.a, frame);
  const scale = value(layer.ks.s, frame), rotation = value(layer.ks.r, frame)[0] * Math.PI / 180;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const apply = (point) => {
    const x = (point[0] - anchor[0]) * scale[0] / 100;
    const y = (point[1] - anchor[1]) * scale[1] / 100;
    return [position[0] + x * cos - y * sin, position[1] + x * sin + y * cos];
  };
  assert.equal(points.v.length, 8);
  // Store absolute vertex / incoming control / outgoing control for editing.
  return softenCorners(points.v.flatMap((point, i) => [apply(point),
    apply(point.map((v, j) => v + points.i[i][j])),
    apply(point.map((v, j) => v + points.o[i][j]))].flat()), frame);
}
const number = value => String(Number(value.toFixed(5)));
function pathData(points) {
  let d = `M ${number(points[0])} ${number(points[1])}`;
  for (let i = 0; i < 8; i++) {
    const current = i * 6, next = ((i + 1) % 8) * 6;
    d += ` C ${[points[current + 4], points[current + 5], points[next + 2], points[next + 3], points[next], points[next + 1]].map(number).join(' ')}`;
  }
  return d + ' Z';
}
// Build one shared circular nose for the overlapping play halves. Its radius
// comes from the visible left corner; internal seam corners stay untouched.
function roundPlayTip(paths) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const intersect = (p, u, q, v) => {
    const t = cross(sub(q, p), v) / cross(u, v);
    return p.map((x, i) => x + t * u[i]);
  };
  const bottom = paths[0], top = paths[1];
  const edge = p => sub(p.slice(6, 8), p.slice(0, 2));
  const tip = intersect(bottom.slice(0, 2), edge(bottom), top.slice(0, 2), edge(top));
  const p = bottom.slice(36, 38), q = bottom.slice(42, 44);
  const u = sub(bottom.slice(40, 42), p), v = sub(q, bottom.slice(44, 46));
  const corner = intersect(p, u, q, v);
  const turn = Math.acos((u[0]*v[0]+u[1]*v[1]) / (Math.hypot(...u)*Math.hypot(...v)));
  const radius = Math.hypot(...sub(corner, p)) / Math.tan(turn / 2);
  const slope = Math.abs(edge(bottom)[1] / edge(bottom)[0]);
  const alpha = Math.atan(slope), sweep = Math.PI / 2 - alpha;
  const center = [tip[0] - radius / Math.sin(alpha), tip[1]];
  const handle = 4 / 3 * Math.tan(sweep / 4) * radius;
  return paths.map((path, index) => {
    const sign = index === 0 ? 1 : -1, a = sign * sweep, result = [...path];
    const tangent = [center[0] + radius*Math.cos(a), center[1] + radius*Math.sin(a)];
    const nose = [center[0] + radius, center[1]];
    result.splice(6, 6, ...tangent, ...tangent,
      tangent[0] + sign*Math.sin(a)*handle, tangent[1] - sign*Math.cos(a)*handle);
    result.splice(12, 6, ...nose, nose[0], nose[1] + sign*handle, ...nose);
    // The approach remains straight and tangent to the new circular corner.
    result[4] = result[0]; result[5] = result[1];
    return result;
  });
}
const tipCorrections = new WeakMap();
const originalSample = (frame, layers) => {
  const paths = layers.map(layer => contour(layer, frame));
  const endpoint = layers[0].ip === 0 ? 0 : 82;
  const weight = endpoint === 0 ? Math.max(0, 1-frame/30) : Math.max(0, (frame-52)/30);
  if (weight === 0) return paths;
  if (!tipCorrections.has(layers)) {
    const original = layers.map(layer => contour(layer, endpoint)), rounded = roundPlayTip(original);
    tipCorrections.set(layers, rounded.map((p,i) => p.map((v,j) => v-original[i][j])));
  }
  return paths.map((path,i) => {
    const delta = tipCorrections.get(layers)[i];
    const angle = (value(layers[i].ks.r,frame)[0]-value(layers[i].ks.r,endpoint)[0])*Math.PI/180;
    return path.map((v,j) => {
      const at = j-j%2, x=delta[at], y=delta[at+1];
      return v + weight*(j%2 ? x*Math.sin(angle)+y*Math.cos(angle) : x*Math.cos(angle)-y*Math.sin(angle));
    });
  });
};
// Retain 94.5% of the original width (5% thicker than the previous 90%).
// Move only the inside edge, retaining corner radii and outer edges.
const pauseTrims = new WeakMap();
const sample = (frame, layers) => {
  const paths = originalSample(frame, layers), endpoint = layers[0].ip === 0 ? 39 : 40;
  const progress = endpoint === 39 ? Math.min(frame / 39, 1) : Math.max(0, (82-frame)/42);
  const weight = progress * progress * (3-2*progress);
  if (!pauseTrims.has(layers)) {
    pauseTrims.set(layers, originalSample(endpoint,layers).map((path,index) => {
      const xs = Array.from({length:8},(_,i)=>path[i*6]), lo=Math.min(...xs), hi=Math.max(...xs);
      return path.map((_,i) => {
        const inner = index === 0 ? xs[Math.floor(i/6)] > (lo+hi)/2 : xs[Math.floor(i/6)] < (lo+hi)/2;
        return i%2===0 && inner ? (index===0 ? -1 : 1)*(hi-lo)*0.055 : 0;
      });
    }));
  }
  return paths.map((path,i) => {
    const angle=(value(layers[i].ks.r,frame)[0]-value(layers[i].ks.r,endpoint)[0])*Math.PI/180;
    return path.map((v,j) => v + weight*pauseTrims.get(layers)[i][j-j%2]*(j%2 ? Math.sin(angle) : Math.cos(angle)));
  });
};
// Adaptively add TIME samples only, retaining exactly eight nodes per contour.
// Maximum interpolation error: 0.01 on the 320-unit canvas (< 0.003px at app size).
const tolerance = 0.01;
function segment(layers, start, end, at) {
  const frames = new Set([start, end]);
  for (const layer of layers) {
    const tracks = [layer.ks.p, layer.ks.r, layer.ks.s, layer.shapes[0].it[0].ks];
    for (const track of tracks) for (const key of track.k) if (key.t > start && key.t < end) frames.add(key.t);
  }
  const result = [];
  function subdivide(a, b, pa, pb, depth = 0) {
    let error = 0;
    for (const t of [0.25, 0.5, 0.75]) {
      const actual = sample(a + (b - a) * t, layers);
      actual.forEach((path, i) => path.forEach((value, j) => {
        error = Math.max(error, Math.abs(value - (pa[i][j] + (pb[i][j] - pa[i][j]) * t)));
      }));
    }
    if (error > tolerance && depth < 12) {
      const mid = (a + b) / 2, pm = sample(mid, layers);
      subdivide(a, mid, pa, pm, depth + 1);
      subdivide(mid, b, pm, pb, depth + 1);
    } else result.push({ time: at + (a - start) / (end - start) * 0.3, points: pa });
  }
  const sorted = [...frames].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    subdivide(sorted[i], sorted[i + 1], sample(sorted[i], layers), sample(sorted[i + 1], layers));
  }
  result.push({ time: at + 0.3, points: sample(end, layers) });
  return result;
}
const forwardLayers = source.layers.filter(l => l.ip === 0);
const forward = segment(forwardLayers, 0, 39, 0);
const reverse = segment(source.layers.filter(l => l.ip === 40), 40, 82, 0.7);
const frames = [
  ...forward,
  { time: 0.7 - 1e-7, points: forward.at(-1).points },
  ...reverse,
  { time: 1.4 - 1e-7, points: reverse.at(-1).points },
  { time: 1.4, points: forward[0].points },
];
const times = frames.map(f => Number((f.time / 1.4).toFixed(9))).join(';');
const paths = [0, 1].map(i => `  <path id="contour-${i + 1}" d="${pathData(frames[0].points[i])}">
    <animate attributeName="d" dur="1.4s" repeatCount="indefinite" calcMode="linear"
      keyTimes="${times}"
      values="${frames.map(f => pathData(f.points[i])).join(';\n        ')}" />
  </path>`).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320" fill="white" role="img" aria-labelledby="title" data-forward="0,0.3" data-reverse="0.7,1">
  <title id="title">Play / Pause — SVG morph</title>
  <desc>Two closed cubic Bézier contours, eight nodes each. 300ms per transition; 400ms holds. Play offset +2px at 32px artwork height. No opacity animation or external dependencies.</desc>
  <style>svg:root { background: #941a00; }</style>
${paths}
</svg>\n`;
await writeFile(new URL('play-pause.svg', import.meta.url), svg);
console.log(`Exported play-pause.svg: 2 paths × 8 nodes; ${forward.length}/${reverse.length} time samples; ${Math.round(svg.length / 1024)} KiB.`);

export { forward, reverse, pathData };

const play = forward[0].points, pause = forward.at(-1).points;
const geometry = loaderGeometry(play, originalSample(39, forwardLayers));
const { spinner, center } = geometry;
const smooth = t => t * t * (3 - 2 * t);
// Keep the anticipation, then use easeInCubic for a sharper acceleration.
const playEaseIn = t => {
  if (t <= 0.2) return -8 / 90 * smoothShape(t / 0.2);
  const u = (t - 0.2) / 0.8;
  // Cubic acceleration with an endpoint speed matching the loader.
  return (-8 + 98 * ((39 / 49) * u ** 2 + (10 / 49) * u ** 3)) / 90;
};
const smoothShape = t => t ** 3 * (10 - 15 * t + 6 * t * t);
const cubic = t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
// Keep exactly the cubic entry velocity throughout loader rotation.
const entrySpeed = 900; // 400 ms per full turn.
const turnSeconds = 360 / entrySpeed;
const settleAngle = t => 0.3 * entrySpeed * t;
const settlePhase = (settleAngle(1) / 360) % 1;
const spinStart = 2 + (1 - settlePhase) * turnSeconds;
const exitPhase = 3 / 4; // Start morphing 90° before a full clockwise turn.
const exitStart = spinStart + turnSeconds + exitPhase * turnSeconds;
const exitSeconds = 0.35;
const returnStart = exitStart + exitSeconds + 0.4;
const retryOffset = returnStart + 0.3 + 0.4 - 1.4;
const cancelStart = spinStart + turnSeconds + retryOffset;
const totalDuration = cancelStart + 0.3 + 0.4;
const enteringSpinner = rotate(spinner, center, -90);
// Underdamped spring: preserve incoming angular velocity, then settle at upright.
const springAngle = (t, angle = -90) => {
  const seconds = t * exitSeconds, frequency = 17, damping = 0.465;
  const decay = frequency * damping;
  const oscillation = frequency * Math.sqrt(1 - damping ** 2);
  const velocityTerm = (entrySpeed + decay * angle) / oscillation;
  const displacement = Math.exp(-decay * seconds) * (
    angle * Math.cos(oscillation * seconds) + velocityTerm * Math.sin(oscillation * seconds)
  );
  // Smoothly absorb the residual tail within the 350ms exit clip.
  const tail = t <= 0.8 ? 1 : 1 - smoothShape((t - 0.8) / 0.2);
  // Ease spring forces in over 52.5ms, preserving linear velocity and zero
  // acceleration at the handoff instead of applying spring acceleration instantly.
  const engage = smoothShape(Math.min(t / 0.15, 1));
  const carried = angle + entrySpeed * seconds;
  return (carried * (1 - engage) + displacement * engage) * tail;
};
// Finish the contour morph just before the first upright crossing, not at a
// fixed fraction of the full spring clip. The remaining spring moves rigid legs.
const uprightTimes = new Map();
function firstUpright(angle = -90) {
  if (uprightTimes.has(angle)) return uprightTimes.get(angle);
  let lo = 0.000001, hi = 0.8;
  const sign = Math.sign(springAngle(lo, angle));
  for (let i = 1; i <= 800; i++) {
    hi = i / 1000;
    if (Math.sign(springAngle(hi, angle)) !== sign) break;
    lo = hi;
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(springAngle(mid, angle)) === sign) lo = mid; else hi = mid;
  }
  uprightTimes.set(angle, hi);
  return hi;
}
const exitPose = (target, t, angle = -90) => rotate(
  mix(spinner, target, smoothShape(Math.min(t / (firstUpright(angle) * 0.95), 1))),
  center, springAngle(t, angle),
);
function geometryClip(start, duration, pose) {
  const result = [];
  function divide(a, b, left, right) {
    let error = 0;
    for (const ratio of [0.25, 0.5, 0.75]) {
      const actual = pose(a + (b - a) * ratio);
      actual.forEach((path, i) => path.forEach((v, j) => {
        error = Math.max(error, Math.abs(v - (left[i][j] + (right[i][j] - left[i][j]) * ratio)));
      }));
    }
    if (error > tolerance && b - a > 1 / 4096) {
      const mid = (a + b) / 2, points = pose(mid);
      divide(a, mid, left, points); divide(mid, b, points, right);
    } else result.push({ time: start + a * duration, points: left });
  }
  divide(0, 1, pose(0), pose(1));
  result.push({ time: start + duration, points: pose(1) });
  return result;
}
// Match geometry and speed across entry → ease-out → linear.
const enter = geometryClip(1.4, 0.3, t => rotate(
  mix(play, enteringSpinner, cubic(Math.max(0, (t - 0.15) / 0.85))), center,
  90 * playEaseIn(t),
));
const settleSpin = geometryClip(1.7, 0.3, t => rotate(spinner, center, settleAngle(t)));
const partialSpin = geometryClip(2, spinStart - 2, t => rotate(spinner, center, settlePhase * 360 + (360 - settlePhase * 360) * t));
const spin = geometryClip(spinStart, turnSeconds, t => rotate(spinner, center, t * 360));
const exitApproach = geometryClip(spinStart + turnSeconds, exitPhase * turnSeconds, t => rotate(spinner, center, exitPhase * 360 * t));
const exit = geometryClip(exitStart, exitSeconds, t => exitPose(pause, t));
// Close the same ribbon as entry, while unwinding its orientation as a whole.
// A direct vertex blend from the upright ring to play would cross the two ribbons.
const cancel = geometryClip(cancelStart, 0.3, t => rotate(
  mix(enteringSpinner, play, smooth(t)), center,
  90 * (1 - smooth(t)) + (entrySpeed * 0.3) * t * (1 - t) ** 2,
));
// Standalone playback shows a successful load and then a cancelled load.
const loaderFrames = [
  ...forward, { time: 0.7 - 1e-7, points: pause }, ...reverse,
  { time: 1.4 - 1e-7, points: reverse.at(-1).points }, ...enter,
  ...settleSpin.slice(1), ...partialSpin.slice(1), ...spin.slice(1), ...exitApproach.slice(1), ...exit.slice(1),
  { time: returnStart - 1e-7, points: pause },
  ...reverse.map(f => ({ ...f, time: f.time - 0.7 + returnStart })),
  { time: 1.4 + retryOffset - 1e-7, points: reverse.at(-1).points },
  ...enter.map(f => ({ ...f, time: f.time + retryOffset })),
  ...[...settleSpin.slice(1), ...partialSpin.slice(1), ...spin.slice(1)].map(f => ({ ...f, time: f.time + retryOffset })),
  ...cancel.slice(1),
  { time: totalDuration, points: play },
];
const clips = {
  forward: [0, 0.3], reverse: [0.7, 1], enter: [1.4, 1.7],
  settle: [1.7, 2], spin: [spinStart, spinStart + turnSeconds],
  exit: [exitStart, exitStart + exitSeconds], cancel: [cancelStart, cancelStart + 0.3],
};
const metadata = { clips, exitMs: exitSeconds * 1000, exitPhase, entryPhase: 0, settlePhase, settleMs: 300, turnMs: turnSeconds * 1000, center, thickness: geometry.thickness,
  pauseLegWidth: geometry.legWidth, anchorsPerContour: 8, exitAngle: -90 };
for (let i = 1; i < loaderFrames.length; i++) assert.ok(loaderFrames[i].time > loaderFrames[i - 1].time, 'Timeline must increase');
const loaderTimes = loaderFrames.map(f => Number((f.time / totalDuration).toFixed(9))).join(';');
const loaderPaths = [0, 1].map(i => `  <path id="contour-${i + 1}" d="${pathData(play[i])}">
    <animate attributeName="d" dur="${totalDuration}s" repeatCount="indefinite" calcMode="linear"
      keyTimes="${loaderTimes}"
      values="${loaderFrames.map(f => pathData(f.points[i])).join(';\n        ')}" />
  </path>`).join('\n');
const loaderSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320" fill="white" role="img" aria-labelledby="title">
  <title id="title">Play / Loader / Pause — SVG morph</title>
  <desc>Two separate 93.5-degree arcs rotate together. Eight Bézier nodes each. Thickness is half one pause leg. Exit pose: -90 degrees. All shape changes are path morphs.</desc>
  <metadata id="motion">${JSON.stringify(metadata)}</metadata>
  <style>svg:root { background: #941a00; }</style>
${loaderPaths}
</svg>\n`;
await writeFile(new URL('play-pause-loader.svg', import.meta.url), loaderSvg);
console.log(`Loader: ${Math.round(loaderSvg.length / 1024)} KiB; thickness ${geometry.thickness.toFixed(3)} / leg ${geometry.legWidth.toFixed(3)}; shifts ${geometry.shifts}.`);
export { enter, settleSpin, partialSpin, spin, exit, cancel, geometry, playEaseIn, settleAngle, springAngle, firstUpright, exitPose };

// Five comparison clips share timing/topology and vary only the exit orientation.
export const exitVariants = [-90, -60, -30, 0, 30, 60].map((angle, index) => {
  const turning = geometryClip(0, turnSeconds, t => rotate(spinner, center, angle - 360 + 360 * t));
  const morph = geometryClip(turnSeconds, exitSeconds, t => exitPose(pause, t, angle));
  const frames = [...turning, ...morph.slice(1), { time: 1.5, points: pause }];
  return { angle, index, turning, morph, frames };
});
for (const { angle, index, frames } of exitVariants) {
  const times = frames.map(f => Number((f.time / 1.5).toFixed(9))).join(';');
  const content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" fill="white"><title>Вариант ${index + 1}: ${angle}°</title>${[0, 1].map(i => `<path d="${pathData(frames[0].points[i])}"><animate attributeName="d" dur="1.5s" fill="freeze" calcMode="linear" keyTimes="${times}" values="${frames.map(f => pathData(f.points[i])).join(';')}"/></path>`).join('')}</svg>`;
  await writeFile(new URL(`exit-variant-${index + 1}.svg`, import.meta.url), content);
}
