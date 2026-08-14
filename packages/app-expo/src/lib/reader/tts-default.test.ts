import { DEFAULT_TTS_CONFIG, normalizeTTSConfig } from "@readany/core/tts";
import { describe, expect, it } from "vitest";
import { migrateLegacyNarraEdgeVoice } from "./tts-default";

describe("Narra reader TTS default", () => {
  it("migrates the old Chinese default profile to the Russian default", () => {
    const legacy = normalizeTTSConfig({
      ...DEFAULT_TTS_CONFIG,
      edgeVoice: "zh-CN-XiaoxiaoNeural",
      activeProfileId: "edge-default",
      profiles: [
        {
          id: "edge-default",
          name: "Edge TTS",
          provider: "edge",
          voice: "zh-CN-XiaoxiaoNeural",
        },
      ],
    });

    const migrated = migrateLegacyNarraEdgeVoice(legacy);

    expect(migrated.edgeVoice).toBe("ru-RU-SvetlanaNeural");
    expect(migrated.profiles[0]?.voice).toBe("ru-RU-SvetlanaNeural");
  });

  it("does not replace a Chinese voice in a user-created profile", () => {
    const custom = normalizeTTSConfig({
      ...DEFAULT_TTS_CONFIG,
      edgeVoice: "zh-CN-XiaoxiaoNeural",
      activeProfileId: "edge-chinese",
      profiles: [
        {
          id: "edge-chinese",
          name: "Chinese",
          provider: "edge",
          voice: "zh-CN-XiaoxiaoNeural",
        },
      ],
    });

    expect(migrateLegacyNarraEdgeVoice(custom)).toEqual(custom);
  });
});
