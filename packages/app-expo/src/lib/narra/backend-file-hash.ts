import { hash } from "@dr.pogodin/react-native-fs";

export async function sha256BackendFile(path: string): Promise<string> {
  return hash(path, "sha256");
}
