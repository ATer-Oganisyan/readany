import type { ReadSettings } from "@readany/core/types";
import type { ReactNode } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel.android";

vi.mock("@/components/settings/NativeSettingsPicker.android", () => ({
  NativeSettingsPicker: "NativeSettingsPicker",
}));

vi.mock("react-native", () => ({ useWindowDimensions: () => ({ height: 900 }) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24 }),
}));
vi.mock("@/styles/theme", () => ({
  bodyTypography: {},
  radius: { lg: 16 },
  spacing: { sm: 8, xxl: 24 },
  useTheme: () => ({ colors: { primary: "orange" }, isDark: false }),
}));
vi.mock("@/stores", () => ({
  useNarraStore: (selector: (s: object) => unknown) =>
    selector({ sceneSuggestionInterval: 4, setSceneSuggestionInterval: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock("@expo/ui/jetpack-compose", () => ({
  Box: "Box",
  Column: "Column",
  Surface: "Surface",
  HorizontalDivider: "HorizontalDivider",
  VerticalDivider: "VerticalDivider",
  Shape: { RoundedCorner: vi.fn() },
  Host: "Host",
  LazyColumn: "LazyColumn",
  ModalBottomSheet: "ModalBottomSheet",
  Row: "Row",
  RNHostView: "RNHostView",
  Switch: "Switch",
  Text: "Text",
  TextButton: "TextButton",
  SingleChoiceSegmentedButtonRow: "SingleChoiceSegmentedButtonRow",
  ListItem: Object.assign(({ children }: { children: ReactNode }) => children, {
    HeadlineContent: "HeadlineContent",
    TrailingContent: "TrailingContent",
  }),
  SegmentedButton: Object.assign(({ children }: { children: ReactNode }) => children, {
    Label: "Label",
  }),
}));
vi.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  fillMaxWidth: vi.fn(),
  fillMaxHeight: vi.fn(),
  height: vi.fn(),
  padding: vi.fn(),
  weight: vi.fn(),
  width: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("updates reader values with the iOS steps and disables controls at their limits", async () => {
  const update = vi.fn();
  const close = vi.fn();
  let renderer!: ReturnType<typeof create>;
  const settings = {
    fontSize: 12,
    lineHeight: 1.6,
    paragraphSpacing: 16,
    pageMargin: 48,
    viewMode: "paginated",
  } as ReadSettings;
  await act(async () => {
    renderer = create(
      <ReaderSettingsPanel
        visible
        readSettings={settings}
        onClose={close}
        onUpdateSetting={update}
      />,
    );
  });
  const buttons = renderer.root.findAllByType("TextButton" as never);
  expect(buttons[0].props.enabled).toBe(false);
  expect(buttons[7].props.enabled).toBe(false);
  await act(async () => {
    buttons[3].props.onClick();
  });
  expect(update).toHaveBeenCalledWith("lineHeight", 1.7);
  await act(async () => {
    renderer.root.findByType("ModalBottomSheet" as never).props.onDismissRequest();
  });
  expect(close).toHaveBeenCalledOnce();
  const pickers = renderer.root.findAllByType("NativeSettingsPicker" as never);
  expect(pickers).toHaveLength(2);
  await act(async () => {
    pickers[0].props.onValueChange("scroll");
  });
  expect(update).toHaveBeenCalledWith("viewMode", "scroll");
  await act(async () => {
    renderer.unmount();
  });
});
