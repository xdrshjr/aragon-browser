/**
 * Draws the flat-geometry candidates as real PNGs from code: 02 and 04.
 *
 * The image model reliably added dark smudges inside large flat fills on these
 * two. Flat geometry is the one thing code draws better than a diffusion model,
 * so they are drawn here deterministically, in the locked palette, with no
 * dependency beyond zlib.
 *
 * Coverage is a 4x4 supersample of signed distance, which is plenty at icon
 * scale, and every fill is a single flat tone by construction — there is no
 * code path here that can produce a blotch.
 */

import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "image");
const SIZE = 1024;
const SS = 4;

/** Locked palette. */
const INK = [0x0b, 0x12, 0x20];
const AZURE = [0x25, 0x63, 0xeb];
const LIGHT = [0x60, 0xa5, 0xfa];
const WHITE = [0xff, 0xff, 0xff];

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

/** Signed distance to a circle (negative inside). */
function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

/** Signed distance to a rounded rectangle (negative inside). */
function sdRoundRect(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - (halfW - radius);
  const qy = Math.abs(y - cy) - (halfH - radius);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Signed distance to a thick line segment with square ends. */
function sdSegment(x, y, ax, ay, bx, by, halfThickness) {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy) / len));
  return Math.hypot(px - dx * t, py - dy * t) - halfThickness;
}

/** Composite one flat colour over the buffer, given a coverage function. */
function paintLayer(pixels, coverageAt, colour) {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (coverageAt(px, py) < 0) hits += 1;
        }
      }
      if (hits === 0) continue;
      const offset = (y * SIZE + x) * 4;
      const cov = hits / (SS * SS);
      const dstA = pixels[offset + 3] / 255;
      const outA = cov + dstA * (1 - cov);
      if (outA === 0) continue;
      for (let c = 0; c < 3; c += 1) {
        pixels[offset + c] = Math.round(
          (colour[c] * cov + pixels[offset + c] * dstA * (1 - cov)) / outA,
        );
      }
      pixels[offset + 3] = Math.round(outA * 255);
    }
  }
}

/** 02 — azure disc, white rim, white chevron, white dot. */
function renderDiscGlyph() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4, 0);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const outer = 486; // fills ~95% of the canvas
  const rim = 46;

  paintLayer(pixels, (x, y) => sdCircle(x, y, cx, cy, outer), WHITE);
  paintLayer(pixels, (x, y) => sdCircle(x, y, cx, cy, outer - rim), AZURE);

  // Chevron '>' rotated slightly clockwise, centred a little above middle.
  const angle = (12 * Math.PI) / 180;
  const apexX = cx + 118;
  const apexY = cy - 46;
  const arm = 236;
  const thick = 58;
  const upX = apexX - Math.cos(angle) * arm * 1.35;
  const upY = apexY + Math.sin(angle) * arm * 1.35 - Math.cos(angle) * arm * 0.72;
  const downX = apexX - Math.cos(angle) * arm * 1.35;
  const downY = apexY + Math.sin(angle) * arm * 1.35 + Math.cos(angle) * arm * 0.72;

  paintLayer(
    pixels,
    (x, y) =>
      Math.min(
        sdSegment(x, y, apexX, apexY, upX, upY, thick),
        sdSegment(x, y, apexX, apexY, downX, downY, thick),
      ),
    WHITE,
  );

  // The dot sits below the vertex, clear of the arms.
  paintLayer(pixels, (x, y) => sdCircle(x, y, cx - 12, cy + 232, 52), WHITE);

  return encodePng(SIZE, SIZE, pixels);
}

/** 04 — azure disc, white rim, white browser window with three dots. */
function renderRingCursor() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4, 0);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const outer = 486;
  const rim = 44;

  paintLayer(pixels, (x, y) => sdCircle(x, y, cx, cy, outer), WHITE);
  paintLayer(pixels, (x, y) => sdCircle(x, y, cx, cy, outer - rim), AZURE);

  // Window panel, white, with a chrome band and three dots cut back to azure.
  const halfW = 232;
  const halfH = 186;
  const radius = 40;
  paintLayer(
    pixels,
    (x, y) => sdRoundRect(x, y, cx, cy + 6, halfW, halfH, radius),
    WHITE,
  );

  // Chrome rule separates the band from the page.
  const bandBottom = cy + 6 - halfH + 92;
  paintLayer(
    pixels,
    (x, y) => sdRoundRect(x, y, cx, bandBottom, halfW - 18, 7, 7),
    AZURE,
  );

  // Three dots in the chrome band.
  for (let i = 0; i < 3; i += 1) {
    const dotX = cx + 6 + i * 66;
    const dotY = cy + 6 - halfH + 46;
    paintLayer(pixels, (x, y) => sdCircle(x, y, dotX, dotY, 20), AZURE);
  }

  // Cursor arrow, azure, overlapping the panel's lower right, with a white
  // outline so it separates from the panel.
  const tipX = cx + 118;
  const tipY = cy + 176;
  const arrow = (x, y, grow) => {
    // A simple arrow built from two segments plus a head triangle.
    const shaft = sdSegment(x, y, tipX - 96, tipY - 96, tipX, tipY, 30 + grow);
    // Head: a triangle pointing up-left, approximated by three segments.
    const hx = tipX;
    const hy = tipY;
    const a = sdSegment(x, y, hx, hy, hx - 92, hy - 34, 26 + grow);
    const b = sdSegment(x, y, hx, hy, hx - 34, hy - 92, 26 + grow);
    const c = sdSegment(x, y, hx - 92, hy - 34, hx - 34, hy - 92, 26 + grow);
    return Math.min(shaft, a, b, c);
  };
  paintLayer(pixels, (x, y) => arrow(x, y, 12), WHITE);
  paintLayer(pixels, (x, y) => arrow(x, y, 0), AZURE);

  return encodePng(SIZE, SIZE, pixels);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const jobs = [
  ["02-disc-glyph.png", renderDiscGlyph],
  ["04-ring-cursor.png", renderRingCursor],
];
for (const [name, render] of jobs) {
  const png = render();
  const target = path.join(OUT_DIR, name);
  fs.writeFileSync(target, png);
  console.log(`[icon] wrote ${target} (${png.length} bytes, ${SIZE}x${SIZE})`);
}
