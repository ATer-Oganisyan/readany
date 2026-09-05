import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_ID,
  CONTEXT_EXPRESSION,
  SIMULATOR_ID,
  observeThenTerminate,
  parseOptions,
  selectTarget,
  terminateFixedApp,
} from "../../../scripts/qa/ios-reader-checkpoint-kill.mjs";

const BOOK_ID = "00000000-0000-4000-8000-000000000001";
const position = (cfi = "epubcfi(/6/2)", bookId = BOOK_ID) => ({
  bookId,
  cfi,
  timestamp: 1788500000000,
  percentage: 0.2,
});
const devices = {
  devices: { ios: [{ udid: SIMULATOR_ID, name: "iPhone 17 Pro Max", state: "Booted" }] },
};
const target = {
  appId: APP_ID,
  deviceName: "iPhone 17 Pro Max",
  title: "Hermes React Native",
  webSocketDebuggerUrl: "ws://127.0.0.1:8081/inspector/debug?device=one&page=1",
};

afterEach(() => vi.useRealTimers());

describe("guarded iOS checkpoint termination QA", () => {
  it("requires an explicit UUID and a bounded delay; rejects alternate targets and flags", () => {
    expect(parseOptions([`--book-id=${BOOK_ID}`])).toEqual({ bookId: BOOK_ID, delayMs: 700 });
    for (const args of [
      [],
      ["--book-id=chapter"],
      [`--book-id=${BOOK_ID}`, "--delay-ms=499"],
      [`--book-id=${BOOK_ID}`, "--delay-ms=2001"],
      [`--book-id=${BOOK_ID}`, "--delay-ms=700.5"],
      [`--book-id=${BOOK_ID}`, "--device=anything"],
      [`--book-id=${BOOK_ID}`, `--book-id=${BOOK_ID}`],
    ]) {
      expect(() => parseOptions(args)).toThrow();
    }
  });

  it("accepts only one Hermes iOS target on the exact, sole booted Simulator", () => {
    expect(selectTarget([target], devices)).toEqual(target);
    for (const targets of [
      [],
      [target, target],
      [{ ...target, appId: "other.app" }],
      [{ ...target, deviceName: "iPhone Other" }],
      [{ ...target, webSocketDebuggerUrl: "ws://example.org:8081/" }],
    ]) {
      expect(() => selectTarget(targets, devices)).toThrow();
    }
    expect(() =>
      selectTarget([target], { devices: { ios: [{ ...devices.devices.ios[0], udid: "other" }] } }),
    ).toThrow();
    expect(() =>
      selectTarget([target], {
        devices: { ios: [...devices.devices.ios, devices.devices.ios[0]] },
      }),
    ).toThrow();
  });

  it("reads only initialized service exports without requiring modules or mutating context", () => {
    const value = Object.freeze({
      bookId: BOOK_ID,
      currentPosition: Object.freeze({ cfi: "epubcfi(/6/2)", percentage: 0.2 }),
      timestamp: 123,
      currentChapter: { index: 2 },
    });
    const getContext = vi.fn(() => value);
    const requireModule = Object.assign(
      vi.fn(() => {
        throw new Error("must not initialize modules");
      }),
      {
        getModules: () =>
          new Map([
            [
              10,
              {
                isInitialized: true,
                verboseName: "../core/src/ai/reading-context-service.ts",
                publicModule: { exports: { readingContextService: { getContext } } },
              },
            ],
          ]),
      },
    );
    const context = vm.createContext({ __r: requireModule, HermesInternal: Object.freeze({}) });
    expect(vm.runInContext(CONTEXT_EXPRESSION, context)).toEqual({
      bookId: BOOK_ID,
      cfi: "epubcfi(/6/2)",
      percentage: 0.2,
      timestamp: 123,
      chapterIndex: 2,
    });
    expect(requireModule).not.toHaveBeenCalled();
    expect(getContext).toHaveBeenCalledOnce();
    expect(Object.keys(context)).toEqual(["__r", "HermesInternal"]);
    requireModule.getModules = () => new Map();
    expect(() => vm.runInContext(CONTEXT_EXPRESSION, context)).toThrow("initialized");
    expect(() => vm.runInNewContext(CONTEXT_EXPRESSION, { __r: requireModule })).toThrow(
      "Hermes runtime required",
    );
  });

  it("accepts the real Bridgeless target label and checks Hermes in the runtime instead", () => {
    const actualTarget = {
      ...target,
      title: "com.mishanaer.readany.dev (iPhone 17 Pro Max)",
      description: "React Native Bridgeless [C++ connection]",
    };
    expect(selectTarget([actualTarget], devices)).toEqual(actualTarget);
  });

  it("never terminates if the initial book/CFI/timestamp is absent or mismatched", async () => {
    for (const initial of [
      null,
      position("", BOOK_ID),
      position("epubcfi(/6/2)", "other-book"),
      { ...position(), timestamp: 0 },
    ]) {
      const terminate = vi.fn();
      await expect(
        observeThenTerminate({
          bookId: BOOK_ID,
          delayMs: 700,
          readContext: async () => initial,
          terminate,
        }),
      ).rejects.toThrow("Expected book");
      expect(terminate).not.toHaveBeenCalled();
    }
  });

  it("waits 700ms after observed changed CFI, retaining later CFI without resetting the deadline", async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const now = () => Date.now() - started;
    const log = vi.fn();
    const terminate = vi.fn(async () => {});
    const readContext = vi.fn(async () =>
      position(now() < 100 ? "initial" : now() < 400 ? "page-two" : "latest-page"),
    );
    const pending = observeThenTerminate({
      bookId: BOOK_ID,
      delayMs: 700,
      now,
      log,
      readContext,
      terminate,
    });
    await vi.advanceTimersByTimeAsync(799);
    expect(terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(terminate).toHaveBeenCalledOnce();
    expect(result.observedToKillRequestMs).toBe(700);
    expect(result.latestObserved.cfi).toBe("latest-page");
    expect(result.initial.cfi).toBe("initial");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "armed",
        timingOrigin: expect.stringContaining("NOT physical tap"),
      }),
    );
  });

  it("times out an unchanged CFI at 45s without terminating", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    const pending = observeThenTerminate({
      bookId: BOOK_ID,
      delayMs: 700,
      now: Date.now,
      readContext: async () => position(),
      terminate,
    });
    const assertion = expect(pending).rejects.toThrow("45 seconds");
    await vi.advanceTimersByTimeAsync(45000);
    await assertion;
    expect(terminate).not.toHaveBeenCalled();
  });

  it("cancels termination if another book is observed during the delay", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    const readContext = vi
      .fn()
      .mockResolvedValueOnce(position())
      .mockResolvedValueOnce(position("new-page"))
      .mockResolvedValue(position("foreign", "other-book"));
    const pending = observeThenTerminate({
      bookId: BOOK_ID,
      delayMs: 700,
      now: Date.now,
      readContext,
      terminate,
    });
    const assertion = expect(pending).rejects.toThrow("Expected book");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(terminate).not.toHaveBeenCalled();
  });

  it("bounds a stalled observation after the new CFI and reports its uncertainty", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn(async () => {});
    let rejectLate: (reason: Error) => void = () => {};
    const stalled = new Promise((_, reject) => {
      rejectLate = reject;
    });
    const readContext = vi
      .fn()
      .mockResolvedValueOnce(position())
      .mockResolvedValueOnce(position("new-page"))
      .mockReturnValue(stalled);
    const pending = observeThenTerminate({
      bookId: BOOK_ID,
      delayMs: 700,
      now: Date.now,
      readContext,
      terminate,
    });
    await vi.advanceTimersByTimeAsync(700);
    const result = await pending;
    expect(result.observedToKillRequestMs).toBe(700);
    expect(result.readPendingAtKill).toBe(true);
    expect(result.latestObserved.cfi).toBe("new-page");
    rejectLate(new Error("inspector disconnected by termination"));
    await vi.advanceTimersByTimeAsync(0);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("does not terminate on a stalled initial read or a disconnected inspector", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    const pending = observeThenTerminate({
      bookId: BOOK_ID,
      delayMs: 700,
      readContext: () => new Promise(() => {}),
      terminate,
    });
    const assertion = expect(pending).rejects.toThrow("Initial context read timed out");
    await vi.advanceTimersByTimeAsync(2500);
    await assertion;
    await expect(
      observeThenTerminate({
        bookId: BOOK_ID,
        delayMs: 700,
        readContext: async () => {
          throw new Error("disconnected");
        },
        terminate,
      }),
    ).rejects.toThrow("disconnected");
    expect(terminate).not.toHaveBeenCalled();
  });

  it("uses only the fixed simulator/app terminate command, not a shell or SIGKILL", async () => {
    const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
    await terminateFixedApp(run);
    expect(run).toHaveBeenCalledExactlyOnceWith(
      "/usr/bin/xcrun",
      ["simctl", "terminate", SIMULATOR_ID, APP_ID],
      { timeout: 10000, maxBuffer: 65536 },
    );
  });

  it("does not terminate if the inspector disconnects in the final poll-to-deadline gap", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    const started = Date.now();
    const readContext = vi
      .fn()
      .mockResolvedValueOnce(position())
      .mockResolvedValue(position("new-page"));
    const pending = observeThenTerminate({
      bookId: BOOK_ID,
      delayMs: 700,
      now: Date.now,
      readContext,
      terminate,
      assertConnected: () => {
        if (Date.now() - started >= 675) throw new Error("Inspector disconnected");
      },
    });
    const assertion = expect(pending).rejects.toThrow("Inspector disconnected");
    await vi.advanceTimersByTimeAsync(700);
    await assertion;
    expect(terminate).not.toHaveBeenCalled();
  });
});
