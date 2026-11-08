import fs from "node:fs";
import path from "node:path";
import { encodePng } from "./png.mjs";

/**
 * Draws a placeholder app icon as a real PNG, with no image dependency.
 *
 * This used to be the shipping icon. It is not any more: `build/icon.png` is a
 * designed asset now (a blue glass swirl), and it is committed. This script
 * exists only to bootstrap a checkout that has no icon at all, so `npm run
 * build` on a fresh clone still produces an installer instead of failing on a
 * missing file.
 *
 * It is therefore non-destructive: if the target already exists it leaves it
 * alone and says so. Pass `--force` to overwrite deliberately.
 *
 * PNG encoding lives in scripts/png.mjs, which the brand-icon resizer uses too.
 */

const SIZE = 1024;

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

const args = process.argv.slice(2);
const force = args.includes("--force");
const target = args.find((arg) => !arg.startsWith("--")) ?? "build/icon.png";
const outputPath = path.resolve(process.cwd(), target);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

// The committed icon wins. Regenerating it here would silently replace the
// designed asset with the placeholder on every `npm run build`.
if (fs.existsSync(outputPath) && !force) {
  const { size } = fs.statSync(outputPath);
  console.log(
    `[icon] keeping ${outputPath} (${size} bytes) - pass --force to overwrite ` +
      `with the placeholder`,
  );
} else {
  const png = renderIcon(1024);
  fs.writeFileSync(outputPath, png);
  console.log(`[icon] wrote ${outputPath} (${png.length} bytes, 1024x1024)`);
}
