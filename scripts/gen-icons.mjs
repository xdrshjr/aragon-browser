/**
 * Generates app-icon candidates with Codex's built-in GPT image tool.
 *
 * There is no image API key on this machine and the Codex CLI is the only image
 * model available, so the pipeline is: one `codex exec` per candidate, each told
 * to run its built-in `image_gen` tool once and copy the result to a fixed path.
 * Verified from artifacts/icon-logs/*.log: Codex loads its system `imagegen`
 * skill and calls the built-in tool; outputs land in
 * ~/.codex/generated_images/<session>/ and are copied into image/.
 *
 * The brief is in scripts/icon-brief.md. Read that before editing anything here.
 * The short version: no dark backing plate. The icon IS the form, filling the
 * canvas, in a tight blue palette. Half the set is flat and bold, half is
 * premium material, matching the reference icons the user supplied.
 *
 *   node scripts/gen-icons.mjs                # all candidates, 3 at a time
 *   node scripts/gen-icons.mjs 03 07          # only those ids
 *   node scripts/gen-icons.mjs --concurrency 1
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "image");
const LOG_DIR = path.join(ROOT, "artifacts", "icon-logs");

/**
 * The shared system. Identical for all ten candidates, so the set reads as one
 * brand. Contains no company names: a brand name is read as a shape request and
 * the model draws that brand's logo instead.
 */
const SYSTEM = [
  "You are a senior product designer drawing the shipping application icon for a",
  "desktop web browser that AI agents drive by writing JavaScript. This is a",
  "PRODUCT ICON for a taskbar and an app store: one bold, confident, beautiful",
  "object that a person recognises instantly at 16 pixels and that looks premium",
  "at 1024 pixels.",

  "NO BACKING PLATE. The icon is not a symbol sitting on a dark rounded tile. The",
  "icon's own form fills the canvas edge to edge, occupying about 96 percent of the",
  "width, with only a hair of breathing room. Whatever shape the concept describes",
  "IS the icon. Outside that form the canvas is fully transparent — there is no",
  "rounded rectangle behind it, no card, no tile, no frame, and no filled square",
  "either. The area between the form and the canvas edge must be empty alpha, the",
  "same as an unused region of the file, not a dark panel.",

  "BOLDNESS. Thick, generous, self-assured masses. Any stroke in the drawing is at",
  "least one fifth of the form's height. If a part could be thinner and still read",
  "at 16 pixels, it is already too thin. Big simple masses beat fine detail.",

  "SILHOUETTE MUST SURVIVE ON ANY BACKGROUND. The icon is transparent around its",
  "form, so a white form on a transparent canvas would vanish on a light desktop",
  "and a blue form would vanish nowhere but a white form would. Therefore: any form",
  "whose fill is white or pale MUST be enclosed by a defined edge in deep azure or",
  "ink so its silhouette is legible against both light and dark backgrounds. Letting",
  "a white shape float with no boundary is a failure.",

  "PALETTE — STRICTLY THE BLUE FAMILY, and this is not negotiable: deep ink",
  "#0B1220, azure #2563EB, light azure #60A5FA, and pure white #FFFFFF. Nothing",
  "else. No purple, magenta, pink, red, orange, gold, green or teal anywhere in the",
  "artwork. Every candidate uses the same family so the set is one brand.",

  "COMPOSITION. One centred object, symmetric on the axis the concept allows,",
  "optically centred, with even clear space around it. Clean silhouette. No element",
  "drifting off axis, no accidental sliver of colour, no seam where two shapes meet.",

  "ORIGINALITY. An original construction. It may not reproduce, resemble or evoke",
  "any existing company's logo. If it starts to look like a recognisable browser or",
  "software brand mark, change the construction deliberately until it does not.",
].join(" ");

/** Flat treatment: two flat tones, one gradient at most. */
const FLAT = [
  "TREATMENT — FLAT BOLD. Solid flat fills, hard clean edges, no shading of any",
  "kind. One shape may carry a single smooth two-stop gradient between two blues",
  "from the palette; everything else is a single flat tone. High contrast between",
  "the form and whatever it sits against. Crisp, punchy, poster-like.",
].join(" ");

/** Premium treatment: the iridescent-glass look the reference icons have. */
const PREMIUM = [
  "TREATMENT — PREMIUM MATERIAL. Render the form as a real object with a smooth",
  "glass-like volume: soft internal refraction, a broad gentle specular sheen along",
  "the upper faces, subtle colour shift across the surface between azure and pale",
  "blue, and a clean defined silhouette. Confident studio lighting from the upper",
  "left, soft ambient fill, no harsh hot spots, no roughness, no scratches, no",
  "lens flare. The material must look expensive and clean, in the way a well-made",
  "app icon for a flagship product does. Keep it within the blue palette — the",
  "sheen shifts from azure toward pale blue and white, never toward purple or",
  "orange.",
].join(" ");

/** What every candidate must avoid. */
const NEGATIVE = [
  "Do NOT draw a rounded-square plate, tile, card or frame behind the icon — the",
  "icon must stand alone on transparency. Do NOT add text, labels, numbers,",
  "screenshots, device frames, photographs, a second icon, a grid of variations,",
  "a checkerboard or a watermark. Do NOT let the palette drift outside the blue",
  "family. Not a thin-line outline icon, not a hairline glyph, not a wireframe,",
  "not a mandala, not a woven knot, not a sunburst, not a flower.",

  "The surface must be perfectly clean. Absolutely no stray marks, blotches,",
  "smudges, splotches, randomly scattered light patches, mottled areas, dithered",
  "pixels, or uneven patches of tone anywhere inside the form. Every fill is one",
  "even tone or one smooth uninterrupted gradient. If a region would contain",
  "anything that is not a deliberate shape, it is empty and flat instead.",

  "A region filled with a single flat colour is completely featureless: it holds",
  "NO decoration, no pattern, no speckle, no cloud, no light patch, no gradient",
  "splotch, no texture. A large unbroken flat area must be as plain as printed",
  "ink. Keep any single flat region smaller than half the icon if you cannot keep",
  "it perfectly plain.",

  "Every shape that is described as drawn on top of another is a solid opaque",
  "shape with hard edges — it fully covers what is beneath it. No semi-transparent",
  "overlays, no fogged or frosted regions, no soft-edged white areas, no haze.",
].join(" ");

/**
 * Ten candidates. `mark` gives the concept, `treatment` the finish: half flat and
 * bold, half premium material, all in one blue family.
 */
export const CANDIDATES = [
  {
    id: "01",
    name: "window-cursor",
    hero: true,
    treatment: FLAT,
    note: "全幅窗口 + 光标：最直白的产品识别，白色窗口配蓝色指针",
    mark: [
      "CONCEPT: a browser window with a pointer in it.",
      "A large solid azure window panel fills the icon, defined by a thick white",
      "border of even width, its top edge carrying a chrome band one stroke wide with",
      "a small tab notch cut into that band as a white shape. The panel's lower-right",
      "corner is overlapped from the front by a big solid white cursor arrow pointing",
      "up and left, separated from the panel by a thin gap of transparency. The arrow",
      "is chunky, about a third of the panel's width. The panel sits flat on the",
      "transparent canvas: its whole outline is the white border, with no dark edge,",
      "no shadow, no glow and no halo of any kind outside that white border.",
    ].join(" "),
  },
  {
    id: "02",
    name: "disc-glyph",
    hero: true,
    treatment: FLAT,
    note: "蓝色圆盘 + 白色雪佛龙 + azure 点：参考 AragonA 的构成，但用蓝底解决白形消失",
    mark: [
      "CONCEPT: a glyph inside a disc.",
      "The form is one large solid azure circle filling the icon, defined by a thick",
      "white ring around its edge. Centred in it, cut through the azure as a clean",
      "white negative shape, is a bold angular chevron — a '>' built from two thick",
      "straight strokes meeting at a sharp flat-cut vertex, tilted slightly so it",
      "reads as motion. One small solid white disc sits just below the chevron's",
      "vertex, separated from it by a clear gap.",
    ].join(" "),
  },
  {
    id: "03",
    name: "tab-fold",
    hero: true,
    treatment: PREMIUM,
    note: "折叠玻璃标签页：一条玻璃带折成近方形轮廓，参考 Ecliptrix 的通透感",
    mark: [
      "CONCEPT: a browser tab, folded out of one piece of glass.",
      "The form is one continuous band of blue glass, kept close to a square overall",
      "footprint so it reads as an icon rather than a banner. It begins at the lower",
      "left pointing up, folds once with a rounded crease to run across the top,",
      "folds again with a rounded crease to run down the right side, and ends with a",
      "short inward hook at the bottom right behind the first leg. The band has a",
      "broad flat face and a clearly visible thickness along its inner edge, so the",
      "two creases read as deliberate folds in one ribbon. The single enclosed",
      "opening in the middle is a tall rounded rectangle, taller than it is wide.",
    ].join(" "),
  },
  {
    id: "04",
    name: "ring-cursor",
    hero: true,
    treatment: FLAT,
    note: "蓝色圆环挖出白色光标：参考夸克的结构，饱和、粗壮、极简",
    mark: [
      "CONCEPT: a browser pointer, cut into a disc.",
      "The form is one large solid azure circle with a thick white ring around it,",
      "the ring and the disc concentric. Cut through the azure disc as a white",
      "negative shape is a bold window: a rounded rectangle with a chrome band across",
      "its top. The window sits centred, its edges well inside the disc.",
    ].join(" "),
  },
  {
    id: "05",
    name: "globe-object",
    treatment: PREMIUM,
    note: "玻璃地球：web 本体 + 高级材质，产品语义与质感兼顾",
    mark: [
      "CONCEPT: the web, as an object.",
      "The form is a large sphere with a clean bold spherical volume. Its surface is",
      "divided by three deep channels — one horizontal around the equator, two curved",
      "verticals — each wide enough to read clearly, cut into the sphere so the",
      "channels show the transparency behind. One small solid pale-blue disc sits",
      "just outside the sphere at its upper right.",
    ].join(" "),
  },
  {
    id: "06",
    name: "stack-pages",
    treatment: FLAT,
    note: "三层错位页面：多标签 / 多 Space，蓝色三层色阶叠加",
    mark: [
      "CONCEPT: pages stacked behind one another.",
      "Three solid rounded rectangular panels are stacked with a diagonal offset,",
      "each one behind and to the lower left of the one before it, so the two back",
      "panels each show a wide even band along their top and right edges. The front",
      "panel is solid azure, the middle is solid light azure, the back is solid deep",
      "ink. All three are single flat tones with no gradient, no texture and no",
      "content drawn on any of them. The offsets are exactly equal and every visible",
      "band is the same uniform width.",
    ].join(" "),
  },
  {
    id: "07",
    name: "diamond-gem",
    treatment: PREMIUM,
    note: "玻璃菱形：把现行 ◈ 做成有体积的高级物件，品牌延续最强",
    mark: [
      "CONCEPT: the existing diamond mark, given real volume.",
      "The form is one large brilliant-cut diamond — a square rotated 45 degrees,",
      "drawn as a solid gemstone with a flat table on top, a girdle around the middle",
      "and facets converging to a point at the bottom. Four or six clean facets,",
      "each a distinct plane catching light differently, all within the blue family.",
      "Sharp, precise gem cutting; no rough or noisy surface.",
    ].join(" "),
  },
  {
    id: "08",
    name: "swirl-agent",
    treatment: PREMIUM,
    note: "流体旋涡：参考 AragonM 的动态结构，表达 agent 在浏览器里运转",
    mark: [
      "CONCEPT: motion around a core.",
      "The form is a single continuous ribbon of polished blue glass coiled into a",
      "trefoil — three arms sweeping out from a centre in a pinwheel, each arm",
      "tapering to a clean rounded tip, the ribbon twisting so its broad face turns",
      "toward the viewer along each arm. At the very centre, cradled by the three",
      "arms, is one small solid pale-blue sphere.",
    ].join(" "),
  },
  {
    id: "09",
    name: "brackets-solid",
    treatment: PREMIUM,
    note: "两根玻璃粗括号：实心代字符，没有大色块，避免白斑；质感靠材质而非平涂",
    mark: [
      "CONCEPT: code syntax, as a physical object.",
      "The form is a matched pair of very thick angle brackets, '<' and '>', facing",
      "away from each other, each drawn as a solid three-dimensional bar of blue",
      "glass with visible thickness and rounded ends. Every bar is at least one sixth",
      "of its own height thick. The two brackets are the entire icon: there is no",
      "card, no panel, no background shape of any kind behind them, only",
      "transparency. The gap between the facing tips is wide and even.",
    ].join(" "),
  },
  {
    id: "10",
    name: "torus-orbit",
    treatment: PREMIUM,
    note: "玻璃圆环 + 轨道球：边界与卫星，径向构造最有仪式感的一张",
    mark: [
      "CONCEPT: something bound to a boundary.",
      "The form is one thick polished blue torus standing upright, its hole clearly",
      "visible through to transparency, its surface smooth and glass-like. One small",
      "solid pale-blue sphere rests tangent to the torus at its upper right, sitting",
      "in front of it. Torus and sphere share a clean common silhouette with no",
      "overlap artifacts.",
    ].join(" "),
  },
];

function buildInstruction(candidate, targetPath) {
  return [
    "Use your built-in image_gen tool exactly once. Give it precisely this prompt,",
    "verbatim, as one paragraph:",
    "",
    `"""${SYSTEM} ${candidate.treatment} ${candidate.mark} ${NEGATIVE}"""`,
    "",
    "The output must be a single icon centred on a transparent background, with no",
    "plate or tile behind it.",
    "",
    "Then copy the produced image file to this absolute path, creating any missing",
    `directories: ${targetPath}`,
    "",
    "Then confirm with a file listing that the file exists and print the source path",
    "the tool reported plus the byte size of the copy. Do not generate a second image,",
    "do not create or modify any other file, do not edit the repository.",
  ].join("\n");
}

function runCodex(candidate, targetPath, logPath) {
  return new Promise((resolve) => {
    const log = fs.createWriteStream(logPath);
    // The instruction is long and full of quotes, so it goes in on stdin and the
    // CLI is told to read its prompt from there ("-" as the prompt arg). Passing
    // it as an argv string survives only until the first space, because Windows
    // spawns through cmd.exe.
    const child = spawn(
      "codex",
      [
        "exec",
        "-C",
        ROOT,
        "--skip-git-repo-check",
        "-s",
        "danger-full-access",
        "-",
      ],
      { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], shell: true },
    );
    child.stdin.end(buildInstruction(candidate, targetPath), "utf8");
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on("close", (code) => {
      log.end();
      const bytes = fs.existsSync(targetPath) ? fs.statSync(targetPath).size : 0;
      resolve({ code, bytes });
    });
  });
}

function parseArgs(argv) {
  const ids = [];
  let concurrency = 3;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--concurrency") {
      concurrency = Number(argv[i + 1]) || 1;
      i += 1;
    } else if (/^\d{2}$/.test(argv[i])) {
      ids.push(argv[i]);
    }
  }
  return { ids, concurrency };
}

async function main() {
  const { ids, concurrency } = parseArgs(process.argv.slice(2));
  const picked = ids.length
    ? CANDIDATES.filter((c) => ids.includes(c.id))
    : CANDIDATES;
  if (!picked.length) {
    console.error(`[icons] no candidate matched ${ids.join(",")}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const results = [];
  let cursor = 0;
  async function worker(label) {
    while (cursor < picked.length) {
      const candidate = picked[cursor];
      cursor += 1;
      const fileName = `${candidate.id}-${candidate.name}.png`;
      const targetPath = path.join(OUT_DIR, fileName);
      const logPath = path.join(LOG_DIR, `${candidate.id}.log`);
      const started = Date.now();
      console.log(`[icons] ${label} start ${fileName}`);
      const { code, bytes } = await runCodex(candidate, targetPath, logPath);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const ok = code === 0 && bytes > 0;
      console.log(
        `[icons] ${label} ${ok ? "ok  " : "FAIL"} ${fileName} ` +
          `${bytes} bytes, exit ${code}, ${secs}s`,
      );
      results.push({ candidate, ok, bytes, code });
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, picked.length) },
    (_, i) => worker(`w${i + 1}`),
  );
  await Promise.all(workers);

  const failed = results.filter((r) => !r.ok);
  console.log(
    `[icons] done: ${results.length - failed.length}/${results.length} produced`,
  );
  if (failed.length) {
    console.error(
      `[icons] failed: ${failed.map((r) => r.candidate.id).join(", ")} ` +
        `(logs in ${path.relative(ROOT, LOG_DIR)})`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
