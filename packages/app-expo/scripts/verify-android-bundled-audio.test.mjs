import assert from "node:assert/strict";
import test from "node:test";
import { findBundledAudioEntries } from "./verify-android-bundled-audio.mjs";

test("accepts an archive entry list without bundled audio", () => {
  assert.deepEqual(
    findBundledAudioEntries([
      "assets/index.android.bundle",
      "base/res/drawable/cover.png",
      "res/a1.mp4",
    ]),
    [],
  );
});

test("detects bundled audio case-insensitively", () => {
  assert.deepEqual(
    findBundledAudioEntries([
      "assets/voice.mp3",
      "res/raw/silence.WAV",
      "base/res/raw/voice.m4a",
      "base/res/raw/voice.aac",
      "base/res/raw/voice.ogg",
      "base/res/raw/voice.flac",
      "base/res/raw/voice.opus",
      "res/a1.mp4",
    ]),
    [
      "assets/voice.mp3",
      "res/raw/silence.WAV",
      "base/res/raw/voice.m4a",
      "base/res/raw/voice.aac",
      "base/res/raw/voice.ogg",
      "base/res/raw/voice.flac",
      "base/res/raw/voice.opus",
    ],
  );
});
