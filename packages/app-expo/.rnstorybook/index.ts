import {
  interfaceFontAssets,
  sansCondensedFontAssets,
  serifCondensedFontAssets,
  serifTextFontAssets,
} from "@deslop/primitives/native";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { createElement, useEffect } from "react";
import { view } from "./storybook.requires";

const StorybookUIRoot = view.getStorybookUI({
  shouldPersistSelection: false,
  enableWebsockets: false,
  initialSelection: process.env.EXPO_PUBLIC_STORYBOOK_INITIAL_STORY,
});

export default function StorybookRoot() {
  const [fontsLoaded, fontError] = useFonts({
    ...interfaceFontAssets,
    "SB Sans Text Cond": sansCondensedFontAssets.regular,
    "SB Sans Text Cond Bold": sansCondensedFontAssets.bold,
    "SB Serif Condensed": serifCondensedFontAssets.regular,
    "SB Serif Text": serifTextFontAssets.regular,
    "SB Serif Text Bold": serifTextFontAssets.bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontError, fontsLoaded]);

  if (!fontsLoaded && !fontError) return null;

  return createElement(StorybookUIRoot);
}
