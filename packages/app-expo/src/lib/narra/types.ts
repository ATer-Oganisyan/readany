export type NarraGender = "male" | "female";
export type NarraEmotion =
  | "neutral"
  | "joy"
  | "tenderness"
  | "anger"
  | "fear"
  | "irony"
  | "sadness";

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
  unlockProgress: number;
  greeting?: string;
  isNarrator?: boolean;
  portraitUri?: string;
}

export interface NarraBookState {
  bookId: string;
  characters: NarraCharacter[];
  memories: Record<string, string>;
  summaries: Record<string, string>;
  chats: Record<string, NarraChatMessage[]>;
  analyzedAt?: number;
  analysisError?: string;
}

export interface NarraChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface NarraScenarioSegment {
  type: "narration" | "speech";
  characterId: string | null;
  emotion: NarraEmotion;
  text: string;
}
