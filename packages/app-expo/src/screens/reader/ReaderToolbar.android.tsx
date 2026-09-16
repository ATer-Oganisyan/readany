import { getStrokeIconImageSource } from "@/components/ui/MishanaerIcon";
import { AUDIOBOOK_PLAYER_ENABLED } from "@/lib/audiobook-player";
import { darkColors, lightColors } from "@/styles/ThemeContext";
import { bodyTypography } from "@/styles/theme";
import {
  Button,
  CircularProgressIndicator,
  Host,
  Icon,
  Row,
  Spacer,
  Text,
} from "@expo/ui/jetpack-compose";
import { height, size } from "@expo/ui/jetpack-compose/modifiers";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import type { ReaderToolbarProps } from "./ReaderToolbar.types";

// Mirrors the iOS toolbar and the Android top bar: two labelled pills on the
// same surface as the round close/menu controls, at the same edge padding.
export const TOOLBAR_HEIGHT = 50;
const CONTROL_SIZE = 44;
const ICON_SIZE = 20;

function ToolbarPill({
  icon,
  label,
  loading,
  tintColor,
  containerColor,
  isDark,
  onPress,
}: {
  icon: "headphones" | "stop" | "person";
  label: string;
  loading?: boolean;
  tintColor: string;
  containerColor: string;
  isDark: boolean;
  onPress: () => void;
}) {
  return (
    <Host matchContents colorScheme={isDark ? "dark" : "light"}>
      <Button
        onClick={onPress}
        enabled={!loading}
        colors={{
          containerColor,
          contentColor: tintColor,
          disabledContainerColor: containerColor,
          disabledContentColor: tintColor,
        }}
        contentPadding={{ start: 16, end: 20, top: 0, bottom: 0 }}
        modifiers={[height(CONTROL_SIZE)]}
      >
        <Row verticalAlignment="center">
          {loading ? (
            <CircularProgressIndicator
              color={tintColor}
              strokeWidth={2}
              modifiers={[size(ICON_SIZE, ICON_SIZE)]}
            />
          ) : (
            <Icon
              source={getStrokeIconImageSource(icon)}
              size={ICON_SIZE}
              tint={tintColor}
              contentDescription={label}
            />
          )}
          <Spacer modifiers={[size(8, 1)]} />
          <Text maxLines={1} color={tintColor} style={bodyTypography}>
            {label}
          </Text>
        </Row>
      </Button>
    </Host>
  );
}

export function ReaderToolbar(props: ReaderToolbarProps) {
  const { t } = useTranslation();
  const colors = props.isDark ? darkColors : lightColors;
  const speechActive = !AUDIOBOOK_PLAYER_ENABLED && props.speechState === "playing";
  const speechLoading = !AUDIOBOOK_PLAYER_ENABLED && props.speechState === "loading";
  const speechLabel = AUDIOBOOK_PLAYER_ENABLED
    ? t("reader.audio", "Аудио")
    : speechActive
      ? t("tts.stopShort", "Стоп")
      : t("reader.listen", "Слушать");

  return (
    <View style={styles.container}>
      <ToolbarPill
        icon={speechActive ? "stop" : "headphones"}
        label={speechLabel}
        loading={speechLoading}
        tintColor={props.tintColor}
        containerColor={colors.elevation1}
        isDark={props.isDark}
        onPress={props.onSpeechPress}
      />
      <ToolbarPill
        icon="person"
        label={t("narra.characters", "Персонажи")}
        tintColor={props.tintColor}
        containerColor={colors.elevation1}
        isDark={props.isDark}
        onPress={props.onCharactersPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: TOOLBAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
});

export type { ReaderToolbarProps } from "./ReaderToolbar.types";
