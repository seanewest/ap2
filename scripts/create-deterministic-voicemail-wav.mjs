import { closeSync, openSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const VOICEMAIL_WAV_BYTES = 4_512_044;
export const VOICEMAIL_WAV_SHA256 =
  "2176c232fc88b0d9d4ce26cb63723a986172144e79e3f3666e4e7bf7aa332bc1";

export function createDeterministicVoicemailWav(outputPath) {
  const rate = 48_000;
  const durationSeconds = 47;
  const samples = rate * durationSeconds;
  const dataBytes = samples * 2;
  const wav = Buffer.alloc(44 + dataBytes);

  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);

  const markers = [
    [30, 32, 440],
    [33, 35, 554.37],
    [36, 38, 659.25],
    [39, 41, 880],
  ];
  for (let sample = 0; sample < samples; sample += 1) {
    const time = sample / rate;
    let value = 0;
    for (const [start, end, frequency] of markers) {
      if (time >= start && time < end) {
        const envelope = Math.min(1, (time - start) / 0.03, (end - time) / 0.03);
        value = 10_000 * Math.max(0, envelope) * Math.sin(2 * Math.PI * frequency * time);
        break;
      }
    }
    wav.writeInt16LE(Math.round(value), 44 + sample * 2);
  }

  const fd = openSync(resolve(outputPath), "wx", 0o600);
  try {
    writeFileSync(fd, wav);
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const outputPath = process.argv[2];
  if (!outputPath) {
    throw new Error("Usage: node scripts/create-deterministic-voicemail-wav.mjs <new-output.wav>");
  }
  createDeterministicVoicemailWav(outputPath);
}
