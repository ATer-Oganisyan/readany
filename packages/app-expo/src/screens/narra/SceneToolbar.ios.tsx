import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import { View } from "react-native";
import type { SceneToolbarProps } from "./SceneToolbar.types";

export const SCENE_TOOLBAR_HEIGHT = 50;

interface NativeSceneToolbarProps extends SceneToolbarProps {
  speechLabel: string;
  regenerateLabel: string;
  style: { width: "100%"; height: number };
}

const NativeSceneToolbar = requireNativeView(
  "ReadAnyNativeControls",
  "ReadAnySceneToolbar",
) as ComponentType<NativeSceneToolbarProps>;

export function SceneToolbar(props: SceneToolbarProps) {
  return (
    <View style={{ width: "100%", height: SCENE_TOOLBAR_HEIGHT }}>
      <NativeSceneToolbar
        {...props}
        speechLabel="Озвучить по ролям"
        regenerateLabel="Нарисовать заново"
        style={{ width: "100%", height: SCENE_TOOLBAR_HEIGHT }}
      />
    </View>
  );
}

export type { SceneToolbarProps } from "./SceneToolbar.types";
