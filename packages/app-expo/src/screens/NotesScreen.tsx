import type { TabParamList } from "@/navigation/TabNavigator";
import type { NativeBottomTabScreenProps } from "@react-navigation/bottom-tabs/unstable";
import { NotesView } from "./NotesView";

type Props = NativeBottomTabScreenProps<TabParamList, "Notes">;

/**
 * NotesScreen — Tab version of the notes list.
 */
export function NotesScreen({ route }: Props) {
  return <NotesView initialBookId={route?.params?.bookId} edges={[]} showBackButton={true} />;
}
