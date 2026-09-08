import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useColors } from "@/styles/theme";
import { type RouteProp, useRoute } from "@react-navigation/native";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NotesView } from "./NotesView";

export function FullScreenNotesScreen() {
  const colors = useColors();
  const route = useRoute<RouteProp<RootStackParamList, "FullScreenNotes">>();
  const { bookId } = route.params;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["bottom"]}
    >
      <NotesView initialBookId={bookId} showBackButton={false} edges={[]} hideDetailHeader />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
