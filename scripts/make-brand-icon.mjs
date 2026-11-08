import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, resizeRgba } from "./png.mjs";

/**
 * Derives the title-bar brand image from the one shipping icon.
 *
 * `build/icon.png` is the app icon (installer, exe, window). The self-drawn title
 * bar needs the same mark at 18 CSS px, and pointing a 16px <img> at a 1254px
 * PNG would decode 1.2 MB of pixels on every window open for a 16x16 result.
 * So the header gets its own small, committed copy that is regenerated from the
 * designed asset - one source of truth, no hand-maintained duplicate.
 *
 * The output is committed on purpose: `npm start` on a fresh clone must paint the
 * right logo without running a build first. Running this script again produces
 * the same bytes.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "build", "icon.png");
const TARGET = path.join(ROOT, "src", "renderer", "brand.png");
// 64px covers the 18px header mark at 3.5x DPI; the file stays a few KB.
const SIZE = 64;

if (!fs.existsSync(SOURCE)) {
  // A checkout without the designed icon still has to start. make-icon.mjs
  // bootstraps the placeholder during `npm run build`, so just say what is
  // missing instead of writing a brand mark out of nothing.
  console.error(`[brand] ${SOURCE} is missing; run "npm run icon" first`);
  process.exit(1);
}

const source = decodePng(fs.readFileSync(SOURCE));
const rgba = resizeRgba(source, SIZE, SIZE);
const png = encodePng(SIZE, SIZE, rgba);
fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, png);
console.log(
  `[brand] wrote ${path.relative(ROOT, TARGET)} (${png.length} bytes, ${SIZE}x${SIZE}) ` +
    `from ${path.relative(ROOT, SOURCE)} (${source.width}x${source.height})`,
);
