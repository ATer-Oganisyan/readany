import { getStrokeIconImageSource } from "@/components/ui/MishanaerIcon";
import { NativeContextMenuButton } from "@/components/ui/NativeContextMenuButton";
import { darkColors, lightColors } from "@/styles/ThemeContext";
import { Host, Icon, IconButton } from "@expo/ui/jetpack-compose";
import { size } from "@expo/ui/jetpack-compose/modifiers";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import type { ReaderTopBarProps } from "./ReaderTopBar.types";

export const READER_TOP_BAR_HEIGHT = 50;
const CONTROL_SIZE = 44;

export function ReaderTopBar(props: ReaderTopBarProps) {
  const { t } = useTranslation();
  const colors = props.isDark ? darkColors : lightColors;
  return (
    <View style={styles.container}>
      <Host matchContents colorScheme={props.isDark ? "dark" : "light"}>
        <IconButton
          onClick={props.onClosePress}
          colors={{ containerColor: colors.elevation1, contentColor: props.tintColor }}
          modifiers={[size(CONTROL_SIZE, CONTROL_SIZE)]}
        >
          <Icon
            source={getStrokeIconImageSource("x")}
            size={22}
            tint={props.tintColor}
            contentDescription={t("common.close", "Закрыть")}
          />
        </IconButton>
      </Host>
      {props.showTrailingActions !== false && (
        <NativeContextMenuButton
          accessibilityLabel={t("reader.bookActions", "Действия с книгой")}
          items={[
            {
              key: "appearance",
              label: t("narra.readerAppearance", "Оформление"),
              icon: "text-t",
              onPress: props.onAppearancePress,
            },
            ...props.actions,
          ]}
          onOpenChange={props.onActionsOpenChange}
          color={props.tintColor}
          containerColor={colors.elevation1}
          size={CONTROL_SIZE}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: READER_TOP_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
});

export type { ReaderTopBarProps } from "./ReaderTopBar.types";
