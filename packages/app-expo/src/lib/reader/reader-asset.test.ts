import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createReaderAssetLoader, versionReaderAssetUri } from "./reader-asset";

const oldHash = "1".repeat(32);
const newHash = "2".repeat(32);
const source = "http://localhost:8081/assets/reader.html?platform=ios&hash=old";

function harness() {
  const files = new Map<string, string>();
  const download = vi.fn(async (_uri: string, hash: string) => {
    const uri = `file:///cache/reader-${hash}.html`;
    files.set(uri, hash);
    return uri;
  });
  const inspect = vi.fn(async (uri: string) => ({ exists: files.has(uri), md5: files.get(uri) }));
  return { files, download, inspect, load: createReaderAssetLoader({ download, inspect }) };
}

describe("versioned reader assets", () => {
  it("versions the URL without losing Metro query parameters", () => {
    const uri = new URL(versionReaderAssetUri(source, newHash));
    expect(uri.searchParams.get("hash")).toBe(newHash);
    expect(uri.searchParams.get("readerVersion")).toBe(newHash);
    expect(uri.searchParams.get("platform")).toBe("ios");
  });
  it("preserves Expo's encoded asset path", () => {
    const source = "http://localhost:8081/assets/?unstable_path=.%2Fassets%2Freader/reader.html";
    expect(new URL(versionReaderAssetUri(source, newHash)).searchParams.get("unstable_path")).toBe(
      "./assets/reader/reader.html",
    );
  });
  it("keeps embedded assets offline", () => {
    expect(versionReaderAssetUri("file:///app/reader.html", newHash)).toBe(
      "file:///app/reader.html",
    );
  });
  it("shares concurrent startup/book preparation", async () => {
    const h = harness();
    const a = h.load(source, newHash);
    const b = h.load(source, newHash);
    expect(a).toBe(b);
    await a;
    expect(h.download).toHaveBeenCalledTimes(1);
    expect(h.inspect).toHaveBeenCalledTimes(1);
  });
  it("never reuses the previous build's file", async () => {
    const h = harness();
    const a = await h.load(source, oldHash);
    const b = await h.load(source, newHash);
    expect(a).not.toBe(b);
    expect(h.files.get(b)).toBe(newHash);
  });
  it("rechecks after OS cache eviction instead of trusting a fulfilled promise", async () => {
    const h = harness();
    const uri = await h.load(source, newHash);
    h.files.delete(uri);
    await h.load(source, newHash);
    expect(h.download).toHaveBeenCalledTimes(2);
    expect(h.files.get(uri)).toBe(newHash);
  });
  it("rejects an old file even if download reports success, and permits retry", async () => {
    const h = harness();
    h.inspect.mockResolvedValueOnce({ exists: true, md5: oldHash });
    await expect(h.load(source, newHash)).rejects.toThrow("does not match");
    await expect(h.load(source, newHash)).resolves.toContain(newHash);
  });
  it("does not fall back to stale HTML after a failed download", async () => {
    const h = harness();
    await h.load(source, oldHash);
    h.download.mockRejectedValueOnce(new Error("offline"));
    await expect(h.load(source, newHash)).rejects.toThrow("offline");
    await expect(h.load(source, newHash)).resolves.toContain(newHash);
  });
  it("ships a manifest matching the actual reader bytes", () => {
    const html = readFileSync(new URL("../../../assets/reader/reader.html", import.meta.url));
    const manifest = JSON.parse(
      readFileSync(new URL("../../../assets/reader/reader-build.json", import.meta.url), "utf8"),
    );
    expect(manifest.htmlMd5).toBe(createHash("md5").update(html).digest("hex"));
  });
});
