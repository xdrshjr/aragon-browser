/**
 * Publishes a GitHub release for the version in package.json.
 *
 *   node scripts/publish-release.mjs --notes scripts/release-notes/v0.1.1.md
 *   node scripts/publish-release.mjs --notes <file> --draft
 *
 * Everything that identifies the release - tag, title, asset names - is derived
 * from package.json, because the previous version of this script hardcoded them
 * and had to be edited by hand on every bump (and quietly did not, once).
 *
 * Four constraints shaped it:
 *
 * 1. A TUN-style proxy on this machine answers some DNS queries with fake
 *    198.18.x.x addresses, which makes api.github.com die in the TLS handshake
 *    while `git push` works fine. Direct requests are tried first, and only if
 *    that fails do we pin a real address over DoH and retry with `--resolve`.
 * 2. Headers go in a curl config file, never in argv: an argv-borne token is
 *    visible in the process list and ends up quoted in any error that prints the
 *    failing command. The config is deleted in a `finally`.
 * 3. spawnSync, not execFileSync. execFileSync throws with the whole command in
 *    the message on a non-zero exit, which is exactly how a credential escapes
 *    into a log. This reports a status code and nothing else.
 * 4. Re-running is safe. An existing release for the tag is reused, and an asset
 *    that is already attached under the same name is deleted before re-upload -
 *    otherwise the API answers 422 and the run half-succeeds, leaving a release
 *    with two of three files.
 *
 * The body goes in a file and the status comes back on stdout, because a newline
 * inside a curl `-w` format string gets mangled by Windows argument parsing.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const REPO = "xdrshjr/aragon-browser";
const VERSION = pkg.version;
const TAG = `v${VERSION}`;
const NAME = `${pkg.name} ${VERSION}`;
// electron-builder.yml derives the installer names from ${version}, so these are
// the names it wrote into dist/ - not a second guess at them.
const ASSETS = [
  `dist/aragon-browser-${VERSION}-x64.exe`,
  `dist/aragon-browser-${VERSION}-portable.exe`,
  `dist/latest.yml`,
];

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const notesFile = argValue("--notes");
const asDraft = args.includes("--draft");

if (!notesFile) {
  console.error("[release] --notes <file> is required: the body is reviewed prose, not generated");
  process.exit(1);
}
const NOTES = fs.readFileSync(path.resolve(ROOT, notesFile), "utf8");
for (const file of ASSETS) {
  if (!fs.existsSync(path.join(ROOT, file))) {
    console.error(`[release] missing ${file} - run \`npm run dist\` first`);
    process.exit(1);
  }
}

const CFG = path.join(ROOT, "artifacts", "curl.cfg");
const OUT_DIR = path.join(ROOT, "artifacts", "release");
fs.mkdirSync(OUT_DIR, { recursive: true });
const out = (name) => path.join(OUT_DIR, name);

function gitCredential() {
  const res = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const line = (res.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("password="));
  if (!line) throw new Error("no credential in the git credential store");
  return line.slice("password=".length);
}

/** Real A record for a host, via DoH. Only used when a direct call fails. */
function realIp(host) {
  const res = spawnSync(
    "curl.exe",
    [
      "-s",
      "--max-time",
      "25",
      "-H",
      "accept: application/dns-json",
      `https://dns.google/resolve?name=${host}&type=A`,
    ],
    { encoding: "utf8" },
  );
  const answers = JSON.parse(res.stdout ?? "{}").Answer ?? [];
  const a = answers.filter((x) => x.type === 1).map((x) => x.data);
  // A 198.18.0.0/15 answer is the proxy's fake range, not GitHub. Refusing it is
  // what keeps this fallback from "helpfully" pinning a dead address.
  const real = a.find((ip) => !ip.startsWith("198.18.") && !ip.startsWith("198.19."));
  if (!real) throw new Error(`no usable A record for ${host} (got ${a.join(",") || "none"})`);
  return real;
}

/** One curl run. Returns { ok, status, bodyFile }. Never echoes the command. */
function curlOnce(host, { url, method = "GET", body, contentType, out: bodyFile, ip }) {
  const argv = [
    "-K",
    CFG,
    "-s",
    "-o",
    bodyFile,
    "-w",
    "%{http_code}",
    "--max-time",
    "1800",
    "-X",
    method,
  ];
  if (ip) argv.push("--resolve", `${host}:443:${ip}`);
  if (contentType) argv.push("-H", `Content-Type: ${contentType}`);
  if (body) argv.push("--data-binary", `@${body}`);
  argv.push(url);
  const res = spawnSync("curl.exe", argv, { encoding: "utf8" });
  if (res.status !== 0) return { ok: false, status: res.status ?? -1, bodyFile };
  return { ok: true, status: Number((res.stdout ?? "").trim()), bodyFile };
}

/** Direct first, pinned address second (see note 1 at the top). */
function curl(host, opts) {
  const direct = curlOnce(host, opts);
  if (direct.ok) return direct;
  const ip = realIp(host);
  console.log(`[release] direct ${host} failed, retrying pinned at ${ip}`);
  return curlOnce(host, { ...opts, ip });
}

function fail(step, res) {
  let detail = "";
  try {
    detail = fs.readFileSync(res.bodyFile, "utf8").slice(0, 300);
  } catch {
    /* nothing readable came back */
  }
  throw new Error(`${step}: http ${res.status} ${detail}`);
}

function main() {
  const token = gitCredential();
  fs.writeFileSync(
    CFG,
    [
      `header = "Authorization: Bearer ${token}"`,
      `header = "Accept: application/vnd.github+json"`,
      `header = "X-GitHub-Api-Version: 2022-11-28"`,
      `header = "User-Agent: aragon-browser-release"`,
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );

  try {
    console.log(`[release] ${TAG} -> ${REPO}`);

    // ---- 1. the tag has to be on the remote before the release -----------
    // A release whose tag does not exist creates one pointing at the default
    // branch's tip, which is not necessarily the commit that was packaged.
    const remote = spawnSync("git", ["ls-remote", "--tags", "origin", `refs/tags/${TAG}`], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (!(remote.stdout ?? "").includes(`refs/tags/${TAG}`)) {
      throw new Error(`tag ${TAG} is not on origin; push it before publishing`);
    }

    // ---- 2. reuse or create the release ---------------------------------
    let release = null;
    const found = curl("api.github.com", {
      url: `https://api.github.com/repos/${REPO}/releases/tags/${TAG}`,
      out: out("release-found.json"),
    });
    if (found.status === 200) {
      release = JSON.parse(fs.readFileSync(found.bodyFile, "utf8"));
      console.log(`[release] reusing existing release ${release.id}`);
    } else {
      const payload = out("release-payload.json");
      fs.writeFileSync(payload, JSON.stringify({ tag_name: TAG, name: NAME, body: NOTES, draft: asDraft, prerelease: false }), "utf8");
      const created = curl("api.github.com", {
        url: `https://api.github.com/repos/${REPO}/releases`,
        method: "POST",
        contentType: "application/json",
        body: payload,
        out: out("release-created.json"),
      });
      if (created.status !== 201) fail("create release", created);
      release = JSON.parse(fs.readFileSync(created.bodyFile, "utf8"));
      console.log(`[release] created${asDraft ? " (draft)" : ""} ${release.html_url}`);
    }

    // ---- 3. delete same-named assets so a re-run is idempotent -----------
    const current = curl("api.github.com", {
      url: `https://api.github.com/repos/${REPO}/releases/${release.id}/assets`,
      out: out("assets.json"),
    });
    if (current.status !== 200) fail("list assets", current);
    const existing = JSON.parse(fs.readFileSync(current.bodyFile, "utf8"));
    for (const asset of existing) {
      if (!ASSETS.some((file) => path.basename(file) === asset.name)) continue;
      const removed = curl("api.github.com", {
        url: `https://api.github.com/repos/${REPO}/releases/assets/${asset.id}`,
        method: "DELETE",
        out: out("asset-delete.json"),
      });
      if (removed.status !== 204) fail(`delete asset ${asset.name}`, removed);
      console.log(`[release] deleted old ${asset.name}`);
    }

    // ---- 4. upload -------------------------------------------------------
    const uploaded = [];
    for (const file of ASSETS) {
      const name = path.basename(file);
      const started = Date.now();
      const res = curl("uploads.github.com", {
        url:
          `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets` +
          `?name=${encodeURIComponent(name)}`,
        method: "POST",
        contentType: "application/octet-stream",
        body: path.join(ROOT, file),
        out: out("asset-upload.json"),
      });
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      if (res.status !== 201) fail(`upload ${name}`, res);
      const asset = JSON.parse(fs.readFileSync(res.bodyFile, "utf8"));
      console.log(`[release] uploaded ${name} (${(asset.size / 1048576).toFixed(1)} MB, ${secs}s, state ${asset.state})`);
      uploaded.push("uploaded");
    }

    if (uploaded.length !== ASSETS.length) throw new Error("not every asset was uploaded");

    // ---- 5. confirm against the API, not against what we hoped -----------
    const after = curl("api.github.com", {
      url: `https://api.github.com/repos/${REPO}/releases/tags/${TAG}`,
      out: out("release-after.json"),
    });
    if (after.status !== 200) fail("re-read release", after);
    const final = JSON.parse(fs.readFileSync(after.bodyFile, "utf8"));
    const attached = final.assets.filter((a) => a.state === "uploaded").map((a) => a.name).sort();
    const expected = ASSETS.map((f) => path.basename(f)).sort();
    if (attached.join(",") !== expected.join(",")) {
      throw new Error(`release assets ${attached.join(",")} != expected ${expected.join(",")}`);
    }
    console.log(`[release] OK ${TAG}: ${attached.join(", ")}`);
    console.log(`[release] ${final.html_url}`);
  } finally {
    fs.rmSync(CFG, { force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`[release] FAILED: ${error.message}`);
  process.exitCode = 1;
}
