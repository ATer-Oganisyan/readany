export type NarraGender = "male" | "female";

export interface NarraPassport {
  age: number;
  gender: NarraGender;
  build: string;
  hair: string;
  eyes: string;
  face: string;
  outfit: string;
}

export interface NarraCharacter {
  id: string;
  name: string;
  fullName: string;
  role: string;
  gender: NarraGender;
  voice: string;
  traits: string[];
  speechStyle: string;
  speechExamples: string[];
  appearancePrompt: string;
  passport?: NarraPassport;
  expression?: string;
  /** Fraction of the book (0…0.95) at which the character becomes available. */
  unlockProgress: number;
  greeting?: string;
  isNarrator?: boolean;
  portraitUri?: string;
  greetingAudioUri?: string;
  idleAnimationUri?: string;
  mediaSource?: "local" | "backend";
  mediaState?: "preparing" | "ready";
}

export interface NarraBackendBinding {
  resolution: "catalog" | "private" | "local_registration_required";
  bookEditionId?: string;
  contentSha256: string;
  generationStatus?: string;
  ready: boolean;
  sourceDownloadPath?: string;
  expiresAt?: string;
}

export interface NarraChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface NarraSceneImage {
  sourceKey: string;
  chapter: string;
  excerpt: string;
  imageUri: string;
  generatedAt: number;
}

export interface NarraSceneAudioSegment {
  type: "narration" | "speech";
  characterId: string | null;
  speaker: string;
  voice: string;
  text: string;
  audioUri?: string;
}

export interface NarraSceneAudio {
  sourceKey: string;
  segments: NarraSceneAudioSegment[];
  createdAt: number;
}

export interface NarraSummary {
  sourceKey: string;
  chapter: string;
  excerpt: string;
  text: string;
  generatedAt: number;
}

export interface NarraBookState {
  bookId: string;
  characters: NarraCharacter[];
  memories: Record<string, string>;
  chats: Record<string, NarraChatMessage[]>;
  scenes: Record<string, NarraSceneImage>;
  sceneAudios: Record<string, NarraSceneAudio>;
  summaries: Record<string, NarraSummary>;
  analyzedAt?: number;
  analysisError?: string;
  backendBinding?: NarraBackendBinding;
}
