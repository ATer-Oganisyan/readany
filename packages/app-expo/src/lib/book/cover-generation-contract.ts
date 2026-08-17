export interface BookCoverGenerationInput {
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
  subjects?: string[];
}

/** Raw prompts remain only for resuming jobs created by an older APK. */
export type BookCoverGenerationRequest = { book: BookCoverGenerationInput } | { prompt: string };
