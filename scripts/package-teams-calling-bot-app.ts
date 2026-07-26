import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";

const appId = required("TEAMS_CALLING_BOT_APP_ID");
const hostname = required("TEAMS_CALLING_BOT_HOSTNAME");
const output = process.argv[2];
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(appId)
) {
  throw new Error("TEAMS_CALLING_BOT_APP_ID must be a UUID.");
}
if (
  !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(hostname) ||
  hostname.includes("..")
) {
  throw new Error("TEAMS_CALLING_BOT_HOSTNAME must be one DNS hostname.");
}
if (!output || !isAbsolute(output) || !output.endsWith(".zip")) {
  throw new Error("Provide one absolute, new .zip output path.");
}
if (existsSync(output)) {
  throw new Error("The package output already exists.");
}

const directory = mkdtempSync(join(tmpdir(), "ap2-calling-app-"));
try {
  const template = readFileSync(
    new URL(
      "../teams-calling-bot/teams-app/manifest.template.json",
      import.meta.url,
    ),
    "utf8",
  );
  const manifest = template
    .replaceAll("{{APP_ID}}", appId)
    .replaceAll("{{HOSTNAME}}", hostname);
  JSON.parse(manifest);
  const manifestPath = join(directory, "manifest.json");
  const colorPath = join(directory, "color.png");
  const outlinePath = join(directory, "outline.png");
  writeFileSync(manifestPath, manifest, { flag: "wx", mode: 0o600 });
  writeFileSync(colorPath, png(192, 192, colorPixel), {
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(outlinePath, png(32, 32, outlinePixel), {
    flag: "wx",
    mode: 0o600,
  });
  execFileSync(
    "zip",
    ["-q", "-j", output, manifestPath, colorPath, outlinePath],
    { stdio: "ignore" },
  );
  process.stdout.write(`Created ${basename(output)}.\n`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

type Pixel = (x: number, y: number) => readonly [number, number, number, number];

function colorPixel(
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const handset = x >= 48 && x <= 143 && y >= 76 && y <= 115;
  return handset ? [255, 255, 255, 255] : [29, 78, 216, 255];
}

function outlinePixel(
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const handset = x >= 6 && x <= 25 && y >= 12 && y <= 19;
  return handset ? [255, 255, 255, 255] : [0, 0, 0, 0];
}

function png(width: number, height: number, pixel: Pixel): Buffer {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowLength] = 0;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha] = pixel(x, y);
      const offset = y * rowLength + 1 + x * 4;
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = alpha;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
