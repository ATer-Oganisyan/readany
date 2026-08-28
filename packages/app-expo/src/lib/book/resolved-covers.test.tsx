import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useResolvedCovers } from "../../screens/notes/useResolvedCovers";

const io = vi.hoisted(() => ({
  getAppDataDir: vi.fn<() => Promise<string>>(),
  joinPath: vi.fn(async (directory: string, path: string) => `${directory}/${path}`),
}));
vi.mock("@readany/core/services", () => ({ getPlatformService: () => io }));

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousEnvironment: boolean | undefined;
let tree: ReactTestRenderer | undefined;
let result = new Map<string, string>();

beforeAll(() => {
  previousEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = previousEnvironment;
});
afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
  result = new Map();
  vi.clearAllMocks();
});

function Probe({ items }: { items: { bookId: string; coverUrl: string }[] }) {
  result = useResolvedCovers(items);
  return null;
}

describe("visible local cover resolution", () => {
  it("does not publish or continue obsolete path work after a new result window", async () => {
    let finishOld: (directory: string) => void = () => {};
    io.getAppDataDir.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    io.getAppDataDir.mockResolvedValue("/fixture");
    await act(async () => {
      tree = create(createElement(Probe, { items: [{ bookId: "old", coverUrl: "old.jpg" }] }));
    });
    await act(async () => {
      tree?.update(
        createElement(Probe, { items: [{ bookId: "current", coverUrl: "current.jpg" }] }),
      );
    });
    expect([...result]).toEqual([["current", "/fixture/current.jpg"]]);
    const current = result;
    await act(async () => {
      finishOld("/old-fixture");
    });
    expect(result).toBe(current);
    expect(io.joinPath).toHaveBeenCalledTimes(1);
    expect(io.joinPath).toHaveBeenCalledWith("/fixture", "current.jpg");
  });

  it("clears an abandoned window and ignores its delayed completion", async () => {
    let finish: (directory: string) => void = () => {};
    io.getAppDataDir.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      tree = create(createElement(Probe, { items: [{ bookId: "old", coverUrl: "old.jpg" }] }));
    });
    await act(async () => {
      tree?.update(createElement(Probe, { items: [] }));
    });
    const empty = result;
    await act(async () => {
      finish("/fixture");
    });
    expect(result).toBe(empty);
    expect(result.size).toBe(0);
    expect(io.joinPath).not.toHaveBeenCalled();
  });

  it("keeps the map reference for a no-op update and retains absolute URIs", async () => {
    io.getAppDataDir.mockResolvedValue("/fixture");
    await act(async () => {
      tree = create(
        createElement(Probe, { items: [{ bookId: "one", coverUrl: "file:///one.jpg" }] }),
      );
    });
    const first = result;
    await act(async () => {
      tree?.update(
        createElement(Probe, { items: [{ bookId: "one", coverUrl: "file:///one.jpg" }] }),
      );
    });
    expect(result).toBe(first);
    expect([...result]).toEqual([["one", "file:///one.jpg"]]);
    expect(io.joinPath).not.toHaveBeenCalled();
  });
});
