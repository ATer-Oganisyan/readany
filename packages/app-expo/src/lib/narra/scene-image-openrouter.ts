import * as Crypto from "expo-crypto";
import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { useLibraryStore, useNarraStore } from "@/stores";
import type { NarraGenreAnalysis } from "./genre-analysis";
import { persistSceneImageBase64, trackNarraMediaJob } from "./media";
import { passportDescription } from "./scene-prompt";
import type { NarraCharacter } from "./types";

interface SceneJobPayload {
  job_id?: string;
  status?: "queued" | "running" | "retry_wait" | "completed" | "failed";
  poll_after_ms?: number;
  image?: string;
  mime_type?: string;
  error?: string;
}

function bookMeta(bookId: string): {
  title: string;
  author?: string;
  analyzedGenre?: NarraGenreAnalysis;
} {
  const book = useLibraryStore.getState().books.find((item) => item.id === bookId);
  return {
    title: book?.meta.title ?? "Без названия",
    author: book?.meta.author || undefined,
    analyzedGenre: useNarraStore.getState().books[bookId]?.genre,
  };
}

function previousSceneExcerpts(bookId: string, currentExcerpt: string): string[] {
  const scenes = useNarraStore.getState().books[bookId]?.scenes;
  if (!scenes) return [];
  return Object.values(scenes)
    .filter((scene) => scene.imageUri && scene.excerpt && scene.excerpt !== currentExcerpt)
    .sort((left, right) => right.generatedAt - left.generatedAt)
    .slice(0, 2)
    .map((scene) => scene.excerpt);
}

async function jobPayload(response: Response): Promise<SceneJobPayload> {
  const payload = (await response.json().catch(() => null)) as SceneJobPayload | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || `Scene generation failed (${response.status})`);
  }
  return payload;
}

function pollDelay(value: number | undefined): number {
  return Math.min(30_000, Math.max(1_000, Number(value) || 3_000));
}

async function generateSceneThroughGateway(
  bookId: string,
  chapter: string,
  excerpt: string,
  characters: NarraCharacter[],
): Promise<string> {
  const meta = bookMeta(bookId);
  let payload = await jobPayload(
    await narraGatewayRequest("/v2/media/scene/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: Crypto.randomUUID(),
        book_title: meta.title,
        book_author: meta.author || "",
        chapter,
        excerpt,
        characters: characters.slice(0, 16).map((character) => ({
          name: character.name,
          full_name: character.fullName,
          role: character.role,
          gender: character.gender,
          appearance: character.appearancePrompt || passportDescription(character),
        })),
        previous_excerpts: previousSceneExcerpts(bookId, excerpt),
      }),
    }),
  );
  if (!payload.job_id) throw new Error("Backend did not return a scene job id");
  const jobId = payload.job_id;
  while (!["completed", "failed"].includes(payload.status || "")) {
    await new Promise((resolve) => setTimeout(resolve, pollDelay(payload.poll_after_ms)));
    payload = await jobPayload(
      await narraGatewayRequest(`/v2/media/scene/jobs/${encodeURIComponent(jobId)}`),
    );
  }
  if (payload.status !== "completed" || !payload.image) {
    throw new Error(payload.error || "Scene generation failed");
  }
  const extension = payload.mime_type === "image/jpeg" ? "jpg" : "png";
  const result = await persistSceneImageBase64(bookId, payload.image, extension);
  await narraGatewayRequest(
    `/v2/media/scene/jobs/${encodeURIComponent(jobId)}/ack`,
    { method: "POST" },
  ).catch(() => undefined);
  return result;
}

/** Credentials, prompt policy, durable queue and provider routing are server-owned. */
export function generateNarraSceneImage(
  bookId: string,
  chapter: string,
  excerpt: string,
  characters: NarraCharacter[],
): Promise<string> {
  return trackNarraMediaJob(
    "image",
    "user",
    () => generateSceneThroughGateway(bookId, chapter, excerpt, characters),
    { provider: "kandinsky", model: "k6-image-t2i" },
  );
}
