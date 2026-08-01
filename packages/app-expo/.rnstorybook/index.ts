import * as SplashScreen from "expo-splash-screen";
import { createElement, useEffect } from "react";
import { view } from "./storybook.requires";

const StorybookUIRoot = view.getStorybookUI({
  shouldPersistSelection: false,
  enableWebsockets: false,
});

export default function StorybookRoot() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return createElement(StorybookUIRoot);
}
