import { CommonActions, StackActions, StackRouter } from "@react-navigation/routers";
import type { Book } from "@readany/core/types";
import type { TFunction } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  platform: "android",
  book: null as Book | null,
  exists: vi.fn(),
  updateBook: vi.fn(),
  loadBooks: vi.fn(),
  downloadBookFile: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  prompt: vi.fn(),
  inspect: vi.fn(),
  restore: vi.fn(),
  pick: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  toast: { error: runtime.error, loading: runtime.loading },
}));
vi.mock("@/stores/library-store", () => ({
  useLibraryStore: {
    getState: () => ({
      books: runtime.book ? [runtime.book] : [],
      loadBooks: runtime.loadBooks,
      inspectDeletedBookCandidate: runtime.inspect,
      reimportDeletedBook: runtime.restore,
    }),
  },
}));
vi.mock("@/stores/missing-book-prompt-store", () => ({
  useMissingBookPromptStore: { getState: () => ({ showPrompt: runtime.prompt }) },
}));
vi.mock("@readany/core/services", () => ({
  getPlatformService: () => ({
    exists: runtime.exists,
    getAppDataDir: async () => "file:///documents",
    joinPath: async (...parts: string[]) => parts.join("/"),
    kvGetItem: async () => "test-password",
  }),
}));
vi.mock("@readany/core/stores/sync-store", () => ({
  useSyncStore: { getState: () => ({ config: { type: "webdav" } }) },
}));
vi.mock("@readany/core/sync", () => ({ downloadBookFile: runtime.downloadBookFile }));
vi.mock("@readany/core/sync/sync-backend-factory", () => ({ createSyncBackend: () => ({}) }));
vi.mock("@readany/core/db/database", () => ({
  updateBook: runtime.updateBook,
  getBook: async () => runtime.book,
}));
vi.mock("@/stores/vector-model-store", () => ({
  useVectorModelStore: { getState: () => ({ autoVectorizeOnImport: false }) },
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: runtime.pick }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return runtime.platform;
    },
  },
}));
vi.mock("@react-navigation/native", async () => ({
  StackActions: (await import("@react-navigation/routers")).StackActions,
}));

import { openMobileBook } from "../library/open-mobile-book";

const t = ((_key: string, fallback: string) => fallback) as TFunction;
const navigate = vi.fn();
const options = {
  bookId: "cloud-book",
  navigation: { navigate, getState: () => ({ key: "root", routes: [] }) } as never,
  t,
  cfi: "epubcfi(/6/2)",
  highlight: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  runtime.platform = "android";
  runtime.book = {
    id: "cloud-book",
    filePath: "books/cloud.epub",
    syncStatus: "remote",
    meta: { title: "Cloud" },
  } as Book;
  runtime.loadBooks.mockResolvedValue(undefined);
  runtime.updateBook.mockResolvedValue(undefined);
  runtime.exists.mockResolvedValue(true);
});

describe("opening a remote book from search, reading tab or character profile", () => {
  it("returns to the same Reader and removes Notes through five note-open cycles", async () => {
    runtime.book = { ...runtime.book, syncStatus: "local" } as Book;
    const router = StackRouter({ initialRouteName: "Tabs" });
    const config = {
      routeNames: ["Tabs", "Reader", "FullScreenNotes"],
      routeParamList: {},
      routeGetIdList: {},
    };
    let state = router.getInitialState(config);
    const dispatch = (
      action:
        | ReturnType<typeof CommonActions.navigate>
        | ReturnType<typeof StackActions.popTo>
        | ReturnType<typeof StackActions.pop>,
    ) => {
      const next = router.getStateForAction(state, action, config);
      if (next?.stale === false) state = next;
    };
    const routedNavigation = {
      navigate: (name: string, params?: object) => dispatch(CommonActions.navigate(name, params)),
      dispatch,
      getState: () => state,
    };
    routedNavigation.navigate("Reader", { bookId: options.bookId });
    const initialReaderKey = state.routes.at(-1)?.key;
    for (let index = 0; index < 5; index++) {
      routedNavigation.navigate("FullScreenNotes", { bookId: options.bookId });
      await openMobileBook({ ...options, navigation: routedNavigation as never });
    }
    expect(state.routes.map((route) => route.name)).toEqual(["Tabs", "Reader"]);
    expect(state.routes.at(-1)?.key).toBe(initialReaderKey);
    expect(state.routes.at(-1)?.params).toEqual({
      bookId: options.bookId,
      cfi: options.cfi,
      highlight: true,
    });
    dispatch(StackActions.pop());
    expect(state.routes.map((route) => route.name)).toEqual(["Tabs"]);
  });

  it("does not replace a different book's Reader when the requested book is not open", async () => {
    runtime.book = { ...runtime.book, syncStatus: "local" } as Book;
    const router = StackRouter({ initialRouteName: "Tabs" });
    const config = {
      routeNames: ["Tabs", "Reader", "FullScreenNotes"],
      routeParamList: {},
      routeGetIdList: {},
    };
    let state = router.getInitialState(config);
    const dispatch = (
      action: ReturnType<typeof CommonActions.navigate> | ReturnType<typeof StackActions.popTo>,
    ) => {
      const next = router.getStateForAction(state, action, config);
      if (next?.stale === false) state = next;
    };
    const routedNavigation = {
      navigate: (name: string, params?: object) => dispatch(CommonActions.navigate(name, params)),
      dispatch,
      getState: () => state,
    };
    routedNavigation.navigate("Reader", { bookId: "another-book", cfi: "another-position" });
    const otherReader = state.routes.at(-1);
    routedNavigation.navigate("FullScreenNotes", { bookId: "another-book" });
    await openMobileBook({ ...options, navigation: routedNavigation as never });
    expect(state.routes.find((route) => route.key === otherReader?.key)).toEqual(otherReader);
    expect(state.routes.at(-1)?.params).toEqual({
      bookId: options.bookId,
      cfi: options.cfi,
      highlight: true,
    });
    expect(state.routes.at(-1)?.key).not.toBe(otherReader?.key);
  });

  it("pops to the exact matching Reader below an intervening different book", async () => {
    runtime.book = { ...runtime.book, syncStatus: "local" } as Book;
    const router = StackRouter({ initialRouteName: "Tabs" });
    const config = {
      routeNames: ["Tabs", "Reader", "FullScreenNotes"],
      routeParamList: {},
      routeGetIdList: {},
    };
    let state = router.getInitialState(config);
    const dispatch = (
      action: ReturnType<typeof CommonActions.navigate> | ReturnType<typeof StackActions.popTo>,
    ) => {
      const next = router.getStateForAction(state, action, config);
      if (next?.stale === false) state = next;
    };
    const routedNavigation = {
      navigate: (name: string, params?: object) => dispatch(CommonActions.navigate(name, params)),
      dispatch,
      getState: () => state,
    };
    routedNavigation.navigate("Reader", { bookId: options.bookId });
    const matchingKey = state.routes.at(-1)?.key;
    routedNavigation.navigate("FullScreenNotes", { bookId: options.bookId });
    routedNavigation.navigate("Reader", { bookId: "another-book" });
    const differentKey = state.routes.at(-1)?.key;
    routedNavigation.navigate("FullScreenNotes", { bookId: "another-book" });
    await openMobileBook({ ...options, navigation: routedNavigation as never });
    expect(state.routes.map((route) => route.name)).toEqual(["Tabs", "Reader"]);
    expect(state.routes.at(-1)?.key).toBe(matchingKey);
    expect(state.routes.at(-1)?.key).not.toBe(differentKey);
    expect(state.routes.at(-1)?.params).toEqual({
      bookId: options.bookId,
      cfi: options.cfi,
      highlight: true,
    });
  });

  it("updates the current matching Reader without adding a route", async () => {
    runtime.book = { ...runtime.book, syncStatus: "local" } as Book;
    const router = StackRouter({ initialRouteName: "Tabs" });
    const config = {
      routeNames: ["Tabs", "Reader", "FullScreenNotes"],
      routeParamList: {},
      routeGetIdList: {},
    };
    let state = router.getInitialState(config);
    const dispatch = (
      action: ReturnType<typeof CommonActions.navigate> | ReturnType<typeof StackActions.popTo>,
    ) => {
      const next = router.getStateForAction(state, action, config);
      if (next?.stale === false) state = next;
    };
    const routedNavigation = {
      navigate: (name: string, params?: object) => dispatch(CommonActions.navigate(name, params)),
      dispatch,
      getState: () => state,
    };
    routedNavigation.navigate("Reader", { bookId: options.bookId });
    const key = state.routes.at(-1)?.key;
    await openMobileBook({ ...options, navigation: routedNavigation as never });
    expect(state.routes.map((route) => route.name)).toEqual(["Tabs", "Reader"]);
    expect(state.routes.at(-1)?.key).toBe(key);
    expect(state.routes.at(-1)?.params).toEqual({
      bookId: options.bookId,
      cfi: options.cfi,
      highlight: true,
    });
  });

  it("opens a new Reader from global tabs when no Reader exists, preserving Tabs", async () => {
    runtime.book = { ...runtime.book, syncStatus: "local" } as Book;
    const router = StackRouter({ initialRouteName: "Tabs" });
    const config = {
      routeNames: ["Tabs", "Reader", "FullScreenNotes"],
      routeParamList: {},
      routeGetIdList: {},
    };
    let state = router.getInitialState(config);
    const dispatch = (
      action: ReturnType<typeof CommonActions.navigate> | ReturnType<typeof StackActions.popTo>,
    ) => {
      const next = router.getStateForAction(state, action, config);
      if (next?.stale === false) state = next;
    };
    const routedNavigation = {
      navigate: (name: string, params?: object) => dispatch(CommonActions.navigate(name, params)),
      dispatch,
      getState: () => state,
    };
    const tabsKey = state.routes[0].key;
    await openMobileBook({ ...options, navigation: routedNavigation as never });
    expect(state.routes.map((route) => route.name)).toEqual(["Tabs", "Reader"]);
    expect(state.routes[0].key).toBe(tabsKey);
  });

  it("lets iOS Files select a dynamic-type CBZ while preserving its book identity", async () => {
    runtime.platform = "ios";
    runtime.book = { ...runtime.book, format: "cbz", syncStatus: "local" } as Book;
    runtime.exists.mockResolvedValue(false);
    runtime.prompt.mockResolvedValue(true);
    runtime.pick.mockImplementation(async ({ type }: { type: string[] }) =>
      type.includes("*/*")
        ? { canceled: false, assets: [{ uri: "file:///picked/comic.cbz", name: "comic.cbz" }] }
        : { canceled: true },
    );
    runtime.inspect.mockResolvedValue(undefined);
    runtime.restore.mockResolvedValue(runtime.book);
    expect(await openMobileBook(options)).toBe(true);
    expect(runtime.restore).toHaveBeenCalledWith("cloud-book", {
      uri: "file:///picked/comic.cbz",
      name: "comic.cbz",
    });
  });
  it.each([
    ["comic.cbz", "cbz", "application/x-cbz"],
    ["story.fb2.zip", "fbz", "application/zip"],
  ])(
    "allows selecting a supported %s when restoring its missing local file",
    async (name, format, mime) => {
      runtime.book = { ...runtime.book, format, syncStatus: "local" } as Book;
      runtime.exists.mockResolvedValue(false);
      runtime.prompt.mockResolvedValue(true);
      runtime.pick.mockImplementation(async ({ type }: { type: string[] }) =>
        type.includes(mime)
          ? { canceled: false, assets: [{ uri: `file:///picked/${name}`, name }] }
          : { canceled: true },
      );
      runtime.inspect.mockResolvedValue(undefined);
      runtime.restore.mockResolvedValue(runtime.book);
      expect(await openMobileBook(options)).toBe(true);
      expect(runtime.restore).toHaveBeenCalledOnce();
    },
  );
  it("downloads before navigation, preserving the requested note location", async () => {
    let finish!: (outcome: string) => void;
    runtime.downloadBookFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opened = openMobileBook(options);
    await vi.waitFor(() =>
      expect(
        navigate.mock.calls.length + runtime.downloadBookFile.mock.calls.length,
      ).toBeGreaterThan(0),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(runtime.downloadBookFile).toHaveBeenCalledOnce();
    runtime.book = { ...runtime.book, syncStatus: "local" } as Book;
    finish("ok");
    expect(await opened).toBe(true);
    expect(navigate).toHaveBeenCalledWith("Reader", {
      bookId: "cloud-book",
      cfi: options.cfi,
      highlight: true,
    });
  });

  it("reports a missing cloud source and never opens an unreadable Reader", async () => {
    runtime.downloadBookFile.mockResolvedValue("not-found");
    expect(await openMobileBook(options)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(runtime.error).toHaveBeenCalledOnce();
  });

  it("allows a successful retry after a failed cloud transfer", async () => {
    runtime.downloadBookFile.mockResolvedValueOnce("not-found").mockImplementationOnce(async () => {
      runtime.book = { ...runtime.book, syncStatus: "local" } as Book;
      return "ok";
    });
    expect(await openMobileBook(options)).toBe(false);
    expect(await openMobileBook(options)).toBe(true);
    expect(runtime.downloadBookFile).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("shares a transfer requested concurrently by two entry points", async () => {
    let finish!: (outcome: string) => void;
    runtime.downloadBookFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = openMobileBook(options);
    const second = openMobileBook(options);
    await vi.waitFor(() => expect(runtime.downloadBookFile).toHaveBeenCalledOnce());
    runtime.book = { ...runtime.book, syncStatus: "local" } as Book;
    finish("ok");
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(runtime.downloadBookFile).toHaveBeenCalledOnce();
  });

  it("does not navigate if the reported successful download is still unavailable on disk", async () => {
    runtime.downloadBookFile.mockImplementationOnce(async () => {
      runtime.book = { ...runtime.book, syncStatus: "local" } as Book;
      return "ok";
    });
    runtime.exists.mockResolvedValue(false);
    expect(await openMobileBook(options)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(runtime.error).toHaveBeenCalledOnce();
  });

  it("shows a failed file replacement to the user instead of only logging it", async () => {
    runtime.book = { ...runtime.book, syncStatus: "local" } as Book;
    runtime.exists.mockResolvedValue(false);
    runtime.prompt.mockResolvedValue(true);
    runtime.pick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///picked.docx", name: "wrong.docx" }],
    });
    runtime.inspect.mockRejectedValue(new Error("Формат не поддерживается"));
    expect(await openMobileBook(options)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(runtime.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ description: "Формат не поддерживается" }),
    );
  });
});
