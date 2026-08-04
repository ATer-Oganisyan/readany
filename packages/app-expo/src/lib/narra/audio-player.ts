import { type AudioPlayer, createAudioPlayer } from "expo-audio";

export class NarraAudioPlayer {
  private player: AudioPlayer | null = null;
  private subscription: { remove: () => void } | null = null;
  private onStopped: (() => void) | null = null;

  play(uri: string, onFinished: () => void, onStopped?: () => void): void {
    this.stop();
    const player = createAudioPlayer({ uri }, { keepAudioSessionActive: true });
    this.player = player;
    this.onStopped = onStopped ?? null;
    this.subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (!status.didJustFinish) return;
      this.cleanup();
      onFinished();
    });
    player.play();
  }

  stop(): void {
    const onStopped = this.onStopped;
    this.cleanup();
    onStopped?.();
  }

  private cleanup(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.player?.pause();
    this.player?.remove();
    this.player = null;
    this.onStopped = null;
  }
}
