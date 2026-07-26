import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function buildTeamsCallingBotPackage(
  appId: string,
  hostname: string,
): Buffer {
  validateAppId(appId);
  validateHostname(hostname);
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
  return zip([
    { name: "manifest.json", data: Buffer.from(manifest, "utf8") },
    { name: "color.png", data: png(192, 192, colorPixel) },
    { name: "outline.png", data: png(32, 32, outlinePixel) },
  ]);
}

function main(): void {
  const output = process.argv[2];
  if (!output || !isAbsolute(output) || !output.endsWith(".zip")) {
    throw new Error("Provide one absolute, new .zip output path.");
  }
  if (existsSync(output)) {
    throw new Error("The package output already exists.");
  }
  const bytes = buildTeamsCallingBotPackage(
    required("TEAMS_CALLING_BOT_APP_ID"),
    required("TEAMS_CALLING_BOT_HOSTNAME"),
  );
  writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
  process.stdout.write(`Created ${basename(output)}.\n`);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function validateAppId(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  ) {
    throw new Error("TEAMS_CALLING_BOT_APP_ID must be a UUID.");
  }
}

function validateHostname(value: string): void {
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value) ||
    value.includes("..")
  ) {
    throw new Error("TEAMS_CALLING_BOT_HOSTNAME must be one DNS hostname.");
  }
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function zip(input: readonly ZipEntry[]): Buffer {
  const entries = [...input].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  );
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "ascii");
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, entry.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
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
    chunk("IDAT", storedZlib(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function storedZlib(data: Buffer): Buffer {
  const parts: Buffer[] = [Buffer.from([0x78, 0x01])];
  for (let offset = 0; offset < data.length; offset += 65_535) {
    const block = data.subarray(offset, Math.min(offset + 65_535, data.length));
    const header = Buffer.alloc(5);
    header[0] = offset + block.length === data.length ? 1 : 0;
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE(0xffff ^ block.length, 3);
    parts.push(header, block);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler32(data), 0);
  parts.push(checksum);
  return Buffer.concat(parts);
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

function adler32(data: Buffer): number {
  let first = 1;
  let second = 0;
  for (const byte of data) {
    first = (first + byte) % 65_521;
    second = (second + first) % 65_521;
  }
  return ((second << 16) | first) >>> 0;
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

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (entrypoint === import.meta.url) main();
