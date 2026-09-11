import { readFileSync, writeFileSync } from "node:fs";
const data = JSON.parse(
  readFileSync(new URL("./saved/approved/play-loader-pause.json", import.meta.url)),
);
// Preserve the approved motion, factoring rigid rotation out of path coordinates.
const clips = data.narraMotion.clips;
clips.pauseEnter = [6, 6.3];
data.narraMotion.pauseEntryPhase = 0.25;
data.op = 6.4 * data.fr;
data.markers.push({ cm: "pauseEnter", tm: 6 * data.fr, dr: 0.3 * data.fr });
const smoothShape = (t) => t ** 3 * (10 - 15 * t + 6 * t * t);
const cubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
// Identical anticipation, angular acceleration, shape timing and final velocity to play entry.
const entryAngle = (t) => {
  if (t <= 0.2) return -8 * smoothShape(t / 0.2);
  const u = (t - 0.2) / 0.8;
  return -8 + 98 * ((39 / 49) * u * u + (10 / 49) * u * u * u);
};
const rotate = (shape, degrees) => {
  const angle = (degrees * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle),
    center = data.narraMotion.center;
  return {
    c: true,
    ...Object.fromEntries(
      ["v", "i", "o"].map((field) => [
        field,
        shape[field].map((point) => {
          const origin = field === "v" ? center : [0, 0],
            x = point[0] - origin[0],
            y = point[1] - origin[1];
          return [x * c - y * s + origin[0], x * s + y * c + origin[1]];
        }),
      ]),
    ),
  };
};
for (const layer of data.layers) {
  const original = layer.shapes[0].ks.k;
  const sourceSample = (t) => {
    let i = 0;
    while (i + 1 < original.length && original[i + 1].t <= t) i++;
    const a = original[i],
      b = original[i + 1] ?? a;
    const p = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    const shape = { c: true };
    for (const field of ["v", "i", "o"])
      shape[field] = a.s[0][field].map((point, j) =>
        point.map((x, k) => +(x + (b.s[0][field][j][k] - x) * p).toFixed(4)),
      );
    return shape;
  };
  const pause = sourceSample(0.3 * data.fr),
    enteringSpinner = sourceSample(2.1 * data.fr);
  const sample = (frame) => {
    if (frame < 6 * data.fr) return sourceSample(frame);
    const t = Math.max(0, Math.min(1, (frame / data.fr - 6) / 0.3));
    if (t === 1) return sourceSample(2.2 * data.fr);
    const p = cubic(Math.max(0, (t - 0.15) / 0.85));
    const mixed = {
      c: true,
      ...Object.fromEntries(
        ["v", "i", "o"].map((field) => [
          field,
          pause[field].map((point, i) =>
            point.map((x, j) => x + (enteringSpinner[field][i][j] - x) * p),
          ),
        ]),
      ),
    };
    return rotate(mixed, entryAngle(t));
  };
  // Extract the least-squares rigid rotation. Residual paths still reconstruct
  // the authored geometry; this does not impose new easing or change topology.
  const reference = sourceSample(0),
    center = data.narraMotion.center;
  const allTimes = [
    ...new Set(
      Object.values(clips).flatMap(([a, b]) => [
        ...original.filter((k) => k.t > a * data.fr && k.t < b * data.fr).map((k) => k.t),
        ...Array.from(
          { length: Math.round((b - a) * 1200) + 1 },
          (_, i) => (a + ((b - a) * i) / Math.round((b - a) * 1200)) * data.fr,
        ),
      ]),
    ),
  ].sort((a, b) => a - b);
  let previousAngle = 0;
  const samples = allTimes.map((t) => {
    const shape = sample(t);
    let dot = 0,
      cross = 0;
    for (let j = 0; j < 8; j++) {
      const x = reference.v[j][0] - center[0],
        y = reference.v[j][1] - center[1];
      const u = shape.v[j][0] - center[0],
        v = shape.v[j][1] - center[1];
      dot += x * u + y * v;
      cross += x * v - y * u;
    }
    let angle = (Math.atan2(cross, dot) * 180) / Math.PI;
    while (angle - previousAngle > 180) angle -= 360;
    while (angle - previousAngle < -180) angle += 360;
    previousAngle = angle;
    const local = rotate(shape, -angle);
    return { t, angle, local, flat: [...local.v.flat(), ...local.i.flat(), ...local.o.flat()] };
  });
  function reduce(values, tolerance) {
    const kept = new Set();
    function split(lo, hi) {
      kept.add(lo);
      kept.add(hi);
      let error = 0,
        worst = -1;
      for (let j = lo + 1; j < hi; j++) {
        const p = (samples[j].t - samples[lo].t) / (samples[hi].t - samples[lo].t);
        const e = Math.max(
          ...values[j].map((x, k) =>
            Math.abs(x - values[lo][k] - (values[hi][k] - values[lo][k]) * p),
          ),
        );
        if (e > error) {
          error = e;
          worst = j;
        }
      }
      if (error > tolerance) {
        split(lo, worst);
        split(worst, hi);
      }
    }
    for (const [a, b] of Object.values(clips)) {
      const lo = samples.findIndex((s) => Math.abs(s.t - a * data.fr) < 1e-7);
      const hi = samples.findIndex((s) => Math.abs(s.t - b * data.fr) < 1e-7);
      split(lo, hi);
    }
    return [...kept].sort((a, b) => a - b);
  }
  const round = (n) => +n.toFixed(3);
  const pathIndices = reduce(
    samples.map((s) => s.flat),
    0.08,
  );
  const angleIndices = reduce(
    samples.map((s) => [s.angle]),
    0.03,
  );
  const compactShape = (s) => ({
    c: true,
    ...Object.fromEntries(["v", "i", "o"].map((f) => [f, s[f].map((p) => p.map(round))])),
  });
  const linear = { o: { x: 0, y: 0 }, i: { x: 1, y: 1 } };
  layer.op = data.op;
  layer.ks.a.k = [...center, 0];
  layer.ks.p.k = [...center, 0];
  layer.ks.r = {
    a: 1,
    k: angleIndices.map((n, i) => ({
      t: +samples[n].t.toFixed(6),
      s: [+samples[n].angle.toFixed(5)],
      ...(i + 1 < angleIndices.length
        ? { e: [+samples[angleIndices[i + 1]].angle.toFixed(5)], ...linear }
        : {}),
    })),
  };
  layer.shapes[0].ks.k = pathIndices.map((n, i) => ({
    t: +samples[n].t.toFixed(6),
    s: [compactShape(samples[n].local)],
    ...(i + 1 < pathIndices.length ? { ...linear } : {}),
  }));
  // Lottie uses the next key's start value as the previous key's endpoint.
  // Avoid storing every contour twice in s/e.
  const interpolate = (keys, t) => {
    let n = 0;
    while (n + 1 < keys.length && keys[n + 1].t <= t) n++;
    const a = keys[n],
      b = keys[n + 1] ?? a;
    return [a.s[0], b.s[0], b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)];
  };
  let maxError = 0,
    worstTime = 0;
  for (const [a, b] of Object.values(clips))
    for (let t = a; t <= b + 1e-9; t += 1 / 2400) {
      const [x, y, p] = interpolate(layer.shapes[0].ks.k, t * data.fr);
      const local = {
        c: true,
        ...Object.fromEntries(
          ["v", "i", "o"].map((f) => [
            f,
            x[f].map((v, j) => v.map((n, k) => n + (y[f][j][k] - n) * p)),
          ]),
        ),
      };
      const [r, q, u] = interpolate(layer.ks.r.k, t * data.fr);
      const actual = rotate(local, r + (q - r) * u),
        expected = sample(t * data.fr);
      for (const f of ["v", "i", "o"])
        for (let j = 0; j < 8; j++) {
          const error = Math.hypot(...actual[f][j].map((n, k) => n - expected[f][j][k]));
          if (error > maxError) {
            maxError = error;
            worstTime = t;
          }
        }
    }
  if (maxError > 0.2)
    throw new Error(`Geometry error ${maxError} at ${worstTime} exceeds tolerance`);
  console.log(
    `Contour ${layer.ind}: max coordinate error ${maxError.toFixed(4)} / 320, ${angleIndices.length} rotation keys`,
  );
}
const target = new URL(
  "../../packages/app-expo/assets/icons/anim_play_loader_pause.json",
  import.meta.url,
);
writeFileSync(target, JSON.stringify(data));
console.log(
  `${data.layers.map((l) => l.shapes[0].ks.k.length).join("/")} keys per contour, ${Math.round(JSON.stringify(data).length / 1024)} KiB`,
);
