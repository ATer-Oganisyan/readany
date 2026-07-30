import { AudioManager, AudioRecorder } from "react-native-audio-api";

const SAMPLE_RATE = 16_000;
const CHANNEL_COUNT = 1;
const CALLBACK_SECONDS = 0.1;
export const MAX_DICTATION_SECONDS = 55;
const MAX_SAMPLES = SAMPLE_RATE * MAX_DICTATION_SECONDS;

export interface PcmVoiceRecording {
  bytes: Uint8Array;
  mime: string;
  seconds: number;
}

export class PcmVoiceRecorder {
  private readonly recorder = new AudioRecorder();
  private chunks: Int16Array[] = [];
  private sampleCount = 0;
  private startedAt = 0;
  private active = false;

  async start(): Promise<void> {
    const permission = await AudioManager.requestRecordingPermissions();
    if (permission !== "Granted") {
      throw new Error("Разрешите запись звука в настройках устройства.");
    }

    AudioManager.setAudioSessionOptions({
      iosCategory: "record",
      iosMode: "measurement",
      iosOptions: [],
    });
    await AudioManager.setAudioSessionActivity(true);

    this.chunks = [];
    this.sampleCount = 0;
    this.startedAt = Date.now();

    const callbackResult = this.recorder.onAudioReady(
      {
        sampleRate: SAMPLE_RATE,
        bufferLength: SAMPLE_RATE * CALLBACK_SECONDS,
        channelCount: CHANNEL_COUNT,
      },
      ({ buffer, numFrames }) => {
        const available = Math.min(
          numFrames,
          buffer.getChannelData(0).length,
          MAX_SAMPLES - this.sampleCount,
        );
        if (available <= 0) return;

        const source = buffer.getChannelData(0);
        const pcm = new Int16Array(available);
        for (let index = 0; index < available; index += 1) {
          const sample = Math.max(-1, Math.min(1, source[index] ?? 0));
          pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        this.chunks.push(pcm);
        this.sampleCount += available;
      },
    );
    if (callbackResult.status === "error") {
      await AudioManager.setAudioSessionActivity(false);
      throw new Error(callbackResult.message);
    }

    const startResult = this.recorder.start();
    if (startResult.status === "error") {
      this.recorder.clearOnAudioReady();
      await AudioManager.setAudioSessionActivity(false);
      throw new Error(startResult.message);
    }
    this.active = true;
  }

  async stop(): Promise<PcmVoiceRecording> {
    const seconds = Math.min(
      MAX_DICTATION_SECONDS,
      Math.max(0, (Date.now() - this.startedAt) / 1000),
    );

    if (this.active) {
      this.recorder.clearOnAudioReady();
      const stopResult = this.recorder.stop();
      this.active = false;
      await AudioManager.setAudioSessionActivity(false);
      if (stopResult.status === "error") throw new Error(stopResult.message);
    }

    const bytes = new Uint8Array(this.sampleCount * Int16Array.BYTES_PER_ELEMENT);
    let offset = 0;
    for (const chunk of this.chunks) {
      bytes.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offset);
      offset += chunk.byteLength;
    }
    this.chunks = [];
    this.sampleCount = 0;

    return {
      bytes,
      mime: `audio/x-pcm;bit=16;rate=${SAMPLE_RATE}`,
      seconds,
    };
  }

  async dispose(): Promise<void> {
    if (!this.active) return;
    try {
      this.recorder.clearOnAudioReady();
      this.recorder.stop();
    } finally {
      this.active = false;
      this.chunks = [];
      this.sampleCount = 0;
      await AudioManager.setAudioSessionActivity(false).catch(() => false);
    }
  }
}
