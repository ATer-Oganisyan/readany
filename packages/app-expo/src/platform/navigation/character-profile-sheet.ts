import { getAndroidCharacterProfileSheetOptions } from "../android/navigation/character-profile-sheet";
import { getAndroidCharacterProfileSheetRuntimeOptions } from "../android/navigation/character-profile-sheet";
import { getIosCharacterProfileSheetOptions } from "../ios/navigation/character-profile-sheet";
import { getIosCharacterProfileSheetRuntimeOptions } from "../ios/navigation/character-profile-sheet";

export function getCharacterProfileSheetOptions(platform: string) {
  return platform === "android"
    ? getAndroidCharacterProfileSheetOptions()
    : getIosCharacterProfileSheetOptions();
}

export function getCharacterProfileSheetRuntimeOptions(
  platform: string,
  portraitReady: boolean,
  backgroundColor: string,
) {
  return platform === "android"
    ? getAndroidCharacterProfileSheetRuntimeOptions(backgroundColor)
    : getIosCharacterProfileSheetRuntimeOptions(portraitReady, backgroundColor);
}
