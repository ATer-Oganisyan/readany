import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const importActions = readFileSync(
  new URL("../../hooks/use-book-import-actions.ts", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const libraryStore = readFileSync(
  new URL("../../stores/library-store.ts", import.meta.url),
  "utf8",
);
const ruLibrary = readFileSync(
  new URL("../../../../core/src/i18n/locales/ru/library.json", import.meta.url),
  "utf8",
);
const ruLibraryMessages = JSON.parse(ruLibrary) as {
  library: { localImportEnrichmentPending: string };
};

describe("local book import toast contract", () => {
  it("announces background enrichment only after a successful device import", () => {
    expect(importActions).toContain("showImportSummary(summary, undefined, true)");
    expect(importActions).toContain("library.localImportEnrichmentPending");
    expect(importActions).toContain('name: "magic-wand"');
    expect(importActions).toContain('variant: "filled"');

    const urlImport = importActions.slice(importActions.indexOf("const handleUrlImport"));
    expect(urlImport).not.toContain("showImportSummary(summary, undefined, true)");
  });

  it("starts the enrichment toast with the completed state", () => {
    expect(ruLibraryMessages.library.localImportEnrichmentPending).toBe(
      "Готово! Скоро добавим обложку и\u00a0персонажей",
    );
    expect(importActions).toContain("обложку и\\u00A0персонажей");
  });

  it("renders toast text with the regular interface font", () => {
    const toastOptions = app.slice(app.indexOf("toastOptions={{"));
    expect(toastOptions).toContain("fontFamily: interfaceFontFamily.regular");
    expect(toastOptions).toContain('fontWeight: "400"');
  });

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
