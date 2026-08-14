import { getNativeTabBarContentInset } from "../../platform/navigation/native-tab-bar";

const BASE_LIBRARY_BOTTOM_PADDING = 24;

export function getLibraryScrollBottomPadding(platform: string, safeAreaBottom: number): number {
  return BASE_LIBRARY_BOTTOM_PADDING + getNativeTabBarContentInset(platform, safeAreaBottom);
}
