import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Bundles the CLI into one self-contained CommonJS file.
 *
 * Why bother: after installation there is no `node_modules` next to the app, and
 * an installed CLI that only works inside a checkout is not a real desktop
 * feature. One file, no resolution edges, runs on plain Node 22+.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "cli", "index.js");
const OUT_DIR = path.join(ROOT, "bin");
const OUT_FILE = path.join(OUT_DIR, "aragon-browser.cjs");

fs.mkdirSync(OUT_DIR, { recursive: true });

const result = await build({
  entryPoints: [ENTRY],
  outfile: OUT_FILE,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  legalComments: "none",
  logLevel: "info",
  metafile: true,
  define: {
    // The source is ESM. esbuild's `inject` only reaches module scope, so the
    // substitution has to be an expression that is valid in a CJS bundle.
    "import.meta.url": "__importMetaUrl",
  },
  banner: {
    js:
      "// aragon-browser CLI - bundled from src/cli/index.js. Do not edit; rebuild with `npm run build:cli`.\n" +
      'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
});

// The bundle must not accidentally pull in electron or the kernel's native deps.
const text = fs.readFileSync(OUT_FILE, "utf8");
for (const forbidden of ["require(\"electron\")", "desktopCapturer", "WebContentsView"]) {
  if (text.includes(forbidden)) {
    console.error(`[build:cli] refusing to ship a bundle containing ${forbidden}`);
    process.exit(1);
  }
}

const size = fs.statSync(OUT_FILE).size;
console.log(`[build:cli] ${path.relative(ROOT, OUT_FILE)} (${(size / 1024).toFixed(1)} KiB)`);

// The bundle resolves SKILL.md from a sibling directory, so ship it alongside.
const skillSource = path.join(ROOT, "src", "cli", "skill-body");
const skillTarget = path.join(OUT_DIR, "skill-body");
fs.rmSync(skillTarget, { recursive: true, force: true });
fs.cpSync(skillSource, skillTarget, { recursive: true });
console.log(
  `[build:cli] ${path.relative(ROOT, skillTarget)}/${fs.readdirSync(skillTarget).join(", ")}`,
);

if (result.warnings.length > 0) {
  for (const warning of result.warnings) console.warn(`[build:cli] warn: ${warning.text}`);
}
