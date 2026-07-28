import { mkdir, rm, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const iconset = path.join(root, "desktop", "Fieldwork.iconset");
const output = path.join(root, "desktop", "Fieldwork.icns");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function fieldworkPng(size) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  const radius = Math.round(size * 0.23);
  const ink = [32, 33, 30, 255];
  const accent = [211, 255, 76, 255];
  const transparent = [0, 0, 0, 0];

  function insideRoundedSquare(x, y) {
    const edge = Math.round(size * 0.03);
    const left = edge;
    const right = size - edge - 1;
    const top = edge;
    const bottom = size - edge - 1;
    const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
    const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
    return x >= left && x <= right && y >= top && y <= bottom &&
      (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  }

  function insideF(x, y) {
    const left = size * 0.30;
    const top = size * 0.27;
    const stemRight = size * 0.43;
    const bottom = size * 0.75;
    const upperRight = size * 0.72;
    const upperBottom = size * 0.39;
    const middleRight = size * 0.64;
    const middleTop = size * 0.47;
    const middleBottom = size * 0.59;
    return (x >= left && x <= stemRight && y >= top && y <= bottom) ||
      (x >= left && x <= upperRight && y >= top && y <= upperBottom) ||
      (x >= left && x <= middleRight && y >= middleTop && y <= middleBottom);
  }

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const color = insideF(x, y) ? accent : insideRoundedSquare(x, y) ? ink : transparent;
      const offset = row + 1 + x * 4;
      rows.set(color, offset);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const files = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

await rm(iconset, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });
for (const [name, size] of files) await writeFile(path.join(iconset, name), fieldworkPng(size));

if (process.platform === "darwin") {
  const result = spawnSync("iconutil", ["-c", "icns", iconset, "-o", output], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  await rm(iconset, { recursive: true, force: true });
  console.log(`Created ${path.relative(root, output)}`);
} else {
  console.log(`Created PNG icon set at ${path.relative(root, iconset)}. Build the .icns file on macOS.`);
}
