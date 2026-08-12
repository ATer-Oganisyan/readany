import { interfaceFontFamily } from "@deslop/primitives/native";
import {
  Column,
  HorizontalDivider,
  Host,
  ListItem,
  Shape,
  Surface,
  Text,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, padding } from "@expo/ui/jetpack-compose/modifiers";
import type { NativeCharacterDetailsCellsProps } from "./NativeCharacterDetailsCells.types";

const detailsShape = Shape.RoundedCorner({
  cornerRadii: { topStart: 20, topEnd: 20, bottomStart: 20, bottomEnd: 20 },
});

function DetailsRow({
  backgroundColor,
  label,
  primaryColor,
  secondaryColor,
  value,
}: {
  backgroundColor: string;
  label: string;
  primaryColor: string;
  secondaryColor: string;
  value: string;
}) {
  return (
    <ListItem colors={{ containerColor: backgroundColor, contentColor: primaryColor }}>
      <ListItem.OverlineContent>
        <Text
          color={secondaryColor}
          style={{ fontFamily: interfaceFontFamily.regular, fontSize: 13, lineHeight: 18 }}
        >
          {label}
        </Text>
      </ListItem.OverlineContent>
      <ListItem.HeadlineContent>
        <Text
          color={primaryColor}
          style={{ fontFamily: interfaceFontFamily.regular, fontSize: 16, lineHeight: 20 }}
        >
          {value}
        </Text>
      </ListItem.HeadlineContent>
    </ListItem>
  );
}

/** Один Expo-компонент: на Android рендерится нативными Compose ListItem. */
export function NativeCharacterDetailsCells({
  bio,
  bioLabel,
  cellBackgroundColor,
  character,
  characterLabel,
  isDark,
}: NativeCharacterDetailsCellsProps) {
  const primaryColor = isDark ? "rgba(255,255,255,0.96)" : "rgba(0,0,0,0.9)";
  const secondaryColor = isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)";

  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={isDark ? "dark" : "light"}
      style={{ width: "100%" }}
    >
      <Surface
        color={cellBackgroundColor}
        contentColor={primaryColor}
        shape={detailsShape}
        modifiers={[fillMaxWidth()]}
      >
        <Column modifiers={[fillMaxWidth()]}>
          <DetailsRow
            backgroundColor="transparent"
            label={bioLabel}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
            value={bio}
          />
          <HorizontalDivider
            color="rgba(255,255,255,0.2)"
            thickness={1}
            modifiers={[fillMaxWidth(), padding(16, 0, 16, 0)]}
          />
          <DetailsRow
            backgroundColor="transparent"
            label={characterLabel}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
            value={character}
          />
        </Column>
      </Surface>
    </Host>
  );
}

export type { NativeCharacterDetailsCellsProps } from "./NativeCharacterDetailsCells.types";
