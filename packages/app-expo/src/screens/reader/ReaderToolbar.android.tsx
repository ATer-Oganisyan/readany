import { getFilledIconImageSource } from "@/components/ui/MishanaerIcon";
import {
  CircularProgressIndicator,
  HorizontalFloatingToolbar,
  Host,
  Icon,
  IconButton,
} from "@expo/ui/jetpack-compose";
import { size } from "@expo/ui/jetpack-compose/modifiers";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import type { ReaderToolbarProps } from "./ReaderToolbar.types";

export const TOOLBAR_HEIGHT = 64;

export function ReaderToolbar(props: ReaderToolbarProps) {
  const { t } = useTranslation();
  const speechLabel =
    props.speechState === "playing" ? t("tts.stopShort", "Стоп") : t("reader.listen", "Слушать");

  return (
    <View style={styles.container}>
      <Host matchContents colorScheme={props.isDark ? "dark" : "light"}>
        <HorizontalFloatingToolbar
          colors={{ toolbarContentColor: props.tintColor }}
          variant="standard"
        >
          <IconButton onClick={props.onSpeechPress} enabled={props.speechState !== "loading"}>
            {props.speechState === "loading" ? (
              <CircularProgressIndicator
                color={props.tintColor}
                strokeWidth={2}
                modifiers={[size(22, 22)]}
              />
            ) : (
              <Icon
                source={
                  props.speechState === "playing"
                    ? getFilledIconImageSource("stop")
                    : getFilledIconImageSource("headphones")
                }
                size={22}
                contentDescription={speechLabel}
              />
            )}
          </IconButton>
          <IconButton onClick={props.onCharactersPress}>
            <Icon
              source={getFilledIconImageSource("person")}
              size={22}
              contentDescription={t("narra.characters", "Персонажи")}
            />
          </IconButton>
        </HorizontalFloatingToolbar>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: TOOLBAR_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
});

export type { ReaderToolbarProps } from "./ReaderToolbar.types";
