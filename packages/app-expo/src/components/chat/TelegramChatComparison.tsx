import { HeaderHeightContext } from "@react-navigation/elements";
import { NavigationContainer } from "@react-navigation/native";
import type { MessageV2, Part } from "@readany/core/types/message";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NarraChat } from "./NarraChat";

export type ComparisonTheme = "light" | "dark";
export type ComparisonLayer = "reference" | "implementation" | "overlay";

const FIXED_START = new Date("2026-07-30T09:00:00.000Z").getTime();
const REFERENCE_VIEWPORT_TOP_INSET = 62;

type PartPayload<T> = T extends Part ? Omit<T, "id" | "status" | "createdAt"> : never;

function part(id: string, value: PartPayload<Part>): Part {
  return {
    ...value,
    id,
    status: "completed",
    createdAt: FIXED_START,
  } as Part;
}

function demoMessage(
  id: string,
  role: MessageV2["role"],
  minute: number,
  parts: Part[],
): MessageV2 {
  return {
    id,
    threadId: "telegram-visual-reference",
    role,
    parts,
    createdAt: FIXED_START + minute * 60_000,
  };
}

export const TELEGRAM_COMPARISON_MESSAGES: MessageV2[] = [
  demoMessage("tg-1", "assistant", 0, [
    part("tg-1-text", { type: "text", text: "Привет! Я помогу разобраться с книгой." }),
  ]),
  demoMessage("tg-2", "assistant", 1, [
    part("tg-2-text", { type: "text", text: "Можно спросить о героях или идеях." }),
  ]),
  demoMessage("tg-3", "user", 3, [
    part("tg-3-text", { type: "text", text: "Сравни мотивы двух глав" }),
  ]),
  demoMessage("tg-4", "user", 4, [
    part("tg-4-quote", {
      type: "quote",
      text: "Человек становится тем, что он выбирает.",
      source: "Глава 4",
    }),
    part("tg-4-text", { type: "text", text: "Почему эта мысль важна?" }),
  ]),
  demoMessage("tg-5", "assistant", 6, [
    part("tg-5-text", {
      type: "text",
      text: "**Короткий ответ:** выбор связывает тему свободы с ответственностью. [Подробнее](https://example.com)",
    }),
  ]),
  demoMessage("tg-6", "assistant", 7, [
    part("tg-6-text", { type: "text", text: "Сопоставляю детали без спойлеров" }),
  ]),
];

export const TELEGRAM_TYPING_MESSAGES = TELEGRAM_COMPARISON_MESSAGES.slice(0, 4);

export function TelegramChatComparisonHarness({
  initialTheme = "light",
  initialLayer = "implementation",
}: {
  initialTheme?: ComparisonTheme;
  initialLayer?: ComparisonLayer;
}) {
  const [theme, setTheme] = useState<ComparisonTheme>(initialTheme);
  const [layer, setLayer] = useState<ComparisonLayer>(initialLayer);

  return (
    <View style={comparisonStyles.root}>
      <View style={comparisonStyles.controls}>
        <Segment
          options={[
            ["reference", "Эталон"],
            ["implementation", "Narra"],
            ["overlay", "50%"],
          ]}
          value={layer}
          onChange={setLayer}
        />
        <Segment
          options={[
            ["light", "Светлая"],
            ["dark", "Тёмная"],
          ]}
          value={theme}
          onChange={setTheme}
        />
      </View>
      <View style={comparisonStyles.viewport}>
        {layer !== "implementation" && <TelegramReferenceFrame theme={theme} />}
        {layer !== "reference" && (
          <View
            style={layer === "overlay" ? comparisonStyles.overlay : comparisonStyles.fill}
            pointerEvents={layer === "overlay" ? "none" : "auto"}
          >
            <NarraComparisonFrame theme={theme} />
          </View>
        )}
      </View>
      <Text style={comparisonStyles.caption}>
        Viewport: 402 × 874 pt (iPhone 17 Pro simulator, 3×). Overlay: Narra 50% поверх эталона.
      </Text>
    </View>
  );
}

function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={comparisonStyles.segment}>
      {options.map(([key, label]) => (
        <Pressable
          key={key}
          onPress={() => onChange(key)}
          style={[comparisonStyles.segmentButton, value === key && comparisonStyles.segmentActive]}
        >
          <Text
            style={[
              comparisonStyles.segmentText,
              value === key && comparisonStyles.segmentTextActive,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function NarraComparisonFrame({
  theme,
  typing = false,
  autoFocus = false,
  showContextMenu = false,
  streaming = true,
  initialText = "",
}: {
  theme: ComparisonTheme;
  typing?: boolean;
  autoFocus?: boolean;
  showContextMenu?: boolean;
  streaming?: boolean;
  initialText?: string;
}) {
  const messages = typing ? TELEGRAM_TYPING_MESSAGES : TELEGRAM_COMPARISON_MESSAGES;
  const [contextMenuReady, setContextMenuReady] = useState(false);

  useEffect(() => {
    if (!showContextMenu) {
      setContextMenuReady(false);
      return;
    }

    const timer = setTimeout(() => setContextMenuReady(true), 1_500);
    return () => clearTimeout(timer);
  }, [showContextMenu]);

  return (
    <GestureHandlerRootView style={comparisonStyles.fill}>
      <SafeAreaProvider>
        <NavigationContainer>
          <HeaderHeightContext.Provider value={REFERENCE_VIEWPORT_TOP_INSET}>
            <NarraChat
              messages={messages}
              colorScheme={theme}
              isStreaming={streaming}
              initialText={initialText}
              currentStep={streaming ? "responding" : "idle"}
              autoFocus={autoFocus}
              initialReactions={{ "tg-5": ["👍"] }}
              previewContextMenuMessageId={contextMenuReady ? "tg-5" : undefined}
              onSend={() => {}}
              onStop={() => {}}
            />
          </HeaderHeightContext.Provider>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export function TelegramReferenceFrame({ theme }: { theme: ComparisonTheme }) {
  const dark = theme === "dark";
  const palette = dark ? referenceDark : referenceLight;

  return (
    <View style={[referenceStyles.root, { backgroundColor: palette.background }]}>
      <ReferenceWallpaper dark={dark} />
      <View style={referenceStyles.list}>
        <View style={[referenceStyles.day, { backgroundColor: palette.day }]}>
          <Text style={referenceStyles.dayText}>Сегодня</Text>
        </View>

        <ReferenceRow incoming groupedBottom={false} palette={palette}>
          <Text style={[referenceStyles.message, { color: palette.incomingText }]}>
            Привет! Я помогу разобраться с книгой.
          </Text>
        </ReferenceRow>
        <ReferenceRow incoming groupedTop avatar palette={palette} time="12:01">
          <Text
            style={[
              referenceStyles.message,
              referenceStyles.messageWithMeta,
              { color: palette.incomingText },
            ]}
          >
            Можно спросить о героях или идеях.
          </Text>
        </ReferenceRow>

        <ReferenceRow outgoing groupedBottom={false} palette={palette}>
          <Text style={[referenceStyles.message, { color: palette.outgoingText }]}>
            Сравни мотивы двух глав
          </Text>
        </ReferenceRow>
        <ReferenceRow outgoing groupedTop palette={palette} time="12:04" ticks>
          <ReferenceReply palette={palette} />
          <Text
            style={[
              referenceStyles.message,
              referenceStyles.messageWithMeta,
              { color: palette.outgoingText },
            ]}
          >
            Почему эта мысль важна?
          </Text>
        </ReferenceRow>

        <ReferenceRow incoming groupedBottom={false} palette={palette}>
          <Text style={[referenceStyles.message, { color: palette.incomingText }]}>
            <Text style={referenceStyles.bold}>Короткий ответ: </Text>
            выбор связывает тему свободы с ответственностью.{" "}
            <Text style={[referenceStyles.link, { color: palette.accent }]}>Подробнее</Text>
          </Text>
          <View style={referenceStyles.reaction}>
            <Text style={referenceStyles.reactionText}>👍 1</Text>
          </View>
        </ReferenceRow>
        <ReferenceRow incoming groupedTop avatar palette={palette} time="12:07">
          <Text
            style={[
              referenceStyles.message,
              referenceStyles.messageWithMeta,
              { color: palette.incomingText },
            ]}
          >
            Сопоставляю детали без спойлеров<Text style={{ color: palette.incomingText }}>▌</Text>
          </Text>
        </ReferenceRow>
      </View>
      <ReferenceComposer palette={palette} streaming />
    </View>
  );
}

interface ReferencePalette {
  background: string;
  incoming: string;
  outgoing: string;
  incomingText: string;
  outgoingText: string;
  incomingMeta: string;
  outgoingMeta: string;
  ticks: string;
  accent: string;
  day: string;
  inputBar: string;
  input: string;
  inputBorder: string;
  separator: string;
  placeholder: string;
}

function ReferenceRow({
  incoming = false,
  outgoing = false,
  groupedTop = false,
  groupedBottom = true,
  avatar = false,
  palette,
  time,
  ticks = false,
  children,
}: {
  incoming?: boolean;
  outgoing?: boolean;
  groupedTop?: boolean;
  groupedBottom?: boolean;
  avatar?: boolean;
  palette: ReferencePalette;
  time?: string;
  ticks?: boolean;
  children: React.ReactNode;
}) {
  const position = outgoing ? "right" : "left";
  const background = incoming ? palette.incoming : palette.outgoing;
  return (
    <View
      style={[
        referenceStyles.row,
        position === "right" ? referenceStyles.rowRight : referenceStyles.rowLeft,
        groupedBottom ? referenceStyles.groupGap : referenceStyles.groupMerged,
      ]}
    >
      {incoming && (
        <View style={referenceStyles.avatarSlot}>
          {avatar && (
            <View style={referenceStyles.avatar}>
              <Text style={referenceStyles.avatarText}>NA</Text>
            </View>
          )}
        </View>
      )}
      <View
        style={[
          referenceStyles.bubble,
          { backgroundColor: background },
          incoming && referenceStyles.bubbleIncoming,
          position === "left" && groupedTop && referenceStyles.groupTopLeft,
          position === "left" && !groupedBottom && referenceStyles.groupBottomLeft,
          position === "right" && groupedTop && referenceStyles.groupTopRight,
          position === "right" && !groupedBottom && referenceStyles.groupBottomRight,
        ]}
      >
        {children}
        {time && (
          <View style={referenceStyles.meta}>
            <Text
              style={[
                referenceStyles.time,
                { color: incoming ? palette.incomingMeta : palette.outgoingMeta },
              ]}
            >
              {time}
            </Text>
            {ticks && <Text style={[referenceStyles.ticks, { color: palette.ticks }]}>✓✓</Text>}
          </View>
        )}
        {groupedBottom && (
          <View style={[referenceStyles.tail, position === "right" && referenceStyles.tailRight]}>
            <View
              style={[
                referenceStyles.tailBubble,
                position === "right"
                  ? referenceStyles.tailBubbleRight
                  : referenceStyles.tailBubbleLeft,
                { backgroundColor: background },
              ]}
            />
            <View
              style={[
                referenceStyles.tailCutout,
                position === "right"
                  ? referenceStyles.tailCutoutRight
                  : referenceStyles.tailCutoutLeft,
                { backgroundColor: palette.background },
              ]}
            />
          </View>
        )}
      </View>
    </View>
  );
}

function ReferenceReply({ palette }: { palette: ReferencePalette }) {
  return (
    <View style={[referenceStyles.reply, { borderLeftColor: palette.ticks }]}>
      <Text style={[referenceStyles.replyTitle, { color: palette.ticks }]}>Глава 4</Text>
      <Text style={[referenceStyles.replyText, { color: palette.outgoingText }]} numberOfLines={2}>
        Человек становится тем, что он выбирает.
      </Text>
    </View>
  );
}

function ReferenceComposer({
  palette,
  streaming = false,
}: {
  palette: ReferencePalette;
  streaming?: boolean;
}) {
  return (
    <View
      style={[
        referenceStyles.composer,
        { backgroundColor: palette.inputBar, borderTopColor: palette.separator },
      ]}
    >
      <View
        style={[
          referenceStyles.field,
          { backgroundColor: palette.input, borderColor: palette.inputBorder },
        ]}
      >
        <Text style={[referenceStyles.placeholder, { color: palette.placeholder }]}>Сообщение</Text>
        <Text style={[referenceStyles.paperclip, { color: palette.incomingMeta }]}>⌕</Text>
      </View>
      <View style={referenceStyles.micSlot}>
        {streaming ? (
          <View style={[referenceStyles.stop, { backgroundColor: palette.accent }]}>
            <View style={referenceStyles.stopGlyph} />
          </View>
        ) : (
          <View style={[referenceStyles.mic, { borderColor: palette.incomingMeta }]} />
        )}
      </View>
    </View>
  );
}

const motifs = [
  ["8%", "9%", "12deg"],
  ["48%", "5%", "-14deg"],
  ["76%", "19%", "20deg"],
  ["17%", "35%", "-9deg"],
  ["65%", "45%", "11deg"],
  ["5%", "64%", "17deg"],
  ["44%", "72%", "-16deg"],
  ["80%", "84%", "8deg"],
] as const;

function ReferenceWallpaper({ dark }: { dark: boolean }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {motifs.map(([left, top, rotate]) => (
        <View
          key={`${left}-${top}`}
          style={[
            referenceStyles.motif,
            {
              left,
              top,
              borderColor: dark ? "rgba(255,255,255,.045)" : "rgba(76,101,105,.10)",
              transform: [{ rotate }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const referenceLight = {
  background: "#DDE5E4",
  incoming: "#FFFFFF",
  outgoing: "#E1FFC7",
  incomingText: "#000000",
  outgoingText: "#000000",
  incomingMeta: "rgba(82,82,82,.60)",
  outgoingMeta: "rgba(0,140,9,.80)",
  ticks: "#00A700",
  accent: "#0088FF",
  day: "rgba(116,131,145,.45)",
  inputBar: "#FFFFFF",
  input: "rgba(255,255,255,.8)",
  inputBorder: "rgba(0,0,0,.1)",
  separator: "#BEC2C6",
  placeholder: "rgba(0,0,0,.4)",
} as const;

const referenceDark: ReferencePalette = {
  background: "#000000",
  incoming: "rgba(29,29,29,.90)",
  outgoing: "#0088FF",
  incomingText: "#FFFFFF",
  outgoingText: "#FFFFFF",
  incomingMeta: "rgba(255,255,255,.50)",
  outgoingMeta: "rgba(255,255,255,.70)",
  ticks: "#FFFFFF",
  accent: "#61BCF9",
  day: "rgba(0,0,0,.20)",
  inputBar: "#000000",
  input: "rgba(36,36,36,.95)",
  inputBorder: "rgba(255,255,255,.1)",
  separator: "rgba(84,84,88,.55)",
  placeholder: "rgba(255,255,255,.48)",
};

const comparisonStyles = StyleSheet.create({
  root: {
    flex: 1,
    margin: -24,
    backgroundColor: "#111",
  },
  controls: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    padding: 8,
    backgroundColor: "#171717",
  },
  segment: {
    flexDirection: "row",
    padding: 2,
    borderRadius: 9,
    backgroundColor: "#303030",
  },
  segmentButton: {
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: 9,
    borderRadius: 7,
  },
  segmentActive: {
    backgroundColor: "#666",
  },
  segmentText: {
    color: "#bbb",
    fontSize: 11,
  },
  segmentTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  viewport: {
    flex: 1,
    overflow: "hidden",
  },
  fill: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.5,
  },
  caption: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: "#aaa",
    backgroundColor: "#171717",
    fontSize: 10,
    textAlign: "center",
  },
});

const referenceStyles = StyleSheet.create({
  root: {
    flex: 1,
  },
  list: {
    flex: 1,
    justifyContent: "flex-end",
    paddingBottom: 8,
  },
  day: {
    alignSelf: "center",
    height: 28,
    justifyContent: "center",
    paddingHorizontal: 10,
    marginBottom: 8,
    borderRadius: 14,
  },
  dayText: {
    color: "#fff",
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginHorizontal: 3,
  },
  rowLeft: {
    justifyContent: "flex-start",
  },
  rowRight: {
    justifyContent: "flex-end",
  },
  groupGap: {
    marginBottom: 2.333,
  },
  groupMerged: {
    marginBottom: 0,
  },
  avatarSlot: {
    width: 34,
    height: 34,
    marginRight: 4,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3CA5EC",
  },
  avatarText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "400",
  },
  bubble: {
    maxWidth: "85%",
    minWidth: 40,
    minHeight: 35,
    justifyContent: "center",
    paddingHorizontal: 11,
    paddingTop: 6.333,
    paddingBottom: 5.667,
    borderRadius: 16,
  },
  bubbleIncoming: {
    maxWidth: "76%",
  },
  groupTopLeft: { borderTopLeftRadius: 8 },
  groupBottomLeft: { borderBottomLeftRadius: 8 },
  groupTopRight: { borderTopRightRadius: 8 },
  groupBottomRight: { borderBottomRightRadius: 8 },
  message: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "400",
  },
  messageWithMeta: {
    paddingRight: 48,
  },
  bold: {
    fontWeight: "700",
  },
  link: {
    textDecorationLine: "underline",
  },
  meta: {
    position: "absolute",
    right: 7,
    bottom: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  time: {
    fontSize: 11,
    lineHeight: 13,
  },
  ticks: {
    marginLeft: -2,
    fontSize: 10,
    letterSpacing: -4,
  },
  tail: {
    position: "absolute",
    left: -6,
    bottom: 0,
    width: 12,
    height: 15,
  },
  tailRight: {
    left: undefined,
    right: -6,
  },
  tailBubble: {
    position: "absolute",
    bottom: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  tailBubbleLeft: {
    right: -5,
  },
  tailBubbleRight: {
    left: -5,
  },
  tailCutout: {
    position: "absolute",
    bottom: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  tailCutoutLeft: {
    left: -7,
  },
  tailCutoutRight: {
    right: -7,
  },
  reply: {
    marginBottom: 3,
    paddingLeft: 8,
    paddingVertical: 3,
    borderLeftWidth: 3,
  },
  replyTitle: {
    fontSize: 14,
    lineHeight: 17,
    fontWeight: "600",
  },
  replyText: {
    fontSize: 14,
    lineHeight: 17,
  },
  reaction: {
    alignSelf: "flex-start",
    minHeight: 30,
    justifyContent: "center",
    marginTop: 3,
    paddingHorizontal: 7,
    borderRadius: 15,
    backgroundColor: "rgba(0,136,255,.15)",
  },
  reactionText: {
    fontSize: 13,
  },
  composer: {
    minHeight: 45,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 3,
    paddingBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  field: {
    flex: 1,
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  placeholder: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
  },
  paperclip: {
    fontSize: 24,
    transform: [{ rotate: "-30deg" }],
  },
  micSlot: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  mic: {
    width: 10,
    height: 18,
    borderWidth: 2,
    borderRadius: 6,
  },
  stop: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  stopGlyph: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: "#fff",
  },
  motif: {
    position: "absolute",
    width: 34,
    height: 24,
    borderWidth: 1.2,
    borderRadius: 7,
  },
});
