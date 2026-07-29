import { interfaceFontFamily } from "@deslop/primitives/native";
import type { ComponentType } from "react";
import { type StyleProp, Text, type TextStyle } from "react-native";

export interface MaterialIconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
  style?: StyleProp<TextStyle>;
}

export type MaterialIconComponent = ComponentType<MaterialIconProps>;

export function MaterialIcon({
  name,
  size = 24,
  color = "#8e8e93",
  style,
}: MaterialIconProps & { name: string }) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        {
          width: size,
          height: size,
          color,
          fontFamily: interfaceFontFamily.materialSymbols,
          fontSize: size,
          lineHeight: size,
          textAlign: "center",
          includeFontPadding: false,
        },
        style,
      ]}
    >
      {name}
    </Text>
  );
}

function material(name: string): MaterialIconComponent {
  const Icon = (props: MaterialIconProps) => <MaterialIcon name={name} {...props} />;
  Icon.displayName = `MaterialIcon(${name})`;
  return Icon;
}

// Only symbols from the curated @deslop/primitives catalog are used here.
export const BookOpenIcon = material("book_2");
export const MessageSquareIcon = material("chat");
export const BotIcon = material("chat_add_on");
export const NotebookPenIcon = material("edit");
export const UserIcon = material("person");
export const PlusIcon = material("add");
export const SearchIcon = material("search");
export const XIcon = material("close");
export const SortAscIcon = material("filter_list");
export const ChevronRightIcon = material("chevron_right");
export const ChevronLeftIcon = material("chevron_left");
export const FolderIcon = material("folder");
export const FolderPlusIcon = material("folder_open");
export const FolderInputIcon = material("file_open");
export const MoreVerticalIcon = material("more_vert");
export const BrainIcon = material("analytics");
export const ScrollTextIcon = material("description");
export const LightbulbIcon = material("bolt");
export const HistoryIcon = material("event");
export const MessageCirclePlusIcon = material("chat_add_on");
export const PaletteIcon = material("palette");
export const RefreshCwIcon = material("refresh");
export const CloudIcon = material("cloud");
export const DatabaseIcon = material("database");
export const Volume2Icon = material("notifications");
export const HeadphonesIcon = material("mic");
export const PlayIcon = material("play_arrow");
export const PauseIcon = material("remove");
export const SquareIcon = material("cancel");
export const RotateCcwIcon = material("refresh");
export const SkipBackIcon = material("arrow_back");
export const SkipForwardIcon = material("arrow_forward");
export const LanguagesIcon = material("language");
export const CpuIcon = material("terminal");
export const PuzzleIcon = material("apps");
export const HelpCircleIcon = material("help");
export const InfoIcon = material("info");
export const BarChart3Icon = material("bar_chart");
export const ClockIcon = material("schedule");
export const FlameIcon = material("bolt");
export const TrendingUpIcon = material("analytics");
export const TrophyIcon = material("workspace_premium");
export const SwordsIcon = material("shield");
export const HighlighterIcon = material("edit");
export const CopyIcon = material("content_copy");
export const Trash2Icon = material("delete");
export const TagIcon = material("badge");
export const CheckCheckIcon = material("verified");
export const SparklesIcon = material("star");
export const LoaderIcon = material("progress_activity");
export const Loader2Icon = material("progress_activity");
export const WrenchIcon = material("tune");
export const HashIcon = material("badge");
export const ArrowDownAZIcon = material("arrow_downward");
export const ArrowUpAZIcon = material("arrow_upward");
export const SendIcon = material("send");
export const StopCircleIcon = material("cancel");
export const OctagonXIcon = material("error");
export const ChevronDownIcon = material("expand_more");
export const ChevronUpIcon = material("expand_less");
export const CheckIcon = material("check");
export const EditIcon = material("edit");
export const ShareIcon = material("share");
export const FilterIcon = material("filter_list");
export const CalendarIcon = material("calendar_month");
export const SwitchIcon = material("currency_exchange");
export const SunIcon = material("light_mode");
export const MoonIcon = material("dark_mode");
export const Undo2Icon = material("arrow_back");
export const Redo2Icon = material("arrow_forward");
export const EyeIcon = material("visibility");
export const EyeOffIcon = material("visibility_off");
export const BoldIcon = material("description");
export const BoldIcon2 = BoldIcon;
export const ItalicIcon = material("description");
export const StrikethroughIcon = material("remove");
export const ListIcon = material("menu");
export const ListOrderedIcon = material("menu");
export const CodeIcon = material("terminal");
export const Link2Icon = material("link");
export const QuoteIcon = material("chat");
export const MinusIcon = material("remove");
export const Heading1Icon = material("description");
export const Heading2Icon = material("description");
export const Heading3Icon = material("description");
export const LibraryIcon = material("book_2");
export const ZoomIn = material("add_circle");
export const ZoomOut = material("remove_circle");
export const Download = material("download");
export const RotateCcw = material("refresh");
export const Maximize2 = material("open_in_new");
export const Minimize2 = material("dock_to_left");
export const BookmarkIcon = material("favorite");
export const BookmarkFilledIcon = material("favorite");
export const TypeIcon = material("description");
export const LinkIcon = material("link");
export const GlobeIcon = material("public");
export const LayersIcon = material("grid_view");
export const FolderMinusIcon = material("archive");

// Compatibility names for screens that previously imported Lucide directly.
export const AlertCircle = material("warning");
export const Bot = BotIcon;
export const Bug = material("error");
export const Check = CheckIcon;
export const CheckCircle2 = material("check_circle");
export const ChevronLeft = ChevronLeftIcon;
export const Cloud = CloudIcon;
export const Coffee = material("light_mode");
export const ExternalLink = material("open_in_new");
export const Eye = EyeIcon;
export const EyeOff = EyeOffIcon;
export const Languages = LanguagesIcon;
export const Lightbulb = LightbulbIcon;
export const MessageCircle = material("chat");
export const MessageSquare = MessageSquareIcon;
export const Moon = MoonIcon;
export const Plus = PlusIcon;
export const Scan = material("qr_code_scanner");
export const Search = SearchIcon;
export const Star = material("star");
export const Sun = SunIcon;
export const Trash2 = Trash2Icon;
export const X = XIcon;
