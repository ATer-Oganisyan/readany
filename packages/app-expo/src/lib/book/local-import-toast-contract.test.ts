import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const libraryStore = readFileSync(
  new URL("../../stores/library-store.ts", import.meta.url),
  "utf8",
);

describe("local book import toast contract", () => {
  // User-facing feedback is exercised through the mounted hook in
  // import-actions.test.tsx, not source-string assertions about AI promises.

  it("queues cover generation for every device import and repairs older missing jobs", () => {
    expect(libraryStore.match(/void queueGeneratedBookCover\(book/g)).toHaveLength(3);
    expect(libraryStore).toContain('if (book.sourceKind === "catalog") continue;');
    expect(libraryStore).not.toContain(
      'book.sourceKind === "catalog" || !(await getLocalCoverJob(book.id))',
    );
  });

  it("refreshes an existing local book when the same file is imported again", () => {
    expect(libraryStore).toContain(
      "const importTarget = existingKnownBook ?? deletedMatch ?? existingDuplicate ?? null;",
    );
    expect(libraryStore).not.toContain(
      'if (existingDuplicate?.syncStatus === "local" && !existingKnownBook)',
    );
  });

  it("resumes source upload and markup polling after persisted state hydrates", () => {
    expect(libraryStore).toContain("resumeInterruptedBackendImports(books);");
    expect(libraryStore).toContain(
      'binding.sourceUploaded && backendBook.backendManifest?.availability === "ready"',
    );
    expect(libraryStore).toContain("if (!narra._hasHydrated) return false;");
  });
});
