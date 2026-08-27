/** Reject empty/invalid results before writing a file or acknowledging the job. */
export function validateCoverImage(bytes: Uint8Array, mimeType: string): void {
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const valid =
    mimeType === "image/png"
      ? starts([137, 80, 78, 71, 13, 10, 26, 10]) && bytes.length > 24
      : mimeType === "image/jpeg"
        ? starts([255, 216, 255]) && bytes.length > 4
        : mimeType === "image/webp"
          ? starts([82, 73, 70, 70]) &&
            bytes.length > 12 &&
            String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
          : false;
  if (!valid) throw new Error("Invalid or empty cover image");
}
