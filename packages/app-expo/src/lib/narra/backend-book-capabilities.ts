/** Source formats accepted by the private-book analysis endpoint. */
export function supportsPrivateBookAnalysis(format: string): boolean {
  return ["epub", "fb2", "txt", "pdf"].includes(format);
}
