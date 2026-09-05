import { buildStoreOnlyZip } from "@readany/core/utils/store-only-zip";
import { beforeEach, describe, expect, it, vi } from "vitest";
const files = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("@readany/core/db", () => ({}));
vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("expo-crypto", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(readonly uri: string) {}
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
  },
  Directory: class {},
  Paths: {},
}));
vi.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  readAsStringAsync: async (
    uri: string,
    { position, length }: { position: number; length: number },
  ) => Buffer.from(files.get(uri)?.slice(position, position + length) ?? []).toString("base64"),
}));
import { MobileSyncAdapter } from "../sync/sync-adapter-mobile";

beforeEach(() => files.clear());
describe("actual mobile cloud-download admission", () => {
  it("rejects downloaded HTML instead of publishing a phantom EPUB", async () => {
    files.set("file:///new.epub", new TextEncoder().encode("<html>Login required</html>"));
    await expect(
      new MobileSyncAdapter().validateBookFile("file:///new.epub", "epub"),
    ).rejects.toMatchObject({ code: "CORRUPT_SOURCE" });
  });
  it("accepts a complete readable FB2 through the real bounded native range reader", async () => {
    files.set(
      "file:///new.fb2",
      new TextEncoder().encode(
        "<FictionBook><body><section><p>Анна читает письмо.</p></section></body></FictionBook>",
      ),
    );
    await expect(
      new MobileSyncAdapter().validateBookFile("file:///new.fb2", "fb2"),
    ).resolves.toBeUndefined();
  });
  it("rejects a missing artifact before trying to parse it", async () => {
    await expect(
      new MobileSyncAdapter().validateBookFile("file:///missing.epub", "epub"),
    ).rejects.toThrow(/empty or unavailable/);
  });
  it("validates a nested FB2 archive using its stored format, not its .zip extension", async () => {
    files.set(
      "file:///new.zip",
      buildStoreOnlyZip([
        {
          name: "nested/story.fb2",
          data: new TextEncoder().encode(
            "<FictionBook><body><section><p>Анна читает письмо.</p></section></body></FictionBook>",
          ),
        },
      ]),
    );
    await expect(
      new MobileSyncAdapter().validateBookFile("file:///new.zip", "fbz"),
    ).resolves.toBeUndefined();
  });
});
