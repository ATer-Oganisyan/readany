import { HostedMishanaerIcon } from "@/components/ui/HostedMishanaerIcon";
import type { MishanaerIconName } from "@/components/ui/MishanaerIcon";
import { Button, HStack, Host } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  clipShape,
  controlSize,
  frame,
  glassEffect,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { type NativeSyntheticEvent, Platform, StyleSheet, View } from "react-native";
import type { ReaderTopBarProps } from "./ReaderTopBar.types";

const BAR_HEIGHT = 50;
const CONTROL_SIZE = 44;
const HORIZONTAL_INSET = 20;

type NativeMenuItem = {
  key: string;
  label: string;
  icon: MishanaerIconName;
  disabled: boolean;
  destructive: boolean;
};

type NativeMenuButtonProps = {
  items: NativeMenuItem[];
  tintColor: string;
  accessibilityLabel: string;
  isDark: boolean;
  onItemPress: (event: NativeSyntheticEvent<{ key: string }>) => void;
  style: { width: number; height: number };
};

const NativeMenuButton = requireNativeView(
  "ReadAnyNativeControls",
  "ReadAnyMenuButton",
) as ComponentType<NativeMenuButtonProps>;

/**
 * Верхняя панель ридера — пара к ReaderToolbar: те же нативные кнопки в стекле.
 * Показ и скрытие панели задаёт контейнер в ReaderScreen, поэтому верхняя и
 * нижняя панели гаснут одним движением.
 */
export function ReaderTopBar(props: ReaderTopBarProps) {
  const { t } = useTranslation();
  const supportsGlass = Number.parseInt(String(Platform.Version), 10) >= 26;
  const closeLabel = t("common.close", "Закрыть");
  const appearanceLabel = t("narra.readerAppearance", "Оформление");
  const actionsLabel = t("reader.bookActions", "Действия с книгой");
  const nativeMenuItems: NativeMenuItem[] = [
    {
      key: "appearance",
      label: appearanceLabel,
      icon: "text-t",
      disabled: false,
      destructive: false,
    },
    ...props.actions.map((action) => ({
      key: action.key,
      label: action.label,
      icon: action.icon ?? "question-circle",
      disabled: action.disabled ?? false,
      destructive: action.destructive ?? false,
    })),
  ];

  const capsule = supportsGlass
    ? [
        glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }),
        clipShape("capsule" as const),
      ]
    : [clipShape("capsule" as const)];

  const control = (label: string) => [
    buttonStyle("plain" as const),
    controlSize("extraLarge" as const),
    frame({ width: CONTROL_SIZE, height: CONTROL_SIZE }),
    tint(props.tintColor),
    accessibilityLabel(label),
  ];

  // Мишень задаётся размером содержимого кнопки: у SwiftUI зона нажатия равна
  // отрисованному содержимому, а рамка снаружи её не расширяет. Без этого
  // нажимался только глиф в 20 точек, и мимо крестика уходила половина тапов.
  const icon = (props2: { name?: MishanaerIconName; systemName?: string }) => (
    <HostedMishanaerIcon
      name={props2.name}
      systemName={props2.systemName}
      size={20}
      box={CONTROL_SIZE}
      color={props.tintColor}
    />
  );

  return (
    <View style={styles.container}>
      <Host matchContents colorScheme={props.isDark ? "dark" : "light"} style={styles.host}>
        <HStack modifiers={capsule}>
          <Button onPress={props.onClosePress} modifiers={control(closeLabel)}>
            {icon({ systemName: "xmark" })}
          </Button>
        </HStack>
      </Host>

      <NativeMenuButton
        items={nativeMenuItems}
        tintColor={props.tintColor}
        accessibilityLabel={actionsLabel}
        isDark={props.isDark}
        onItemPress={(event) => {
          const key = event.nativeEvent.key;
          if (key === "appearance") {
            props.onAppearancePress();
            return;
          }
          props.actions.find((action) => action.key === key)?.onPress();
        }}
        style={styles.nativeMenu}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: HORIZONTAL_INSET,
  },
  host: { height: CONTROL_SIZE },
  nativeMenu: { width: CONTROL_SIZE, height: CONTROL_SIZE },
});

export { BAR_HEIGHT as READER_TOP_BAR_HEIGHT };
export type { ReaderTopBarProps } from "./ReaderTopBar.types";
