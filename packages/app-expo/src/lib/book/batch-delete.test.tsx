import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ru from "../../../../core/src/i18n/locales/ru/library.json";
import en from "../../../../core/src/i18n/locales/en/library.json";
const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  translate: vi.fn(),
}));
vi.mock("react-native", () => ({ Alert: { alert: mocks.alert } }));
vi.mock("@/lib/notifications", () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
import { useBatchBookDelete } from "@/hooks/use-batch-book-delete";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
let current: ReturnType<typeof useBatchBookDelete>;
const remove = vi.fn();
const settled = vi.fn();
let selected: string[];
function Harness() {
  const [ids, setIds] = useState(["a", "b"]);
  selected = ids;
  current = useBatchBookDelete(remove, (failed) => {
    setIds(failed);
    settled(failed);
  });
  return null;
}
function translateWith(locale: typeof ru) {
  mocks.translate.mockImplementation((key: string, args: Record<string, unknown> = {}) => {
    const dictionary = locale.library as Record<string, string>;
    return (dictionary[key.replace("library.", "")] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) =>
      String(args[name]),
    );
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  translateWith(ru);
  remove.mockReset().mockResolvedValue(undefined);
  await act(async () => {
    tree = create(<Harness />);
  });
});
afterEach(async () => {
  await act(async () => {
    tree.unmount();
  });
});
const confirm = () => mocks.alert.mock.lastCall![2][1].onPress();
it("recovers from a throwing native confirmation bridge and allows retry", async () => {
  mocks.alert.mockImplementationOnce(() => {
    throw Error("native bridge unavailable");
  });
  await act(async () => {
    expect(() => current.requestDelete(["a"])).not.toThrow();
  });
  expect(remove).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith(ru.library.batchDeleteFailed);
  await act(async () => {
    current.requestDelete(["a"]);
    await confirm();
  });
  expect(remove).toHaveBeenCalledExactlyOnceWith("a");
});
it.each([{ failed: [] }, { failed: ["b"] }, { failed: ["a", "b"] }])(
  "retains only failures $failed and reports counts",
  async ({ failed }) => {
    remove.mockImplementation(async (id: string) => {
      if (failed.includes(id)) throw Error("disk");
    });
    await act(async () => {
      current.requestDelete(["a", "b", "a"]);
      await confirm();
    });
    expect(remove.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
    expect(settled).toHaveBeenCalledWith(failed);
    expect(selected).toEqual(failed);
    expect(failed.length ? mocks.error : mocks.success).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        description: `Удалено: ${2 - failed.length} · Не удалено: ${failed.length}`,
      }),
    );
    expect(current.isDeleting).toBe(false);
  },
);
it("coalesces prompts and confirms, then permits retry", async () => {
  let release!: () => void;
  remove.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => {
    current.requestDelete(["a"]);
    current.requestDelete(["a"]);
  });
  expect(mocks.alert).toHaveBeenCalledOnce();
  let pending!: Promise<void>;
  await act(async () => {
    pending = confirm();
    await confirm();
  });
  expect(remove).toHaveBeenCalledOnce();
  await act(async () => {
    release();
    await pending;
    current.requestDelete(["b"]);
    await confirm();
  });
  expect(remove).toHaveBeenCalledTimes(2);
});
it("does not start stale confirmation after unmount", async () => {
  await act(async () => {
    current.requestDelete(["a"]);
  });
  await act(async () => {
    tree.unmount();
  });
  await act(async () => {
    await confirm();
  });
  expect(remove).not.toHaveBeenCalled();
});
it.each([false, true])(
  "lets active deletion settle without late feedback after unmount (failure %s)",
  async (failure) => {
    let release!: () => void;
    remove.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          release = () => (failure ? reject(Error("disk")) : resolve());
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      current.requestDelete(["a", "b"]);
      pending = confirm();
    });
    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      release();
      await pending;
    });
    expect(remove.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
    expect(settled).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  },
);
it("retries only failed IDs after partial failure", async () => {
  remove.mockRejectedValueOnce(Error("disk"));
  await act(async () => {
    current.requestDelete(["a", "b"]);
    await confirm();
  });
  const remaining = settled.mock.lastCall![0];
  expect(remaining).toEqual(["a"]);
  await act(async () => {
    current.requestDelete(remaining);
    await confirm();
  });
  expect(remove.mock.calls.map(([id]) => id)).toEqual(["a", "b", "a"]);
  expect(settled.mock.lastCall![0]).toEqual([]);
});
it("cancel or native dismissal releases the prompt lock without deleting", async () => {
  await act(async () => {
    current.requestDelete(["a"]);
    mocks.alert.mock.lastCall![2][0].onPress();
    current.requestDelete(["b"]);
  });
  expect(mocks.alert).toHaveBeenCalledTimes(2);
  await act(async () => {
    mocks.alert.mock.lastCall![3].onDismiss();
    current.requestDelete(["c"]);
  });
  expect(mocks.alert).toHaveBeenCalledTimes(3);
  expect(remove).not.toHaveBeenCalled();
});
it.each([ru, en])("provides localized counts and retry guidance", async (locale) => {
  translateWith(locale);
  remove.mockRejectedValueOnce(Error("disk"));
  await act(async () => {
    current.requestDelete(["a", "b"]);
    await confirm();
  });
  expect(mocks.error).toHaveBeenCalledWith(
    locale.library.batchDeleteFailed,
    expect.objectContaining({
      description: locale.library.batchDeleteResult
        .replace("{{deleted}}", "1")
        .replace("{{failed}}", "1"),
    }),
  );
});
