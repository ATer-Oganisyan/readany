export async function sha256BackendFile(path: string): Promise<string> {
  const { hash } = await import("@dr.pogodin/react-native-fs");
  return hash(path, "sha256");
}
