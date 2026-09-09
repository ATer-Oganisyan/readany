// Android rendering of the original expo-ui-examples mini-player layout.
// iOS uses the source's SwiftUI implementation directly.
import { type MishanaerIconName, getStrokeIconImageSource } from "@/components/ui/MishanaerIcon";
import { useTheme } from "@/styles/ThemeContext";
import {
  Column,
  DropdownMenu,
  DropdownMenuItem,
  Host,
  Icon,
  IconButton,
  Row,
  Slider,
  Text,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, padding, size, weight } from "@expo/ui/jetpack-compose/modifiers";
import { useTranslation } from "react-i18next";
import {
  AUDIOBOOK_SPEEDS,
  AUDIOBOOK_TIMER_MINUTES,
  type AudiobookPlayerContentProps,
} from "./audiobook-player-content.types";

function PlayerIcon({
  name,
  label,
  size: iconSize = 24,
}: { name: MishanaerIconName; label: string; size?: number }) {
  return (
    <Icon source={getStrokeIconImageSource(name)} size={iconSize} contentDescription={label} />
  );
}

export function AudiobookPlayerContent(props: AudiobookPlayerContentProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { player } = props;
  const menu = (
    <DropdownMenu.Items>
      {AUDIOBOOK_SPEEDS.map((rate) => (
        <DropdownMenuItem key={rate} onClick={() => props.onRateChange(rate)}>
          <DropdownMenuItem.Text>
            <Text>{t("tts.speedValue", { value: rate })}</Text>
          </DropdownMenuItem.Text>
        </DropdownMenuItem>
      ))}
      {AUDIOBOOK_TIMER_MINUTES.map((minutes) => (
        <DropdownMenuItem key={minutes} onClick={() => props.onSetTimer(minutes)}>
          <DropdownMenuItem.Text>
            <Text>{t("tts.sleepTimerPresetShort", { minutes })}</Text>
          </DropdownMenuItem.Text>
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem onClick={props.onCustomTimer}>
        <DropdownMenuItem.Text>
          <Text>{t("tts.customTimer")}</Text>
        </DropdownMenuItem.Text>
      </DropdownMenuItem>
      {props.timerActive && (
        <DropdownMenuItem onClick={props.onClearTimer}>
          <DropdownMenuItem.Text>
            <Text>{t("tts.sleepTimerCancel")}</Text>
          </DropdownMenuItem.Text>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={props.onStop}>
        <DropdownMenuItem.Text>
          <Text>{t("tts.stop")}</Text>
        </DropdownMenuItem.Text>
      </DropdownMenuItem>
    </DropdownMenu.Items>
  );
  return (
    <Host colorScheme={isDark ? "dark" : "light"} style={{ flex: 1 }}>
      <Column horizontalAlignment="center" modifiers={[fillMaxWidth(), padding(27, 24, 27, 21)]}>
        <Row
          horizontalArrangement="spaceBetween"
          verticalAlignment="center"
          modifiers={[fillMaxWidth(), padding(6, 10, 6, 0)]}
        >
          <Column modifiers={[weight(1)]}>
            <Text
              color={colors.foreground}
              maxLines={1}
              style={{ fontSize: 22, fontWeight: "bold" }}
            >
              {props.title}
            </Text>
            <Text color={colors.mutedForeground} maxLines={1} style={{ fontSize: 22 }}>
              {props.chapter}
            </Text>
          </Column>
          <DropdownMenu>
            <DropdownMenu.Trigger>
              <PlayerIcon name="dots-three-horizontal" label={t("tts.playerOptions")} />
            </DropdownMenu.Trigger>
            {menu}
          </DropdownMenu>
        </Row>
        <Column modifiers={[fillMaxWidth(), padding(6, 20, 6, 0)]}>
          <Slider
            value={player.hasDuration ? player.localPosition : 0}
            min={0}
            max={Math.max(player.duration, 1)}
            enabled={player.hasDuration}
            onValueChange={(value) => {
              player.beginSeeking();
              player.setPosition(value);
            }}
            onValueChangeFinished={player.commitSeeking}
            modifiers={[fillMaxWidth()]}
          />
          <Row horizontalArrangement="spaceBetween" modifiers={[fillMaxWidth()]}>
            <Text color={colors.mutedForeground} style={{ fontSize: 13, fontFamily: "monospace" }}>
              {player.progressLabel}
            </Text>
            <Text color={colors.mutedForeground} style={{ fontSize: 13, fontFamily: "monospace" }}>
              {player.durationLabel}
            </Text>
          </Row>
        </Column>
        <Row
          horizontalArrangement={{ spacedBy: 32 }}
          verticalAlignment="center"
          modifiers={[padding(0, 28, 0, 0)]}
        >
          <IconButton
            onClick={player.seekBackward}
            enabled={player.hasDuration}
            modifiers={[size(48, 48)]}
          >
            <PlayerIcon name="skip-backward" label={t("tts.backward15")} size={34} />
          </IconButton>
          <IconButton onClick={player.togglePlayback} modifiers={[size(64, 64)]}>
            <PlayerIcon
              name={player.isPlaying || player.isLoading ? "pause" : "play"}
              size={50}
              label={t(player.isPlaying || player.isLoading ? "tts.pause" : "tts.playShort")}
            />
          </IconButton>
          <IconButton
            onClick={player.seekForward}
            enabled={player.hasDuration}
            modifiers={[size(48, 48)]}
          >
            <PlayerIcon name="skip-forward" label={t("tts.forward15")} size={34} />
          </IconButton>
        </Row>
        <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(0, 16, 0, 0)]}>
          <PlayerIcon name="volume-2" size={13} label={t("tts.volume")} />
          <Slider
            value={props.volume}
            min={0}
            max={1}
            onValueChange={props.onVolumeChange}
            modifiers={[weight(1)]}
          />
          <PlayerIcon name="volume-2" size={18} label={t("tts.volume")} />
        </Row>
        <Row
          horizontalArrangement="spaceBetween"
          modifiers={[fillMaxWidth(), padding(6, 12, 6, 0)]}
        >
          <IconButton onClick={props.onRead}>
            <PlayerIcon name="chat-bubble" size={21} label={t("tts.returnToBook")} />
          </IconButton>
          <PlayerIcon name="volume-2" size={21} label={t("tts.volume")} />
          <DropdownMenu>
            <DropdownMenu.Trigger>
              <PlayerIcon name="list" size={21} label={t("tts.playerOptions")} />
            </DropdownMenu.Trigger>
            {menu}
          </DropdownMenu>
        </Row>
      </Column>
    </Host>
  );
}
