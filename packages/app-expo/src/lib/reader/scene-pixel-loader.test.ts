import { primaryColors } from "@deslop/primitives";
import { describe, expect, it } from "vitest";
import {
  SCENE_PIXEL_LEVELS,
  type SceneEffectPreset,
  drawScenePixels,
  scenePixelColor,
  scenePixelPalette,
} from "./scene-pixel-loader";

describe("scene pixels use Primitives without overlapping opacity", () => {
  for (const mode of ["light", "dark"] as const) {
    const high = primaryColors.find((token) => token.name === "Primary 8");
    const palette = scenePixelPalette(high?.[mode] ?? "");
    if (!palette) throw new Error("Missing scene tokens");

    it(`${mode}: maps from Primary 1 to the existing Primary 8 token`, () => {
      expect(scenePixelColor(0, palette)[3]).toBe(0.01);
      expect(scenePixelColor(1, palette)).toEqual(palette.primary8);
      expect(palette.mode).toBe(mode);
      expect(palette.levels).toHaveLength(8);
      for (let level = 1; level <= 8; level++) {
        expect(scenePixelColor((level - 1) / 7, palette)[3]).toBeCloseTo(
          Math.min(level / 100, palette.primary8[3]),
          10,
        );
      }
      for (let i = 0; i <= 100; i++) {
        const color = scenePixelColor(i / 100, palette);
        expect(color.slice(0, 3)).toEqual(palette.primary8.slice(0, 3));
        expect(color[3]).toBeGreaterThanOrEqual(0.01);
        expect(color[3]).toBeLessThanOrEqual(palette.primary8[3]);
      }
    });

    for (const preset of ["pixels-organic", "sweep-gradient"] as SceneEffectPreset[]) {
      it(`${mode}/${preset}: one rectangle per cell, stable geometry, moving field, capped alpha`, () => {
        const frames: Array<Array<{ alpha: number; color: string; rect: number[] }>> = [];
        let rectangles: (typeof frames)[number] = [];
        let clears = 0;
        const context = {
          globalAlpha: 1,
          fillStyle: "",
          globalCompositeOperation: "source-over",
          save() {},
          restore() {},
          clearRect() {
            clears++;
            rectangles = [];
            frames.push(rectangles);
          },
          fillRect(...rect: number[]) {
            rectangles.push({ alpha: this.globalAlpha, color: this.fillStyle, rect });
          },
        };
        for (const t of [4, 4.5, 12])
          drawScenePixels(context as unknown as CanvasRenderingContext2D, 320, t, palette, preset);
        expect(clears).toBe(3);
        expect(frames[0]).not.toEqual(frames[1]);
        const cell = 320 / 22;
        for (const frame of frames) {
          expect(frame).toHaveLength(22 * 22);
          frame.forEach(({ alpha, color, rect }, index) => {
            expect(alpha).toBeLessThanOrEqual(palette.primary8[3]);
            expect(alpha).toBeGreaterThanOrEqual(0);
            expect(color).toBe(`rgb(${palette.primary8.slice(0, 3).join(",")})`);
            expect(rect[0]).toBeGreaterThan((index % 22) * cell);
            expect(rect[0] + rect[2]).toBeLessThanOrEqual(((index % 22) + 1) * cell);
            expect(rect[1] + rect[3]).toBeLessThanOrEqual((Math.floor(index / 22) + 1) * cell);
          });
        }
      });
    }
  }
  it("does not guess a gray palette from missing tokens", () => {
    expect(scenePixelPalette("")).toBeNull();
  });
  it("keeps the original stop mapping before preset-specific contrast normalization", () => {
    expect(SCENE_PIXEL_LEVELS["pixels-organic"].light).toEqual([2, 1, 1, 1, 8]);
    expect(SCENE_PIXEL_LEVELS["pixels-organic"].dark).toEqual([1, 3, 6, 1, 8]);
    expect(SCENE_PIXEL_LEVELS["sweep-gradient"].light).toEqual([1, 1, 3, 5, 8]);
    expect(SCENE_PIXEL_LEVELS["sweep-gradient"].dark).toEqual([1, 1, 3, 5, 8]);
  });
  it("light/sepia idle uses a visible range across time without exceeding Primary 8", () => {
    const palette = scenePixelPalette("#11111114");
    if (!palette) throw new Error("Missing light palette");
    for (let seconds = 0; seconds <= 60; seconds += 2) {
      const alphas: number[] = [];
      const context = {
        globalAlpha: 1,
        save() {},
        restore() {},
        clearRect() {},
        fillRect(x: number, y: number, width: number, height: number) {
          if (x > 24 && y > 24 && x + width < 296 && y + height < 296) {
            alphas.push(this.globalAlpha);
          }
        },
      };
      drawScenePixels(context as unknown as CanvasRenderingContext2D, 320, seconds, palette);
      expect(Math.min(...alphas)).toBeLessThan(0.015);
      expect(Math.max(...alphas)).toBeGreaterThan(0.065);
      expect(Math.max(...alphas)).toBeLessThanOrEqual(palette.primary8[3]);
    }
  });
  it.each([
    [
      "#11111114",
      "sweep-gradient",
      [0.011761, 0.010027, 0.010463, 0.010879, 0.010034, 0.010302, 0.010018, 0.010004, 0.01],
    ],
    [
      "#ffffff14",
      "sweep-gradient",
      [0.011761, 0.010027, 0.010463, 0.010879, 0.010034, 0.010302, 0.010018, 0.010004, 0.01],
    ],
    [
      "#ffffff14",
      "pixels-organic",
      [0.011226, 0.033775, 0.020995, 0.013409, 0.025914, 0.021584, 0.025905, 0.039603, 0.03243],
    ],
  ] as const)("leaves %s/%s unchanged", (token, preset, expected) => {
    const values: number[] = [];
    const context = {
      globalAlpha: 1,
      save() {},
      restore() {},
      clearRect() {},
      fillRect(x: number, y: number) {
        if (x > 140 && x < 180 && y > 140 && y < 180)
          values.push(Number(this.globalAlpha.toFixed(6)));
      },
    };
    const palette = scenePixelPalette(token);
    if (!palette) throw new Error("Missing scene palette");
    drawScenePixels(context as unknown as CanvasRenderingContext2D, 320, 4, palette, preset);
    expect(values).toEqual(expected);
  });
});
