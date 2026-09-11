import { expect, it, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  getInfoAsync: async () => ({ exists: true }),
  makeDirectoryAsync: vi.fn(),
  readAsStringAsync: async (path: string) => {
    const text = disk.get(path);
    if (text === undefined) throw new Error("missing file");
    return text;
  },
  writeAsStringAsync: vi.fn(async (path: string, text: string) => {
    disk.set(path, text);
  }),
}));
vi.mock("expo-secure-store", () => ({ getItemAsync: async () => null }));

it("upgrades old JSON without backfill, rejects stale events and preserves encountered characters across restart and refresh", async () => {
  const { emptyNarraBookState, isCharacterUnlocked } = await import("./domain");
  const character = { id: "hero", name: "Герой", unlockProgress: 0.8, backendManaged: true };
  const oldBook = (bookId: string) => ({ ...emptyNarraBookState(bookId), characters: [character] });
  const file = "file:///documents/readany-store/narra-interactive.json";
  disk.set(file, JSON.stringify({ books: { first: oldBook("first"), second: oldBook("second") } }));
  vi.resetModules();
  let { useNarraStore } = await import("@/stores/narra-store");
  const { recordCharacterEncounters } = await import("./character-encounters");
  await vi.waitFor(() => expect(useNarraStore.getState()._hasHydrated).toBe(true));
  expect(isCharacterUnlocked(0, useNarraStore.getState().books.first.characters[0])).toBe(false);
  expect(recordCharacterEncounters("first", ["hero"], "stale", "active")).toBe(false);
  expect(recordCharacterEncounters("first", ["hero"], undefined, "active")).toBe(false);
  expect(recordCharacterEncounters("missing", ["hero"], "active", "active")).toBe(false);
  expect(recordCharacterEncounters("first", ["unknown"], "active", "active")).toBe(false);
  expect(recordCharacterEncounters("first", ["hero", "hero"], "active", "active")).toBe(true);
  expect(recordCharacterEncounters("first", ["hero"], "active", "active")).toBe(false);
  await (await import("@/stores/persist")).flushAllWrites();
  expect(JSON.parse(disk.get(file)!).books.first.characters[0].encounteredInReader).toBe(true);
  vi.resetModules();
  ({ useNarraStore } = await import("@/stores/narra-store"));
  await vi.waitFor(() => expect(useNarraStore.getState()._hasHydrated).toBe(true));
  const first = () => useNarraStore.getState().books.first.characters[0];
  expect(isCharacterUnlocked(0, first())).toBe(true);
  expect(isCharacterUnlocked(0, useNarraStore.getState().books.second.characters[0])).toBe(false);
  useNarraStore.getState().setCharacters("first", [{ ...first(), encounteredInReader: undefined }]);
  expect(isCharacterUnlocked(0, first())).toBe(true);
  await (await import("@/stores/persist")).flushAllWrites();
});
