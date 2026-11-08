import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

/**
 * Generates the app icon as a real PNG, with no image dependency.
 *
 * A build that ships the default Electron icon is a build nobody believes is
 * finished, and adding a canvas/sharp dependency just to draw one diamond is not
 * worth it. PNG is a container plus zlib deflate, and Node has zlib built in.
 */

const SIZE = 1024;

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
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // Each scanline gets a filter byte; filter 0 (none) keeps this readable.
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

function blend(target, offset, [r, g, b], alpha) {
  if (alpha <= 0) return;
  const a = Math.min(1, alpha);
  const dstR = target[offset];
  const dstG = target[offset + 1];
  const dstB = target[offset + 2];
  const dstA = target[offset + 3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA === 0) return;
  target[offset] = Math.round((r * a + dstR * dstA * (1 - a)) / outA);
  target[offset + 1] = Math.round((g * a + dstG * dstA * (1 - a)) / outA);
  target[offset + 2] = Math.round((b * a + dstB * dstA * (1 - a)) / outA);
  target[offset + 3] = Math.round(outA * 255);
}

function roundedRectAlpha(x, y, left, top, right, bottom, radius) {
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return Math.hypot(dx, dy) <= radius ? 1 : 0;
}

function diamondAlpha(x, y, cx, cy, halfWidth, halfHeight) {
  const dx = Math.abs(x - cx) / halfWidth;
  const dy = Math.abs(y - cy) / halfHeight;
  return dx + dy <= 1 ? 1 : 0;
}

export function renderIcon(size = SIZE) {
  const pixels = Buffer.alloc(size * size * 4, 0);
  const scale = size / SIZE;
  const margin = Math.round(30 * scale);
  const radius = Math.round(190 * scale);
  const background = [0x16, 0x18, 0x20];
  const border = [0x2a, 0x30, 0x42];
  const accent = [0x60, 0xa5, 0xfa];

  const cx = size / 2;
  const cy = size / 2;
  const outer = 330 * scale;
  const inner = 215 * scale;
  const core = 120 * scale;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;

      // Rounded plate, with a 2px inner border for definition on light taskbars.
      const plate = roundedRectAlpha(
        x + 0.5,
        y + 0.5,
        margin,
        margin,
        size - margin,
        size - margin,
        radius,
      );
      const innerPlate = roundedRectAlpha(
        x + 0.5,
        y + 0.5,
        margin + 2 * scale,
        margin + 2 * scale,
        size - margin - 2 * scale,
        size - margin - 2 * scale,
        radius - 2 * scale,
      );
      if (plate) blend(pixels, offset, innerPlate ? background : border, 1);

      // The ◈ mark: an outer diamond with a hole, then a solid core diamond.
      if (diamondAlpha(x, y, cx, cy, outer, outer)) {
        if (!diamondAlpha(x, y, cx, cy, inner, inner)) {
          blend(pixels, offset, accent, 1);
        } else if (diamondAlpha(x, y, cx, cy, core, core)) {
          blend(pixels, offset, accent, 1);
        }
      }
    }
  }

  return encodePng(size, size, pixels);
}

const target = process.argv[2] ?? "build/icon.png";
const outputPath = path.resolve(process.cwd(), target);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const png = renderIcon(1024);
fs.writeFileSync(outputPath, png);
console.log(`[icon] wrote ${outputPath} (${png.length} bytes, 1024x1024)`);
