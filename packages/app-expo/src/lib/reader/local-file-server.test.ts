import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("expo-file-system", () => ({
  FileMode: { ReadOnly: "r" },
  File: class {
    constructor(public uri: string) {}
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    async bytes() {
      const bytes = files.get(this.uri);
      if (!bytes) throw new Error("File not found");
      return bytes;
    }
    open() {
      const bytes = files.get(this.uri);
      if (!bytes) throw new Error("File not found");
      return {
        offset: 0,
        readBytes(length: number) {
          return bytes.slice(this.offset, this.offset + length);
        },
        close() {},
      };
    }
  },
}));
vi.mock("react-native-tcp-socket", () => ({ default: { createServer: net.createServer } }));

import { startFileServer, stopFileServer } from "./local-file-server";

beforeEach(() => {
  vi.stubGlobal("__DEV__", true);
  files.set("file:///test/.narra-reader-health", new TextEncoder().encode("health-token"));
  files.set(
    "file:///test/books/test.epub",
    new Uint8Array(200_000).map((_, i) => i % 255),
  );
});
afterEach(async () => {
  await stopFileServer();
  files.clear();
  vi.unstubAllGlobals();
});

describe("TCP file server with real HTTP requests", () => {
  it("flushes the health probe, HEAD and range response before closing the socket", async () => {
    const url = await startFileServer("file:///test");
    expect(await (await fetch(`${url}/.narra-reader-health?probe=1`)).text()).toBe("health-token");
    const head = await fetch(`${url}/books/test.epub`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("200000");
    expect(head.headers.get("access-control-allow-origin")).toBe("*");
    const range = await fetch(`${url}/books/test.epub`, { headers: { Range: "bytes=100-70000" } });
    expect(range.status).toBe(206);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(
      files.get("file:///test/books/test.epub")?.slice(100, 70001),
    );
  });

  it("restarts after an explicit stop and serves the same book", async () => {
    const old = await startFileServer("file:///test");
    await stopFileServer();
    await expect(fetch(`${old}/.narra-reader-health`)).rejects.toThrow();
    const next = await startFileServer("file:///test", { restart: true });
    const response = await fetch(`${next}/books/test.epub`);
    expect((await response.arrayBuffer()).byteLength).toBe(200_000);
  });

  it("keeps concurrent starts on one live server", async () => {
    const urls = await Promise.all([startFileServer("/test"), startFileServer("/test")]);
    expect(urls[0]).toBe(urls[1]);
  });

  it("returns usable error and OPTIONS responses, including malformed URLs", async () => {
    const url = await startFileServer("/test");
    expect((await fetch(`${url}/missing`)).status).toBe(404);
    expect((await fetch(`${url}/%ZZ`)).status).toBe(400);
    expect((await fetch(`${url}/books/test.epub`, { method: "OPTIONS" })).status).toBe(204);
    expect(
      (await fetch(`${url}/books/test.epub`, { headers: { Range: "bytes=999999-" } })).status,
    ).toBe(416);
  });
});
