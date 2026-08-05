import type { ProfileTabStackParamList } from "@/navigation/TabNavigator";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { NotesView } from "./NotesView";

type Props = NativeStackScreenProps<ProfileTabStackParamList, "ProfileNotes">;

/**
 * NotesScreen — the notes list, now hosted inside the Profile tab stack.
 */
export function NotesScreen({ route }: Props) {
  return <NotesView initialBookId={route?.params?.bookId} edges={[]} showBackButton={true} />;
}
