import type { NotesTabStackParamList } from "@/navigation/TabNavigator";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { NotesView } from "./NotesView";

type Props = NativeStackScreenProps<NotesTabStackParamList, "NotesHome">;

/**
 * NotesScreen — Tab version of the notes list.
 */
export function NotesScreen({ route }: Props) {
  return <NotesView initialBookId={route?.params?.bookId} edges={[]} showBackButton={true} />;
}
