import { describe, expect, it } from "vitest";
import { PlaybackMotion } from "./playback-motion";

describe("playback morph", () => {
  it("uses direct play/pause when audio is ready before loader entry", () => {
    const m = new PlaybackMotion();
    m.setTarget("loading");
    m.sample(0);
    m.setTarget("pause");
    expect(m.sample(40).seconds).toBe(0);
    expect(m.sample(340)).toEqual({ seconds: 0.3, active: false, mirror: false });
  });
  it("finishes entry then at least a full 400ms turn, before exiting at the matching angle", () => {
    const m = new PlaybackMotion("loading");
    m.sample(0);
    m.sample(80);
    m.setTarget("pause");
    expect(m.sample(379).seconds).toBeCloseTo(1.699);
    expect(m.sample(380).seconds).toBeCloseTo(2.1);
    expect(m.sample(779).seconds).toBeLessThan(2.5);
    expect(m.sample(879).seconds).toBeLessThan(2.5);
    expect(m.sample(880).seconds).toBeCloseTo(2.8);
    expect(m.sample(1231)).toEqual({ seconds: 0.3, active: false, mirror: false });
  });
  it("enters loader from pause for seeking, and loops until ready", () => {
    const m = new PlaybackMotion("pause");
    m.setTarget("loading");
    expect(m.sample(0).seconds).toBeCloseTo(6);
    expect(m.sample(300).seconds).toBeCloseTo(2.2);
    expect(m.sample(700).seconds).toBeCloseTo(2.2);
    m.setTarget("pause");
    expect(m.sample(701).seconds).toBeLessThan(2.5);
    expect(m.sample(900).seconds).toBeCloseTo(2.8);
    expect(m.sample(1251).active).toBe(false);
  });
  it("honors cancellation instead of a stale successful target", () => {
    const m = new PlaybackMotion("loading");
    m.sample(0);
    m.sample(80);
    m.sample(380);
    m.setTarget("pause");
    m.sample(400);
    m.setTarget("play");
    expect(m.sample(780).seconds).toBeCloseTo(5.35);
    expect(m.sample(1081)).toEqual({ seconds: 0, active: false, mirror: false });
  });
  it("takes a new loading request after an already-running exit without jumping", () => {
    const m = new PlaybackMotion("pause");
    m.setTarget("play");
    m.sample(0);
    m.setTarget("loading");
    expect(m.sample(150).seconds).toBeCloseTo(0.85);
    m.sample(301);
    expect(m.sample(382).seconds).toBeCloseTo(1.4);
  });
  it("uses static poses for reduced motion", () => {
    const m = new PlaybackMotion("loading");
    expect(m.sample(0, true).active).toBe(false);
    m.setTarget("pause");
    expect(m.sample(1, true)).toEqual({ seconds: 0.3, active: false, mirror: false });
  });
});

describe("loader direction", () => {
  it("turns forward by default, on the same clips as before", () => {
    const m = new PlaybackMotion("pause");
    m.setTarget("loading");
    expect(m.sample(0).mirror).toBe(false);
    expect(m.sample(300).mirror).toBe(false);
  });
  it("mirrors the whole pause -> loader -> pause sequence when seeking backward", () => {
    const m = new PlaybackMotion("pause");
    m.setDirection(-1);
    m.setTarget("loading");
    // Every pose in this sequence is mirror-symmetric, so all of it reflects.
    expect(m.sample(0)).toMatchObject({ seconds: 6, mirror: true });
    expect(m.sample(300)).toMatchObject({ seconds: 2.2, mirror: true });
    expect(m.sample(700).mirror).toBe(true);
    m.setTarget("pause");
    expect(m.sample(900)).toMatchObject({ seconds: 2.8, mirror: true });
    expect(m.sample(1251)).toEqual({ seconds: 0.3, active: false, mirror: false });
  });
  it("keeps the play triangle unmirrored on entry and on cancellation", () => {
    const m = new PlaybackMotion("play");
    m.setDirection(-1);
    m.setTarget("loading");
    m.sample(0);
    // Entry from play draws the triangle, which is not mirror-symmetric.
    expect(m.sample(80)).toMatchObject({ seconds: 1.4, mirror: false });
    expect(m.sample(200).mirror).toBe(false);
    // The pure spinner is exactly symmetric, so the flip lands invisibly here.
    expect(m.sample(380)).toMatchObject({ seconds: 2.1, mirror: true });
    m.setTarget("play");
    expect(m.sample(780)).toMatchObject({ seconds: 5.35, mirror: false });
  });
  it("applies a new direction only once the loader sequence is over", () => {
    const m = new PlaybackMotion("pause");
    m.setDirection(-1);
    m.setTarget("loading");
    expect(m.sample(0).mirror).toBe(true);
    // A forward request mid-spin must not flip the loop being watched.
    m.setDirection(1);
    expect(m.sample(400).mirror).toBe(true);
    expect(m.sample(700).mirror).toBe(true);
  });
});
