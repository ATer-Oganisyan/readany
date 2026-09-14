import { prepareSheetZoom } from "@/components/navigation/SystemSheetZoomSource";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

// Only serialize the brief native preparation, never the animation itself.
let preparing = false;
export async function openBookDetails(
  navigation: NativeStackNavigationProp<RootStackParamList>,
  params: RootStackParamList["BookDetails"],
  sourceId?: string,
): Promise<boolean> {
  if (preparing || !navigation.isFocused()) return false;
  preparing = true;
  let preparedSource: string | undefined;
  try {
    if (sourceId) {
      try {
        await prepareSheetZoom(sourceId);
        preparedSource = sourceId;
      } catch (error) {
        console.warn("[BookDetails] Zoom unavailable:", error);
      }
    }
    if (!navigation.isFocused()) {
      if (preparedSource) await prepareSheetZoom("").catch(() => {});
      return false;
    }
    navigation.navigate("BookDetails", {
      ...params,
      ...(preparedSource ? { sourceId: preparedSource } : {}),
    });
    return true;
  } catch (error) {
    if (preparedSource) await prepareSheetZoom("").catch(() => {});
    console.warn("[BookDetails] Failed to present sheet:", error);
    return false;
  } finally {
    preparing = false;
  }
}
