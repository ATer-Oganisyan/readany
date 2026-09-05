import { expect, it, vi } from "vitest";

vi.mock("@/components/ui/MishanaerIcon", () => ({ getStrokeIconImageSource: () => 1 }));
vi.mock("@expo/ui/jetpack-compose", () => ({
  Host: "ComposeHost",
  Icon: "ComposeIcon",
  IconButton: "ComposeIconButton",
}));

// Explicit Android import: the generic fallback already forwards the label.
import { ReaderTOCSheetCloseButton } from "../../screens/reader/ReaderTOCSheetCloseButton.android";

it.each(["Закрыть", "Close", "Schließen"])(
  "forwards the localized %s label to the Android icon without changing Close behavior",
  (accessibilityLabel) => {
    const onPress = vi.fn();
    const host = ReaderTOCSheetCloseButton({
      accessibilityLabel,
      colorScheme: "dark",
      foregroundColor: "white",
      onPress,
    });
    const button = host.props.children;
    const icon = button.props.children;
    expect(icon.props.contentDescription).toBe(accessibilityLabel);
    expect(host.props.style).toEqual({ width: 48, height: 48 });
    expect(button.props.colors.contentColor).toBe("white");
    button.props.onClick();
    expect(onPress).toHaveBeenCalledOnce();
  },
);
