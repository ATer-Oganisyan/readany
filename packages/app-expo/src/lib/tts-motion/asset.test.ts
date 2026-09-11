import { describe, expect, it } from "vitest";
import animation from "../../../assets/icons/anim_play_loader_pause.json";
function shape(layer: number, seconds: number) {
  const keys = animation.layers[layer].shapes[0].ks!.k as unknown as {
    t: number;
    s: { v: number[][]; i: number[][]; o: number[][] }[];
  }[];
  const time = seconds * animation.fr;
  let n = 0;
  while (n + 1 < keys.length && keys[n + 1].t <= time) n++;
  const a = keys[n],
    b = keys[n + 1] ?? a,
    p = b.t === a.t ? 0 : (time - a.t) / (b.t - a.t);
  const rotations = animation.layers[layer].ks.r.k;
  let r = 0;
  while (r + 1 < rotations.length && rotations[r + 1].t <= time) r++;
  const ra = rotations[r],
    rb = rotations[r + 1] ?? ra;
  const rp = rb.t === ra.t ? 0 : (time - ra.t) / (rb.t - ra.t);
  const angle = ((ra.s[0] + (rb.s[0] - ra.s[0]) * rp) * Math.PI) / 180;
  const [cx, cy] = animation.narraMotion.center;
  return a.s[0].v.map((point, j) => {
    const x = point[0] + (b.s[0].v[j][0] - point[0]) * p - cx;
    const y = point[1] + (b.s[0].v[j][1] - point[1]) * p - cy;
    return [
      cx + x * Math.cos(angle) - y * Math.sin(angle),
      cy + x * Math.sin(angle) + y * Math.cos(angle),
    ];
  });
}
describe("authored pause loader entry", () => {
  it("joins the exact pause and spinner poses with eight vertices", () => {
    for (let layer = 0; layer < 2; layer++) {
      const pause = shape(layer, 0.3),
        start = shape(layer, 6),
        end = shape(layer, 6.3),
        spinner = shape(layer, 2.2);
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 2; j++) expect(start[i][j]).toBeCloseTo(pause[i][j], 2);
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 2; j++) expect(end[i][j]).toBeCloseTo(spinner[i][j], 2);
      for (let ms = 0; ms <= 300; ms++) expect(shape(layer, 6 + ms / 1000)).toHaveLength(8);
    }
  });
  it("starts with the same backwards anticipation as play", () => {
    const [cx, cy] = animation.narraMotion.center,
      angle = (-8 * Math.PI) / 180;
    for (let layer = 0; layer < 2; layer++) {
      const pause = shape(layer, 0.3),
        anticipated = shape(layer, 6.06);
      for (let i = 0; i < 8; i++) {
        const [x, y] = pause[i],
          expected = [
            cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle),
            cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle),
          ];
        expect(
          Math.hypot(anticipated[i][0] - expected[0], anticipated[i][1] - expected[1]),
        ).toBeLessThan(0.3);
      }
    }
  });
});

describe("production asset budget", () => {
  it("keeps the asset below 300 KiB and stores a turn as rotation, not path frames", () => {
    expect(JSON.stringify(animation).length).toBeLessThan(300 * 1024);
    const [start, end] = animation.narraMotion.clips.spin.map((t) => t * animation.fr);
    for (const layer of animation.layers) {
      const keys = layer.shapes[0].ks!.k as unknown as { t: number }[];
      expect(keys.filter((k) => k.t >= start && k.t <= end)).toHaveLength(2);
      const rotations = layer.ks.r.k.filter((k) => k.t >= start && k.t <= end);
      expect(rotations).toHaveLength(2);
      expect(rotations[1].s[0] - rotations[0].s[0]).toBeCloseTo(360, 2);
    }
  });
});
