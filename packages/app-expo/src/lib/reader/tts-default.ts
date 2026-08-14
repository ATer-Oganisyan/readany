import { DEFAULT_TTS_CONFIG, type TTSConfig } from "@readany/core/tts";

const LEGACY_EDGE_DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const DEFAULT_EDGE_PROFILE_ID = "edge-default";

/** Migrates only the former built-in default; user-created Chinese profiles stay untouched. */
export function migrateLegacyNarraEdgeVoice(config: TTSConfig): TTSConfig {
  if (
    config.engine !== "edge" ||
    config.activeProfileId !== DEFAULT_EDGE_PROFILE_ID ||
    config.edgeVoice !== LEGACY_EDGE_DEFAULT_VOICE
  ) {
    return config;
  }

  return {
    ...config,
    edgeVoice: DEFAULT_TTS_CONFIG.edgeVoice,
    profiles: config.profiles.map((profile) =>
      profile.id === DEFAULT_EDGE_PROFILE_ID && profile.voice === LEGACY_EDGE_DEFAULT_VOICE
        ? { ...profile, voice: DEFAULT_TTS_CONFIG.edgeVoice }
        : profile,
    ),
  };
}
