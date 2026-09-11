import { useReaderCopy } from "@/hooks/use-reader-copy";
import { toast } from "@/lib/notifications";
import * as Clipboard from "expo-clipboard";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";

vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/styles/theme", () => ({ useColors: () => ({ primary60: "#123456" }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("../../../assets/icons/copy-2.svg", () => ({ default: "CopyIcon" }));

it("copies the complete Android selection and reports success only after writing, without rewriting iOS copies", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let copy!: ReturnType<typeof useReaderCopy>;
  function Harness() {
    copy = useReaderCopy();
    return null;
  }
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(<Harness />);
  });
  try {
    let finish!: (value: boolean) => void;
    vi.mocked(Clipboard.setStringAsync).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const text = "  Первый абзац.\n\nВторой абзац.  ";
    const pending = copy(text, false);
    expect(Clipboard.setStringAsync).toHaveBeenCalledExactlyOnceWith(text);
    expect(toast.success).not.toHaveBeenCalled();
    finish(true);
    await pending;
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      "Скопировано",
      expect.objectContaining({ icon: expect.anything() }),
    );
    await copy(text, true);
    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(2);
    vi.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error("clipboard unavailable"));
    await copy(text, false);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Ошибка");
    expect(toast.success).toHaveBeenCalledTimes(2);
    await copy("", false);
    await copy(null as unknown as string, false);
    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledTimes(2);
  } finally {
    act(() => tree.unmount());
  }
});
