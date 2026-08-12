import { NativeButton } from "@/components/ui/NativeButton";
import { spacing } from "@/styles/theme";
import { StyleSheet, View } from "react-native";
import type { ReaderCharacterActionsProps } from "./ReaderCharacterActions.types";

export function ReaderCharacterActions(props: ReaderCharacterActionsProps) {
  return (
    <View style={styles.row}>
      <NativeButton
        label={props.talkLabel}
        icon="chat"
        size="large"
        onPress={props.onTalk}
        style={styles.button}
      />
      <NativeButton
        label={props.voiceState === "playing" ? props.stopLabel : props.listenLabel}
        icon="play"
        loading={props.voiceState === "loading"}
        disabled={!props.canSample}
        variant="secondary"
        size="large"
        onPress={props.onToggleVoice}
        style={styles.button}
      />
      {props.showRegenerate ? (
        <NativeButton
          label={props.regenerateLabel}
          icon="refresh"
          loading={props.regenerating}
          disabled={props.regenerating}
          variant="secondary"
          size="large"
          onPress={props.onRegenerate}
          style={styles.button}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: "100%", flexDirection: "row", gap: spacing.sm },
  button: { flex: 1 },
});
