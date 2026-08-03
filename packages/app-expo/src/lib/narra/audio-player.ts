import { type AudioPlayer, createAudioPlayer } from "expo-audio";

export class NarraAudioPlayer {
  private player: AudioPlayer | null = null;
  private subscription: { remove: () => void } | null = null;

  play(uri: string, onFinished: () => void): void {
    this.stop();
    const player = createAudioPlayer({ uri }, { keepAudioSessionActive: true });
    this.player = player;
    this.subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (!status.didJustFinish) return;
      this.stop();
      onFinished();
    });
    player.play();
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.player?.pause();
    this.player?.remove();
    this.player = null;
  }
}
