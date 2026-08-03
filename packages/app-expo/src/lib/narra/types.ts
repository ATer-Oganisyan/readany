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

export interface NarraBookState {
  bookId: string;
  characters: NarraCharacter[];
  memories: Record<string, string>;
  chats: Record<string, NarraChatMessage[]>;
  scenes: Record<string, NarraSceneImage>;
  analyzedAt?: number;
  analysisError?: string;
}
