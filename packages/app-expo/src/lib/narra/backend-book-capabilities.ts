/** Client inputs supported by analysis; FBZ is unpacked to validated FB2 first. */
export function supportsPrivateBookAnalysis(format: string): boolean {
  return ["epub", "fb2", "fbz", "txt", "pdf"].includes(format);
}
