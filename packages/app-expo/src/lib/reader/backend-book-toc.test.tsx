import { ReaderTOCPanel } from "@/screens/reader/ReaderTOCPanel";
import { readFileSync } from "node:fs";
import { parseBackendBookToc } from "@/lib/narra/backend-catalog-api";
import { flattenTocItems } from "@/screens/reader/reader-toc-items";
import { useBackendBookToc } from "@/screens/reader/useBackendBookToc";
import type { Book, TOCItem } from "@readany/core/types";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/narra/backend-catalog-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchBackendBookToc: mocks.fetch,
}));
vi.mock("@/stores/persist", () => ({ loadFromFS: mocks.load, debouncedSave: mocks.save }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("@/styles/theme", () => ({
  useTheme: () => ({ colors: { primary: "orange", foreground: "black" } }),
}));
vi.mock("@deslop/primitives", () => ({ spacingPixels: { 16: 16 } }));
vi.mock("@expo/ui", () => ({ Host: "Host", List: "List", ListItem: "ListItem", Text: "Text" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.runIf(Boolean(process.env.NARRA_CATALOG_TOC_REPORT))("passes every real catalog route payload into reader rows without losing names, order or links", () => {
  const report = JSON.parse(readFileSync(process.env.NARRA_CATALOG_TOC_REPORT!, "utf8"));
  expect(report.checked).toBe(1503);
  expect(report.failures).toEqual([]);
  expect(report.payloads).toHaveLength(1503);
  for (const payload of report.payloads) {
    const toc = parseBackendBookToc(payload, payload.book_edition_id, payload.source_content_hash);
    const rows = flattenTocItems(toc, "", "");
    expect(rows.map(row => row.title)).toEqual(payload.items.map((item: { title: string }) => item.title));
    expect(rows.map(row => row.href)).toEqual(payload.items.map((item: { reader_href: string }) => item.reader_href));
  }
});
const book = {
  id: "local",
  sourceKind: "catalog",
  format: "epub",
  bookEditionId: "edition",
  contentHash: "b".repeat(64),
} as Book;
const items: TOCItem[] = [
  { id: "one", title: "Глава I", level: 0, href: "OPS/one.xhtml" },
  { id: "two", title: "Глава I", level: 0, href: "OPS/two.xhtml" },
];
const payload = {
  contract_version: "book-content-toc-v1",
  book_edition_id: "edition",
  source_content_hash: book.contentHash,
  items: items.map((i) => ({
    key: i.id,
    title: i.title,
    level: i.level,
    parent_key: null,
    reader_href: i.href,
  })),
};
let tree: ReactTestRenderer | undefined;
let visible: TOCItem[] | null;
function Probe({ current = book }: { current?: Book }) {
  visible = useBackendBookToc(current);
  return null;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(null);
});
afterEach(async () => {
  if (tree) await act(() => tree?.unmount());
  tree = undefined;
});

it("keeps verified server chapters offline", async () => {
  mocks.load.mockResolvedValue(payload);
  mocks.fetch.mockRejectedValue(new Error("offline"));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  await act(async () => {
    tree = create(<Probe />);
  });
  expect(visible).toEqual(items);
  expect(mocks.save).not.toHaveBeenCalled();
  warning.mockRestore();
});

it("does not let a slow cache overwrite the refreshed server list", async () => {
  let finishCache!: (value: unknown) => void;
  mocks.load.mockReturnValue(
    new Promise((resolve) => {
      finishCache = resolve;
    }),
  );
  mocks.fetch.mockResolvedValue({ payload, items });
  await act(async () => {
    tree = create(<Probe />);
  });
  await act(async () => {
    finishCache({ ...payload, items: [payload.items[0]] });
  });
  expect(visible).toEqual(items);
  expect(mocks.save).toHaveBeenCalledWith(expect.any(String), payload);
});

it("cancels the previous book request and ignores its late response", async () => {
  let finish!: (value: unknown) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    tree = create(<Probe />);
  });
  const signal = mocks.fetch.mock.calls[0][2] as AbortSignal;
  await act(async () => {
    tree?.update(<Probe current={{ ...book, sourceKind: "local" }} />);
  });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish({ payload, items });
  });
  expect(visible).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("selects and highlights the exact chapter when titles repeat", async () => {
  const select = vi.fn();
  await act(async () => {
    tree = create(
      <ReaderTOCPanel
        toc={items}
        currentChapter="Глава I"
        currentChapterHref="OPS/two.xhtml"
        onSelectTocItem={select}
      />,
    );
  });
  if (!tree) throw new Error("Panel did not mount");
  const texts = tree.root.findAll((node) => node.type === ("Text" as unknown));
  expect(texts.map((node) => node.props.textStyle.color)).toEqual(["black", "orange"]);
  const rows = tree.root.findAll((node) => node.type === ("ListItem" as unknown));
  await act(() => rows[1].props.onPress());
  expect(select).toHaveBeenCalledWith("OPS/two.xhtml");
});
