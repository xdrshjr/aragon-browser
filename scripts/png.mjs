import zlib from "node:zlib";

/**
 * Minimal PNG read/write, with no image dependency.
 *
 * The repo ships one designed icon (`build/icon.png`) and derives everything the
 * UI and the installers need from it. Doing that with zlib alone keeps `npm
 * install` free of a native image library - which is the whole reason the icon
 * pipeline is code instead of a checked-in pile of resized files.
 *
 * Scope is deliberately narrow: 8-bit, non-interlaced, the four PNG colour types
 * that are not palettes. That is exactly what a PNG written by an image model or
 * by `encodePng` below is. Anything else throws instead of silently returning a
 * half-decoded image.
 */

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

/** RGBA buffer (width*height*4 bytes) -> PNG bytes. */
export function encodePng(width, height, rgba) {
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

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** PNG bytes -> { width, height, data } with data as straight (non-premultiplied) RGBA. */
export function decodePng(buffer) {
  if (buffer.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error("not a PNG");
  }
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IHDR") header = buffer.subarray(offset + 8, offset + 8 + length);
    else if (type === "IDAT") idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  if (!header) throw new Error("PNG has no IHDR");

  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const colorType = header[9];
  const interlace = header[12];
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth} (need 8)`);
  if (interlace !== 0) throw new Error("interlaced PNG is not supported");
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? out[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      let value = row[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
      out[i] = value & 0xff;
    }
    previous = out;
  }

  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const source = i * channels;
    const target = i * 4;
    if (colorType === 6) {
      data[target] = pixels[source];
      data[target + 1] = pixels[source + 1];
      data[target + 2] = pixels[source + 2];
      data[target + 3] = pixels[source + 3];
    } else if (colorType === 2) {
      data[target] = pixels[source];
      data[target + 1] = pixels[source + 1];
      data[target + 2] = pixels[source + 2];
      data[target + 3] = 255;
    } else if (colorType === 0) {
      data[target] = pixels[source];
      data[target + 1] = pixels[source];
      data[target + 2] = pixels[source];
      data[target + 3] = 255;
    } else {
      data[target] = pixels[source];
      data[target + 1] = pixels[source];
      data[target + 2] = pixels[source];
      data[target + 3] = pixels[source + 1];
    }
  }
  return { width, height, data };
}

/**
 * Area-average resize (box filter). Averaging in premultiplied space is what
 * keeps a transparent edge from pulling black into the result - the swirl icon
 * has a wide transparent margin, and a naive average turns its soft edge grey.
 */
export function resizeRgba({ width, height, data }, targetWidth, targetHeight) {
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  const out = Buffer.alloc(targetWidth * targetHeight * 4);

  for (let ty = 0; ty < targetHeight; ty += 1) {
    const y0 = ty * scaleY;
    const y1 = Math.min(height, y0 + scaleY);
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const x0 = tx * scaleX;
      const x1 = Math.min(width, x0 + scaleX);
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let weight = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const area = wx * wy;
          const index = (sy * width + sx) * 4;
          const alpha = data[index + 3] / 255;
          sumR += data[index] * alpha * area;
          sumG += data[index + 1] * alpha * area;
          sumB += data[index + 2] * alpha * area;
          sumA += alpha * area;
          weight += area;
        }
      }
      const target = (ty * targetWidth + tx) * 4;
      if (weight === 0 || sumA === 0) continue;
      out[target] = Math.round(sumR / sumA);
      out[target + 1] = Math.round(sumG / sumA);
      out[target + 2] = Math.round(sumB / sumA);
      out[target + 3] = Math.round((sumA / weight) * 255);
    }
  }
  return out;
}
