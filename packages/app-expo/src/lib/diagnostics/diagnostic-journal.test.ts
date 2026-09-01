import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagnosticJournal,
  diagnosticEntry,
  diagnosticErrorReason,
} from "./diagnostic-journal";

afterEach(() => vi.useRealTimers());

describe("private local diagnostics", () => {
  it("keeps only safe backend verification fields", () => {
    expect(
      diagnosticEntry("backend_probe", {
        host: "api.narra.disrupt.builders",
        buildEnvironment: "production",
        expectedEnvironment: "production",
        environment: "production",
        version: "d56f0123",
        ok: true,
        url: "https://api.narra.disrupt.builders/health?token=secret",
      })?.data,
    ).toEqual({
      host: "api.narra.disrupt.builders",
      buildEnvironment: "production",
      expectedEnvironment: "production",
      environment: "production",
      version: "d56f0123",
      ok: true,
    });
    expect(
      diagnosticEntry("backend_probe", {
        host: "private.example",
        version: "bad version containing private text",
      })?.data,
    ).toEqual({});
  });

  it("keeps scene correlation without allowing signed URLs, tokens or arbitrary IDs", () => {
    const requestId = "22222222-2222-4222-8222-222222222222";
    expect(
      diagnosticEntry("scene_request", {
        requestId,
        bookEditionId: requestId,
        sceneKey: "text-interval-v1:6",
        requestedProgress: 0.385,
        stage: "download",
        imageUrl: "https://storage?token=secret",
        failure: "secret",
        excerpt: "private",
      })?.data,
    ).toEqual({
      requestId,
      bookEditionId: requestId,
      sceneKey: "text-interval-v1:6",
      requestedProgress: 0.385,
      stage: "download",
    });
    expect(
      diagnosticEntry("scene_request", {
        requestId: "secret",
        sceneKey: "secret",
        requestedProgress: Number.POSITIVE_INFINITY,
        stage: "secret",
      })?.data,
    ).toEqual({});
    expect(diagnosticEntry("reader_open", { requestId })?.data).toEqual({});
  });
  it("drops arbitrary messages, tokens, paths, content and IDs", () => {
    const event = diagnosticEntry("reader_error", {
      reason: "transport",
      loading: true,
      attempt: 1,
      message: "sk-secret",
      url: "https://host?key=secret",
      bookId: "private-id",
      text: "private book",
      token: "secret",
      code: "secret",
    });
    expect(event?.data).toEqual({ reason: "transport", loading: true, attempt: 1 });
    expect(diagnosticEntry("private message")).toBeNull();
    expect(
      diagnosticEntry("reader_error", { reason: "sk-secret", durationMs: Number.POSITIVE_INFINITY })
        ?.data,
    ).toEqual({});
    expect(diagnosticErrorReason(new Error("Load failed https://host?key=secret"))).toBe(
      "transport",
    );
  });

  it("persists events for the next app session and sanitizes stored data again", async () => {
    let disk = "[]";
    const io = {
      read: async () => disk,
      write: async (value: string) => {
        disk = value;
      },
    };
    const first = createDiagnosticJournal(io);
    first.record("server_start", { restart: true });
    first.record("reader_error", { reason: "transport", secret: "bad" });
    await first.flush();
    const second = createDiagnosticJournal(io);
    expect(await second.snapshot()).toHaveLength(2);
    expect(disk).not.toContain("bad");
    disk = JSON.stringify([
      {
        at: new Date().toISOString(),
        event: "reader_error",
        data: { reason: "unknown", message: "old secret" },
      },
    ]);
    expect(JSON.stringify(await createDiagnosticJournal(io).snapshot())).not.toContain(
      "old secret",
    );
  });

  it("bounds the journal and expires old entries", async () => {
    let now = Date.now();
    const journal = createDiagnosticJournal({
      read: async () => "[]",
      write: async () => {},
      now: () => now,
    });
    for (let i = 0; i < 600; i++) journal.record("reader_tap");
    await journal.flush();
    expect(await journal.snapshot()).toHaveLength(500);
    now += 8 * 24 * 60 * 60 * 1000;
    expect(await journal.snapshot()).toHaveLength(0);
  });

  it("survives corrupted files and failed writes without rejecting product work", async () => {
    const journal = createDiagnosticJournal({
      read: async () => "invalid",
      write: async () => {
        throw new Error("disk full");
      },
    });
    journal.record("reader_ready");
    await expect(journal.flush()).resolves.toBeUndefined();
    expect(await journal.snapshot()).toHaveLength(1);
  });

  it("coalesces frequent events into one disk write", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => {});
    const journal = createDiagnosticJournal({ read: async () => "[]", write });
    for (let i = 0; i < 20; i++) journal.record("reader_tap");
    await journal.snapshot();
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    await journal.snapshot();
    expect(write).toHaveBeenCalledTimes(1);
  });
});
