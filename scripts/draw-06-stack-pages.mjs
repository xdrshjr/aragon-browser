/**
 * Draws icon 06 — three stacked pages — as a real PNG from code.
 *
 * The image model kept painting white blotches inside large flat fills. Flat
 * geometry is the one thing code draws better than a diffusion model, and this
 * candidate is pure flat geometry: three rounded panels, three flat tones. So it
 * is drawn here instead, deterministically, with no dependency beyond zlib.
 *
 * The renderer below is a small anti-aliased signed-shape rasteriser: coverage
 * comes from a 4x4 supersample of the rounded-rect distance, which is plenty for
 * a 1024 px icon at icon scale.
 */

import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "image");
const SIZE = 1024;
const SS = 4; // supersamples per axis

/** Locked palette: ink, azure, light azure. */
const INK = [0x0b, 0x12, 0x20];
const AZURE = [0x25, 0x63, 0xeb];
const LIGHT = [0x60, 0xa5, 0xfa];

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
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** True when (x, y) is inside a rounded rectangle. */
function inRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

/** Source-over composite of one colour onto the RGBA buffer at full coverage. */
function paint(target, offset, [r, g, b]) {
  target[offset] = r;
  target[offset + 1] = g;
  target[offset + 2] = b;
  target[offset + 3] = 255;
}

export function renderStackPages(size = SIZE) {
  const pixels = Buffer.alloc(size * size * 4, 0);
  const scale = size / 1024;

  // Three panels, offset diagonally up and right, each showing a wide band of
  // the two behind it. Sized to fill ~96% of the canvas, as the brief requires.
  const panelSide = 700 * scale;
  const radius = 150 * scale;
  const step = 78 * scale;
  const originLeft = (size - panelSide) / 2 - step;
  const originTop = (size - panelSide) / 2 + step;

  const layers = [
    { color: INK, dx: 2, dy: -2 },
    { color: LIGHT, dx: 1, dy: -1 },
    { color: AZURE, dx: 0, dy: 0 },
  ];

  for (const layer of layers) {
    const left = originLeft + layer.dx * step;
    const top = originTop + layer.dy * step;
    const right = left + panelSide;
    const bottom = top + panelSide;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy += 1) {
          for (let sx = 0; sx < SS; sx += 1) {
            const px = x + (sx + 0.5) / SS;
            const py = y + (sy + 0.5) / SS;
            if (inRoundedRect(px, py, left, top, right, bottom, radius)) hits += 1;
          }
        }
        if (hits === 0) continue;

        const offset = (y * size + x) * 4;
        const coverage = hits / (SS * SS);
        if (coverage >= 1) {
          paint(pixels, offset, layer.color);
        } else {
          // Blend this layer over whatever is already there.
          const dstA = pixels[offset + 3] / 255;
          const outA = coverage + dstA * (1 - coverage);
          if (outA === 0) continue;
          for (let c = 0; c < 3; c += 1) {
            pixels[offset + c] = Math.round(
              (layer.color[c] * coverage + pixels[offset + c] * dstA * (1 - coverage)) /
                outA,
            );
          }
          pixels[offset + 3] = Math.round(outA * 255);
        }
      }
    }
  }

  return encodePng(size, size, pixels);
}

const outputPath = path.join(OUT_DIR, "06-stack-pages.png");
fs.mkdirSync(OUT_DIR, { recursive: true });
const png = renderStackPages();
fs.writeFileSync(outputPath, png);
console.log(`[icon] wrote ${outputPath} (${png.length} bytes, ${SIZE}x${SIZE})`);
