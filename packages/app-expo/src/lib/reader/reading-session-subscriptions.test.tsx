import { readFileSync } from "node:fs";
import vm from "node:vm";
import { useEffect, useRef } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ insert: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@readany/core/db/database", () => ({ insertReadingSession: runtime.insert }));
vi.mock("@readany/core/stores/sync-store", () => ({
  useSyncStore: { getState: () => ({ status: "idle" }) },
}));

import {
  setSessionEventSource,
  useReadingSession,
  webSessionEventSource,
} from "@readany/core/hooks/use-reading-session";
import { useReadingSessionStore } from "@readany/core/stores/reading-session-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const activity = new Set<() => void>();
const visibility = new Set<(visible: boolean) => void>();
const beforeUnload = new Set<() => void>();
const render = vi.fn();
const telemetry = vi.fn();

function SessionHarness({ bookId }: { bookId: string | null }) {
  render();
  useReadingSession(bookId);
  return null;
}

// Mount the actual ReaderContent subscription/ref/effect statements without
// its unrelated native UI. The selector and telemetry logic execute against
// the real Zustand store and real React lifecycle, not string assertions.
function readerTelemetryHarness() {
  const source = readFileSync(new URL("../../screens/ReaderScreen.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    "ReaderScreen.tsx",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  const reader = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "ReaderContent",
  );
  if (!reader || !ts.isFunctionDeclaration(reader) || !reader.body)
    throw new Error("ReaderContent missing");
  const statements = reader.body.statements.filter((node) => {
    if (ts.isVariableStatement(node))
      return node.declarationList.declarations.some((declaration) =>
        ["readingActiveTime", "hasQualifiedReadingTime", "qualifiedReadingRecordedRef"].includes(
          declaration.name.getText(ast),
        ),
      );
    return (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(ast) === "useEffect" &&
      node.getText(ast).includes('"reading_session_qualified"')
    );
  });
  if (statements.length !== 3) throw new Error("Reader telemetry extraction boundary changed");
  const code = `globalThis.Harness = ({bookId}) => {
    render();
    const book = { id: bookId, meta: { title: "Original test book" } };
    ${statements.map((node) => node.getText(ast)).join("\n")}
    return null;
  };`;
  const context = vm.createContext({
    useEffect,
    useRef,
    useReadingSessionStore,
    render,
    recordTelemetry: telemetry,
    findBundledCatalogBookByTitle: () => null,
    durationBucket: (milliseconds: number) => `bucket-${milliseconds}`,
  });
  vm.runInContext(ts.transpile(code, { target: ts.ScriptTarget.ESNext }), context);
  return context.Harness as (props: { bookId: string }) => null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  activity.clear();
  visibility.clear();
  beforeUnload.clear();
  useReadingSessionStore.setState({ currentSession: null, sessionState: "STOPPED", stats: null });
  setSessionEventSource({
    subscribeActivity: (callback) => {
      activity.add(callback);
      return () => activity.delete(callback);
    },
    subscribeVisibility: (callback) => {
      visibility.add(callback);
      return () => visibility.delete(callback);
    },
    subscribeBeforeUnload: (callback) => {
      beforeUnload.add(callback);
      return () => beforeUnload.delete(callback);
    },
  });
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  setSessionEventSource(webSessionEventSource);
  vi.useRealTimers();
});

function ticks(count: number) {
  for (let index = 0; index < count; index++)
    act(() => useReadingSessionStore.getState().updateActiveTime());
}

describe("reading-session subscriptions and book ownership", () => {
  it("does not rerender its consumer on ten real one-second session updates", async () => {
    await act(async () => {
      tree = create(<SessionHarness bookId="A" />);
    });
    render.mockClear();
    for (let index = 0; index < 10; index++)
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    expect(useReadingSessionStore.getState().currentSession?.totalActiveTime).toBe(10_000);
    expect(render).not.toHaveBeenCalled();
  });

  it("starts the new book, not the initially captured book, on mounted A to B change", async () => {
    await act(async () => {
      tree = create(<SessionHarness bookId="A" />);
    });
    ticks(2);
    await act(async () => {
      tree?.update(<SessionHarness bookId="B" />);
    });
    expect(useReadingSessionStore.getState().currentSession).toMatchObject({
      bookId: "B",
      totalActiveTime: 0,
    });
    expect(runtime.insert).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: "A", totalActiveTime: 2000 }),
    );
    expect(activity.size).toBe(1);
    expect(visibility.size).toBe(1);
    expect(beforeUnload.size).toBe(1);
  });

  it("starts a book selected after the mounted hook initially had no book", async () => {
    await act(async () => {
      tree = create(<SessionHarness bookId={null} />);
    });
    await act(async () => {
      tree?.update(<SessionHarness bookId="B" />);
    });
    expect(useReadingSessionStore.getState().currentSession?.bookId).toBe("B");
  });

  it("retains visibility pause/resume and removes the timer/listeners on unmount", async () => {
    await act(async () => {
      tree = create(<SessionHarness bookId="A" />);
    });
    act(() => {
      for (const callback of visibility) callback(false);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(useReadingSessionStore.getState().currentSession?.totalActiveTime).toBe(0);
    act(() => {
      for (const callback of activity) callback();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(useReadingSessionStore.getState().currentSession?.totalActiveTime).toBe(1000);
    await act(async () => {
      tree?.unmount();
      tree = undefined;
    });
    expect(useReadingSessionStore.getState().currentSession).toBeNull();
    expect(activity.size + visibility.size + beforeUnload.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ReaderContent qualified-reading telemetry subscription", () => {
  it("renders only at the threshold, emits once, and reads the actual accumulated duration", async () => {
    const Harness = readerTelemetryHarness();
    useReadingSessionStore.getState().startSession("A");
    await act(async () => {
      tree = create(<Harness bookId="A" />);
    });
    render.mockClear();
    ticks(59);
    expect(telemetry).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    // Batched ticks can exceed exactly 60 s before React commits the threshold.
    act(() => {
      for (let index = 0; index < 4; index++) useReadingSessionStore.getState().updateActiveTime();
    });
    expect(telemetry).toHaveBeenCalledExactlyOnceWith("reading_session_qualified", {
      book_kind: "imported",
      duration_seconds: 63,
      duration_bucket: "bucket-63000",
    });
    expect(render).toHaveBeenCalledOnce();
    render.mockClear();
    ticks(10);
    expect(render).not.toHaveBeenCalled();
    expect(telemetry).toHaveBeenCalledOnce();
  });

  it("does not qualify a new reader from an old book's 60-second session", async () => {
    const Harness = readerTelemetryHarness();
    useReadingSessionStore.getState().startSession("A");
    ticks(65);
    await act(async () => {
      tree = create(<Harness bookId="B" />);
    });
    expect(telemetry).not.toHaveBeenCalled();
    act(() => useReadingSessionStore.getState().startSession("B"));
    ticks(60);
    expect(telemetry).toHaveBeenCalledOnce();
  });

  it("permits the next mounted book to qualify independently", async () => {
    const Harness = readerTelemetryHarness();
    useReadingSessionStore.getState().startSession("A");
    await act(async () => {
      tree = create(<Harness bookId="A" />);
    });
    ticks(60);
    await act(async () => {
      tree?.update(<Harness bookId="B" />);
    });
    expect(telemetry).toHaveBeenCalledOnce();
    act(() => useReadingSessionStore.getState().startSession("B"));
    ticks(60);
    expect(telemetry).toHaveBeenCalledTimes(2);
  });
});
