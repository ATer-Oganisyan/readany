import { HostedMishanaerIcon } from "@/components/ui/HostedMishanaerIcon";
import { Button, HStack, Host, Label, Menu } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  clipShape,
  controlSize,
  disabled,
  frame,
  glassEffect,
  labelStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet, View } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";
import type { ReaderTopBarProps } from "./ReaderTopBar.types";

const BAR_HEIGHT = 50;
const CONTROL_SIZE = 44;
const HORIZONTAL_INSET = 20;

/**
 * Верхняя панель ридера — пара к ReaderToolbar: те же нативные кнопки в стекле.
 * Оформление и действия делят одну капсулу, как сгруппировала бы их нативная
 * шапка; показ и скрытие панели задаёт контейнер в ReaderScreen, поэтому обе
 * панели гаснут одним движением.
 */
export function ReaderTopBar(props: ReaderTopBarProps) {
  const { t } = useTranslation();
  const supportsGlass = Number.parseInt(String(Platform.Version), 10) >= 26;
  const closeLabel = t("common.close", "Закрыть");
  const appearanceLabel = t("narra.readerAppearance", "Оформление");
  const actionsLabel = t("reader.bookActions", "Действия с книгой");

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

  return (
    <View style={styles.container}>
      <Host matchContents colorScheme={props.isDark ? "dark" : "light"} style={styles.host}>
        <HStack modifiers={capsule}>
          <Button onPress={props.onClosePress} modifiers={control(closeLabel)}>
            <HostedMishanaerIcon systemName="xmark" size={20} color={props.tintColor} />
          </Button>
        </HStack>
      </Host>

      <Host matchContents colorScheme={props.isDark ? "dark" : "light"} style={styles.host}>
        <HStack spacing={0} modifiers={capsule}>
          <Button onPress={props.onAppearancePress} modifiers={control(appearanceLabel)}>
            <HostedMishanaerIcon name="text-t" size={20} color={props.tintColor} />
          </Button>
          <Menu
            label={<HostedMishanaerIcon systemName="ellipsis" size={20} color={props.tintColor} />}
            modifiers={[...control(actionsLabel), labelStyle("iconOnly" as const)]}
            testID={actionsLabel}
          >
            {props.actions.map((action) => (
              <Button
                key={action.key}
                role={action.destructive ? "destructive" : "default"}
                onPress={action.onPress}
                modifiers={action.disabled ? [disabled(true)] : undefined}
              >
                {/* systemImage, а не React-иконка: нативное меню не отображает
                    вложенные RN-вьюхи — с ними пункты остаются без картинок. */}
                <Label title={action.label} systemImage={action.sfSymbol as SFSymbol | undefined} />
              </Button>
            ))}
          </Menu>
        </HStack>
      </Host>
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
});

export { BAR_HEIGHT as READER_TOP_BAR_HEIGHT };
export type { ReaderTopBarProps } from "./ReaderTopBar.types";
