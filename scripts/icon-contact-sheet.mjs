/**
 * Builds image/00-contact-sheet.png: all ten candidates on one 5x2 grid, each
 * scaled into a cell with its number, so the set can be judged as a set.
 *
 * Uses only node:zlib plus a hand-rolled PNG decode, because the repo has no
 * image dependency and adding one for a preview is not worth it.
 */

import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE_DIR = path.join(ROOT, "image");
const CELL = 420;
const GAP = 18;
const COLS = 5;
const ROWS = 2;
const PAD = 28;
const BG = [0x16, 0x1a, 0x22]; // deep neutral, so both white and blue marks read

/** Minimal PNG reader: 8-bit RGBA, non-interlaced, filter 0..4. */
function decodePng(buffer) {
  if (buffer.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("not a PNG");
  }
  let off = 8;
  let width = 0;
  let height = 0;
  let colourType = 6;
  const idat = [];
  while (off < buffer.length) {
    const len = buffer.readUInt32BE(off);
    const type = buffer.slice(off + 4, off + 8).toString("ascii");
    const data = buffer.slice(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colourType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (colourType !== 6) throw new Error(`unsupported colour type ${colourType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[rowIn + x];
      const left = x >= 4 ? out[rowOut + x - 4] : 0;
      const up = y > 0 ? out[rowOut - stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? out[rowOut - stride + x - 4] : 0;
      let value;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          value = rawByte + pred;
          break;
        }
        default:
          throw new Error(`bad filter ${filter}`);
      }
      out[rowOut + x] = value & 0xff;
    }
  }
  return { width, height, data: out };
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const files = fs
  .readdirSync(IMAGE_DIR)
  .filter((f) => /^\d{2}-.*\.png$/.test(f) && !f.startsWith("00-"))
  .sort();

const width = PAD * 2 + COLS * CELL + (COLS - 1) * GAP;
const height = PAD * 2 + ROWS * CELL + (ROWS - 1) * GAP;
const sheet = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i += 1) {
  sheet[i * 4] = BG[0];
  sheet[i * 4 + 1] = BG[1];
  sheet[i * 4 + 2] = BG[2];
  sheet[i * 4 + 3] = 255;
}

files.forEach((file, index) => {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const originX = PAD + col * (CELL + GAP);
  const originY = PAD + row * (CELL + GAP);
  const img = decodePng(fs.readFileSync(path.join(IMAGE_DIR, file)));

  // Fit the source into the cell, preserving aspect, with a small inset.
  const inset = 12;
  const box = CELL - inset * 2;
  const scale = Math.min(box / img.width, box / img.height);
  const drawW = Math.round(img.width * scale);
  const drawH = Math.round(img.height * scale);
  const dx0 = originX + Math.round((CELL - drawW) / 2);
  const dy0 = originY + Math.round((CELL - drawH) / 2);

  for (let y = 0; y < drawH; y += 1) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < drawW; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const s = (sy * img.width + sx) * 4;
      const a = img.data[s + 3] / 255;
      if (a === 0) continue;
      const d = ((dy0 + y) * width + (dx0 + x)) * 4;
      if (d < 0 || d + 3 >= sheet.length) continue;
      sheet[d] = Math.round(img.data[s] * a + sheet[d] * (1 - a));
      sheet[d + 1] = Math.round(img.data[s + 1] * a + sheet[d + 1] * (1 - a));
      sheet[d + 2] = Math.round(img.data[s + 2] * a + sheet[d + 2] * (1 - a));
      sheet[d + 3] = 255;
    }
  }
});

const outPath = path.join(IMAGE_DIR, "00-contact-sheet.png");
fs.writeFileSync(outPath, encodePng(width, height, sheet));
console.log(
  `[sheet] wrote ${outPath} (${width}x${height}, ${files.length} icons)`,
);
