#!/usr/bin/env node
// Read-only pixel observation for this audit's 1080x2400 Android AVD.
// The clock ROI contains a flat background and native glyphs; output the most
// frequent colors rather than treating antialiased edge pixels as the text color.
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

if (process.argv.length < 3) throw new Error("Pass one or more original Android screenshot PNGs");
const luminance = (rgb) =>
  rgb
    .map((value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
for (const path of process.argv.slice(2)) {
  const png = PNG.sync.read(readFileSync(path));
  if (png.width !== 1080 || png.height !== 2400)
    throw new Error("Expected original 1080x2400 AVD screenshot");
  const colors = new Map();
  for (let y = 45; y < 90; y++) {
    for (let x = 60; x < 190; x++) {
      const index = (png.width * y + x) * 4;
      const rgb = Array.from(png.data.slice(index, index + 3));
      const key = rgb.join(",");
      const color = colors.get(key) ?? { rgb, pixels: 0 };
      color.pixels++;
      colors.set(key, color);
    }
  }
  const frequent = [...colors.values()].sort((a, b) => b.pixels - a.pixels).slice(0, 4);
  const pair = frequent
    .slice(0, 2)
    .map(({ rgb }) => luminance(rgb))
    .sort((a, b) => b - a);
  console.log(
    JSON.stringify({
      path,
      roi: { x: 60, y: 45, width: 130, height: 45 },
      frequent,
      dominantPairContrast: Number(((pair[0] + 0.05) / (pair[1] + 0.05)).toFixed(2)),
    }),
  );
}
