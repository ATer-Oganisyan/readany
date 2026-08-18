import type { ComponentType } from "react";
import type { ImageSourcePropType } from "react-native";
import type { SvgProps } from "react-native-svg";
import {
  filledIconComponents,
  filledIconImages,
  strokeIconComponents,
  strokeIconImages,
} from "./mishanaer-icons.generated";

export type MishanaerIconName = keyof typeof strokeIconComponents;
export type MishanaerFilledIconName = keyof typeof filledIconComponents;
export const mishanaerIconNames = Object.keys(strokeIconComponents) as MishanaerIconName[];

export interface MishanaerIconProps {
  name: MishanaerIconName;
  variant?: "stroke" | "filled";
  size?: number;
  color?: string;
  style?: SvgProps["style"];
}

export type MishanaerIconComponent = ComponentType<Omit<MishanaerIconProps, "name">>;

export function MishanaerIcon({
  name,
  variant = "stroke",
  size = 24,
  color = "#8e8e93",
  style,
}: MishanaerIconProps) {
  const FilledComponent =
    variant === "filled" ? filledIconComponents[name as MishanaerFilledIconName] : undefined;
  const Component = FilledComponent ?? strokeIconComponents[name];

  return (
    <Component
      accessibilityElementsHidden
      importantForAccessibility="no"
      width={size}
      height={size}
      color={color}
      style={style}
    />
  );
}

export function getStrokeIconImageSource(name: MishanaerIconName): ImageSourcePropType {
  const images = strokeIconImages as Partial<Record<MishanaerIconName, ImageSourcePropType>>;
  return images[name] ?? strokeIconImages["question-circle"];
}

export function getFilledIconImageSource(name: MishanaerFilledIconName): ImageSourcePropType {
  return filledIconImages[name];
}

const SYSTEM_ICON_NAMES = {
  "airpods.max": "headphones",
  "arrow.clockwise": "repeat",
  "arrow.down.doc": "arrow-to-line-down",
  "arrow.up": "arrow-up",
  bell: "bell",
  "book.closed": "book",
  bookmark: "bookmark",
  "bookmark.slash": "bookmark",
  "books.vertical": "books-spines",
  "character.bubble": "translate",
  "chart.bar.xaxis": "chart-bar",
  checkmark: "check",
  "chevron.backward": "chevron-left",
  "chevron.forward": "chevron-right",
  diamond: "diamond",
  "doc.on.clipboard": "clipboard",
  "doc.text": "file-txt",
  ellipsis: "dots-three-horizontal",
  eye: "eye",
  folder: "folder",
  gearshape: "gear",
  globe: "globe",
  headphones: "headphones",
  hourglass: "pulse-circle",
  icloud: "cloud",
  "info.circle": "question-circle",
  link: "link",
  "list.bullet": "list",
  "message.fill": "chat-bubble",
  "note.text": "note",
  paintpalette: "palette",
  "person.2": "people",
  "person.crop.circle": "person",
  "play.fill": "play",
  plus: "plus",
  "rectangle.and.hand.point.up.left": "hand",
  "speaker.wave.2.fill": "volume-2",
  sparkles: "sparkles",
  "square.and.arrow.up": "share-network",
  "square.and.pencil": "pencil-square",
  "square.grid.2x2": "grid-2x2",
  "stop.fill": "stop",
  "text.magnifyingglass": "book-open-magnifying-glass",
  textformat: "text-t",
  "textformat.size": "text-t",
  trash: "bin",
  xmark: "x",
} as const satisfies Record<string, MishanaerIconName>;

export function resolveSystemIconName(name: string): MishanaerIconName {
  return SYSTEM_ICON_NAMES[name as keyof typeof SYSTEM_ICON_NAMES] ?? "question-circle";
}
