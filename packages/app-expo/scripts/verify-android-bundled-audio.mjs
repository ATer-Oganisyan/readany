#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLED_AUDIO_EXTENSION = /\.(?:aac|flac|m4a|mp3|ogg|opus|wav)$/i;

export function findBundledAudioEntries(entries) {
  return entries.filter((entry) => BUNDLED_AUDIO_EXTENSION.test(entry));
}

export function readAndroidArchiveEntries(artifactPath) {
  const output = execFileSync("unzip", ["-Z1", artifactPath], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return output.split(/\r?\n/).filter(Boolean);
}

export function verifyAndroidArchiveHasNoBundledAudio(artifactPath) {
  const bundledAudio = findBundledAudioEntries(readAndroidArchiveEntries(artifactPath));
  if (bundledAudio.length > 0) {
    throw new Error(
      `Android artifact contains bundled audio:\n${bundledAudio.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const artifactPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
  if (!artifactPath || !/\.(?:aab|apk)$/i.test(artifactPath)) {
    console.error("Usage: pnpm verify:android:bundled-audio -- <path-to.apk|path-to.aab>");
    process.exitCode = 2;
  } else if (!existsSync(artifactPath)) {
    console.error(`Android artifact does not exist: ${artifactPath}`);
    process.exitCode = 2;
  } else {
    try {
      verifyAndroidArchiveHasNoBundledAudio(artifactPath);
      console.log(`OK: no bundled audio files in ${artifactPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
