/*!
 * Canvas adaptation of img-fx's pixels-organic and sweep-gradient presets.
 * https://github.com/Jakubantalik/img-fx — Copyright (c) 2026 Jakub Antalik.
 * MIT license: assets/reader/img-fx.LICENSE.txt.
 * Keeps the original noise, ridge field, five-tap blur and 10 fps cadence,
 * but samples once per cell, without React/Three/WebGL in the EPUB iframe.
 */

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const fract = (n: number) => n - Math.floor(n);
const mod289 = (n: number) => n - Math.floor(n / 289) * 289;
const permute = (n: number) => mod289((n * 34 + 1) * n);

// Scalar port of the reference's GLSL 2D simplex noise.
function noise(x: number, y: number): number {
  const skew = (x + y) * 0.366025403784439;
  let ix = Math.floor(x + skew);
  let iy = Math.floor(y + skew);
  const unskew = (ix + iy) * 0.211324865405187;
  const x0 = x - ix + unskew;
  const y0 = y - iy + unskew;
  const ax = x0 > y0 ? 1 : 0;
  const ay = 1 - ax;
  ix = mod289(ix);
  iy = mod289(iy);
  let value = 0;
  for (let i = 0; i < 3; i++) {
    const dx = i === 0 ? x0 : i === 1 ? x0 + 0.211324865405187 - ax : x0 - 0.577350269189626;
    const dy = i === 0 ? y0 : i === 1 ? y0 + 0.211324865405187 - ay : y0 - 0.577350269189626;
    const p = permute(
      permute(iy + (i === 0 ? 0 : i === 1 ? ay : 1)) + ix + (i === 0 ? 0 : i === 1 ? ax : 1),
    );
    const gx = 2 * fract(p * 0.024390243902439) - 1;
    const h = Math.abs(gx) - 0.5;
    const a = gx - Math.floor(gx + 0.5);
    const m = Math.max(0.5 - dx * dx - dy * dy, 0);
    value += m ** 4 * (1.79284291400159 - 0.85373472095314 * (a * a + h * h)) * (a * dx + h * dy);
  }
  return 130 * value;
}

const fbm = (x: number, y: number) => 0.5 * noise(x, y) + 0.25 * noise(x * 2, y * 2);
const warp = (x: number, y: number, t: number) => [
  fbm(x + t * 0.1, y) * 0.6,
  fbm(x + 5, y + t * 0.12 + 5) * 0.6,
];

function field(sampleX: number, y: number, t: number, levels: readonly number[]): number {
  const x = sampleX + t * 0.15;
  const w = warp(x * 0.7, y * 0.7, t * 0.5);
  const w2 = warp(x * 0.4 + w[0] * 0.3, y * 0.4 + w[1] * 0.3, t * 0.3);
  const px = x + w[0] * 0.58;
  const py = y + w[1] * 0.58;
  const n1 = noise(px * 1.72 + t * 0.14, py * 1.72 + t * 0.14);
  const n2 = noise(
    (px + w2[0] * 0.12) * 2.4 + 3 - t * 0.1,
    (py + w2[1] * 0.12) * 2.4 + 7 - t * 0.1,
  );
  const r1 = (1 - Math.abs(n1)) ** 11.24;
  const r2 = (1 - Math.abs(n2)) ** 9.2;
  const base = (n1 + n2) * 0.25 + 0.5;
  const a = clamp(base * 0.6 + r1 * 1.2) ** 2;
  const b = clamp((1 - base) * 0.6 + r2) ** 2;
  const c = clamp(r1 * 0.8 + r2 * 0.6) ** 2;
  const d = (a * 0.7 + c * 0.3) ** 2;
  const e = (b * 0.5 + c * 0.5) ** 2;
  return (
    (levels[0] * a + levels[1] * b + levels[2] * c + levels[3] * d + levels[4] * e) /
    Math.max(0.001, a + b + c + d + e)
  );
}

type PixelColor = [number, number, number, number];
export interface ScenePixelPalette {
  primary1: PixelColor;
  primary8: PixelColor;
  levels: PixelColor[];
  mode: "light" | "dark";
}

/** Primary 1 is the same neutral at 1%; Primary 8 is an existing Primitives token. */
export function scenePixelPalette(primary8: string): ScenePixelPalette | null {
  const parse = (value: string): PixelColor | null => {
    const hex = value.trim().replace(/^#/, "");
    if (!/^[a-f\d]{8}$/i.test(hex)) return null;
    const channels = [0, 2, 4, 6].map((offset) =>
      Number.parseInt(hex.slice(offset, offset + 2), 16),
    );
    return [channels[0], channels[1], channels[2], channels[3] / 255];
  };
  const high = parse(primary8);
  if (!high || high[3] < 0.01) return null;
  const levels: PixelColor[] = Array.from({ length: 8 }, (_, index) => [
    high[0],
    high[1],
    high[2],
    Math.min((index + 1) / 100, high[3]),
  ]);
  return {
    primary1: levels[0],
    primary8: high,
    levels,
    mode: high[0] * 0.299 + high[1] * 0.587 + high[2] * 0.114 > 128 ? "dark" : "light",
  };
}

export function scenePixelColor(strength: number, palette: ScenePixelPalette): PixelColor {
  // Eight explicit stops, including Primary 2/3/4/5/6/7 between the endpoints.
  const position = clamp(strength) * 7;
  const index = Math.floor(position);
  const low = palette.levels[index];
  const high = palette.levels[Math.min(7, index + 1)];
  const mix = position - index;
  return [
    low[0] + (high[0] - low[0]) * mix,
    low[1] + (high[1] - low[1]) * mix,
    low[2] + (high[2] - low[2]) * mix,
    low[3] + (high[3] - low[3]) * mix,
  ];
}

export type SceneEffectPreset = "pixels-organic" | "sweep-gradient";

// The reference's five color stops are now levels on the Primary scale.
// Organic light: E3E3E3/FFFFFF/F5F5F5/F5F5F5/080808 → 2/1/1/1/8.
// Organic dark: 0F0F0F/4A4949/B9B9B9/0F0F0F/D8D8D8 → 1/3/6/1/8.
// Sweep: F5/F5/ED/EA/D2 (light), 0F/0F/28/3A/52 (dark) → 1/1/3/5/8.
export const SCENE_PIXEL_LEVELS = {
  "pixels-organic": { light: [2, 1, 1, 1, 8], dark: [1, 3, 6, 1, 8] },
  "sweep-gradient": { light: [1, 1, 3, 5, 8], dark: [1, 1, 3, 5, 8] },
} as const;

function sweepField(
  x: number,
  y: number,
  t: number,
  cells: number,
  levels: readonly number[],
): number {
  const distance = (x + 0.5 + (0.5 - y)) * 0.5;
  const width = 0.9;
  const cycle = t * 0.08;
  const a = -width + (1 + width * 2) * smooth(fract(cycle));
  const b = -width + (1 + width * 2) * smooth(fract(cycle + 0.5));
  const band = Math.max(
    clamp(1 - Math.abs(distance - a) / width),
    clamp(1 - Math.abs(distance - b) / width),
  );
  const clock = t * 1.6;
  const step = Math.floor(clock) % 1024;
  const seed = Math.floor((x + 0.5) * cells) * 127.1 + Math.floor((y + 0.5) * cells) * 311.7;
  const first = fract(Math.sin(seed + step * 17.23) * 43758.5453);
  const second = fract(Math.sin(seed + ((step + 1) % 1024) * 17.23) * 43758.5453);
  const random = first + (second - first) * smooth(fract(clock));
  const value = smooth(clamp(band + (random - 0.5) * 0.45 * (0.15 + band * 0.85)));
  let sum = 0;
  let total = 0;
  for (let i = 0; i < 5; i++) {
    const weight = Math.exp(-64 * (value - i * 0.25) ** 2);
    sum += levels[i] * weight;
    total += weight;
  }
  return sum / total;
}

export function drawScenePixels(
  ctx: CanvasRenderingContext2D,
  side: number,
  seconds: number,
  palette: ScenePixelPalette,
  preset: SceneEffectPreset = "pixels-organic",
): void {
  const cells = Math.max(2, Math.floor((22.28 * side) / 320));
  const cell = side / cells;
  const sweep = preset === "sweep-gradient";
  const t = seconds * (sweep ? 2.65 : 0.3);
  const levels = SCENE_PIXEL_LEVELS[preset][palette.mode];
  const sample = (x: number, y: number) =>
    sweep ? sweepField(x, y, t, cells, levels) : field(x, y, t, levels);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, side, side);
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const x = (col + 0.5) / cells - 0.5;
      const y = 0.5 - (row + 0.5) / cells;
      let value = sample(x, y) * 0.4;
      value +=
        (sample(x + 0.02, y) + sample(x - 0.02, y) + sample(x, y + 0.02) + sample(x, y - 0.02)) *
        0.15;
      const edge = Math.min(col + 0.5, row + 0.5, cells - col - 0.5, cells - row - 0.5) * cell;
      // Organic's light stops blend into only ~1.4–2.7, not the full 1–8.
      // Expand that fixed input window after blur; never normalize per frame,
      // which would make the whole panel pulse as the field moves. Sepia uses
      // the same light palette. Loading and dark mode retain their mapping.
      const strength =
        !sweep && palette.mode === "light" ? smooth((value - 1.4) / 1.3) : clamp((value - 1) / 7);
      const [red, green, blue, alpha] = scenePixelColor(strength, palette);
      ctx.fillStyle = `rgb(${Math.round(red)},${Math.round(green)},${Math.round(blue)})`;
      ctx.globalAlpha = alpha * smooth(edge / 24);
      const gap = cell * 0.049;
      // Exactly one non-overlapping rectangle per cell; no highlight overlay.
      ctx.fillRect(col * cell + gap, row * cell + gap, cell - gap * 2, cell - gap * 2);
    }
  }
  ctx.restore();
}

/** Fixed-size overlay: never measures or changes the book's pagination. */
export function mountScenePixelLoader(
  canvas: HTMLCanvasElement,
  preset: SceneEffectPreset = "pixels-organic",
): () => void {
  const doc = canvas.ownerDocument;
  const frameWindow = doc.defaultView;
  const context = canvas.getContext("2d");
  if (!frameWindow || !context) return () => {};
  const win = frameWindow;
  const ctx = context;
  const motion = win.matchMedia("(prefers-reduced-motion: reduce)");
  let timer: number | undefined;
  let visible = true;
  let disposed = false;
  let frame = 0;
  let side = 0;
  let dpr = 0;
  let palette: ScenePixelPalette | null = null;
  const fps = preset === "sweep-gradient" ? 15 : 10;
  function draw() {
    if (side > 0 && palette) drawScenePixels(ctx, side, 4 + frame / fps, palette, preset);
  }
  function tick() {
    timer = undefined;
    if (!canvas.isConnected) {
      dispose();
      return;
    }
    if (disposed || !visible || doc.hidden || motion.matches) return;
    frame++;
    draw();
    timer = win.setTimeout(tick, 1000 / fps);
  }
  function resume() {
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
    if (disposed) return;
    draw();
    if (visible && !doc.hidden && !motion.matches) timer = win.setTimeout(tick, 1000 / fps);
  }
  function resize() {
    const size = canvas.getBoundingClientRect().width;
    if (size <= 0) return;
    const ratio = Math.min(win.devicePixelRatio || 1, 1.5);
    const style = win.getComputedStyle(canvas);
    palette = scenePixelPalette(style.getPropertyValue("--scene-primary8"));
    if (side !== size || dpr !== ratio) {
      side = size;
      dpr = ratio;
      canvas.width = canvas.height = Math.round(side * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    draw();
  }
  const resizeObserver = new win.ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const intersection = new win.IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? false;
    resume();
  });
  intersection.observe(canvas);
  // Theme updates replace the scene stylesheet, even with unchanged geometry.
  const theme = new win.MutationObserver(resize);
  const style = doc.getElementById("readany-scene-insert-style");
  if (style) theme.observe(style, { childList: true });
  doc.addEventListener("visibilitychange", resume);
  motion.addEventListener("change", resume);
  win.addEventListener("pagehide", dispose);
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer !== undefined) win.clearTimeout(timer);
    resizeObserver.disconnect();
    intersection.disconnect();
    theme.disconnect();
    doc.removeEventListener("visibilitychange", resume);
    motion.removeEventListener("change", resume);
    win.removeEventListener("pagehide", dispose);
  }
  resize();
  resume();
  return dispose;
}
