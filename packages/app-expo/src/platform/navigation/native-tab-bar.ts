import { NATIVE_TAB_BAR_HEIGHT as ANDROID_NATIVE_TAB_BAR_HEIGHT } from "../android/navigation/native-tab-bar";
import { NATIVE_TAB_BAR_HEIGHT as IOS_NATIVE_TAB_BAR_HEIGHT } from "../ios/navigation/native-tab-bar";

export function getNativeTabBarContentInset(platform: string, safeAreaBottom: number): number {
  if (platform === "android") return ANDROID_NATIVE_TAB_BAR_HEIGHT + safeAreaBottom;
  if (platform === "ios") return IOS_NATIVE_TAB_BAR_HEIGHT + safeAreaBottom;
  return 0;
}
