import { describe, expect, it, vi } from "vitest";
import { collectPortraitBackfillJobs, runPortraitBackfillWithRetry } from "./portrait-backfill";
import type { NarraBookState, NarraCharacter } from "./types";

const character = (id: string, unlockProgress: number, portraitUri?: string): NarraCharacter => ({
  id,
  name: id,
  fullName: id,
  role: "герой",
  gender: "male",
  voice: "voice",
  traits: [],
  speechStyle: "",
  speechExamples: [],
  appearancePrompt: "",
  unlockProgress,
  portraitUri,
});

const narraBook = (bookId: string, characters: NarraCharacter[]): NarraBookState => ({
  bookId,
  characters,
  memories: {},
  chats: {},
  scenes: {},
  sceneAudios: {},
  summaries: {},
});

describe("character portrait backfill", () => {
  it("collects every unlocked existing character without a portrait", () => {
    const jobs = collectPortraitBackfillJobs(
      [
        { id: "old-import", progress: 0.6 },
        { id: "catalog", progress: 0.2 },
      ],
      {
        "old-import": narraBook("old-import", [
          character("missing", 0.1),
          character("ready", 0, "file:///portrait.png"),
          character("locked", 0.8),
        ]),
        catalog: narraBook("catalog", [character("catalog-missing", 0)]),
      },
    );

    expect(jobs.map((job) => `${job.bookId}:${job.character.id}`)).toEqual([
      "old-import:missing",
      "catalog:catalog-missing",
    ]);
  });

  it("does not regenerate a portrait bundled with a catalog character", () => {
    const bundledCharacter = {
      ...character("anna", 0),
      portraitAssetId: "anna-karenina/anna-karenina",
    };

    expect(
      collectPortraitBackfillJobs([{ id: "catalog", progress: 0 }], {
        catalog: narraBook("catalog", [bundledCharacter]),
      }),
    ).toEqual([]);
  });

  it("retries transient failures and returns the successful portrait", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce("file:///portrait.png");
    const wait = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(runPortraitBackfillWithRetry(operation, wait)).resolves.toBe(
      "file:///portrait.png",
    );
    expect(operation).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[2_000], [8_000]]);
  });

  it("stops after three failed attempts", async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("offline"));
    const wait = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(runPortraitBackfillWithRetry(operation, wait)).rejects.toThrow("offline");
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
