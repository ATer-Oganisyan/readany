import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import * as FileSystem from "expo-file-system/legacy";
import { narraMediaTargetPath, trackNarraMediaJob } from "./media";

export type NarraImageOrientation = "landscape" | "portrait";

export interface AnimateNarraImageInput {
  imageUri: string;
  motionPrompt: string;
  cacheKey: string;
  orientation?: NarraImageOrientation;
}

async function animateNarraImageRequest(input: AnimateNarraImageInput): Promise<string> {
  const image = await FileSystem.readAsStringAsync(input.imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const response = await narraGatewayRequest("/v2/media/portrait-animation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      image,
      query: input.motionPrompt,
      quality: "lite",
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    video?: string;
    provider?: string;
    error?: string;
  } | null;
  if (!response.ok || !payload?.video) {
    throw new Error(payload?.error || `Video generation failed (${response.status})`);
  }
  const path = await narraMediaTargetPath(`${input.cacheKey}-${Date.now()}`, "mp4");
  await FileSystem.writeAsStringAsync(path, payload.video, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

/** Provider credentials and fallback policy are fully server-owned. */
export function animateNarraImage(input: AnimateNarraImageInput): Promise<string> {
  return trackNarraMediaJob("video", "user", () => animateNarraImageRequest(input), {
    provider: "video",
    model: "server-selected",
  });
}
