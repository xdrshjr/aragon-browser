import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * The project ships a `skills/` directory, the way ego-lite does, so an agent
 * (or a human) can find the browser's skill by reading the repo rather than
 * being told where it is. This file pins that structure down: an entry SKILL.md
 * with real frontmatter, references it actually links to, and install scripts
 * that exist.
 */
const ROOT = process.cwd();
const SKILL_DIR = path.join(ROOT, "skills", "aragon-browser");
const ENTRY = path.join(SKILL_DIR, "SKILL.md");

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.+)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}

test("skills/aragon-browser exists with an entry SKILL.md", () => {
  assert.ok(fs.existsSync(SKILL_DIR), `${SKILL_DIR} is missing`);
  assert.ok(fs.existsSync(ENTRY), `${ENTRY} is missing`);
});

test("the entry skill is discoverable: name and description frontmatter", () => {
  const text = fs.readFileSync(ENTRY, "utf8");
  assert.equal(text.split(/\r?\n/)[0], "---", "frontmatter must start on line 1");
  const fields = frontmatter(text);
  assert.equal(fields?.name, "aragon-browser");
  const description = fields?.description ?? "";
  assert.ok(description.length > 120, "description too short for an agent to decide on");
  assert.match(description, /\bUse when\b/);
  // Negative guidance is what stops an agent loading a browser for an HTTP call.
  assert.match(description, /do\s*n[o']?t\s+use/i, "must say when NOT to use it");
});

test("the entry skill points at the versioned guide instead of duplicating it", () => {
  const text = fs.readFileSync(ENTRY, "utf8");
  // The full API lives in `aragon-browser skill`, generated from the schema.
  // Duplicating it here is how the skill and the runtime drift apart.
  assert.match(text, /aragon-browser skill/);
  assert.match(text, /nodejs/);
  assert.match(text, /waitForNavigation/, "must warn about the post-click wait trap");
});

test("every reference file is linked and exists", () => {
  const text = fs.readFileSync(ENTRY, "utf8");
  const linked = [...text.matchAll(/references\/([A-Za-z0-9_-]+\.md)/g)].map((m) => m[1]);
  assert.ok(linked.length >= 2, "the entry skill should link its references");
  for (const name of new Set(linked)) {
    const file = path.join(SKILL_DIR, "references", name);
    assert.ok(fs.existsSync(file), `${file} is linked but missing`);
  }
  // And the other direction: a reference nobody links is dead weight.
  const onDisk = fs.readdirSync(path.join(SKILL_DIR, "references"));
  for (const name of onDisk) {
    assert.ok(linked.includes(name), `references/${name} is never linked from SKILL.md`);
  }
});

test("install scripts exist for both platforms", () => {
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "install.ps1")));
  assert.ok(fs.existsSync(path.join(SKILL_DIR, "scripts", "install.sh")));
});

test("install scripts never edit PATH on their own", () => {
  // Silent environment mutation during setup is the difference between a tool and
  // malware; the scripts must print the command instead of running it.
  const ps1 = fs.readFileSync(path.join(SKILL_DIR, "scripts", "install.ps1"), "utf8");
  const sh = fs.readFileSync(path.join(SKILL_DIR, "scripts", "install.sh"), "utf8");
  assert.doesNotMatch(ps1, /^\s*setx /m, "install.ps1 must not run setx by itself");
  assert.match(ps1, /setx PATH/, "install.ps1 should still tell the user the command");
  assert.doesNotMatch(sh, /^\s*(export PATH|echo .*>>.*(zshrc|bashrc))/m);
  assert.match(sh, /export PATH=/, "install.sh should still tell the user the command");
});

test("site skills live under the skill directory, where an agent expects them", () => {
  const learnings = path.join(SKILL_DIR, "learnings");
  assert.ok(fs.existsSync(learnings), `${learnings} is missing`);
  const sites = fs.readdirSync(learnings).filter((name) => !name.startsWith("_"));
  assert.ok(sites.length > 0, "no site skills shipped");
  for (const site of sites) {
    const manifest = path.join(learnings, site, "manifest.json");
    assert.ok(fs.existsSync(manifest), `${manifest} is missing`);
    assert.equal(JSON.parse(fs.readFileSync(manifest, "utf8")).id, site);
  }
  // A root-level learnings/ directory would be a second, competing location.
  assert.ok(
    !fs.existsSync(path.join(ROOT, "learnings")),
    "learnings/ must not also exist at the repo root",
  );
});

test("the entry skill documents where the parts live", () => {
  const text = fs.readFileSync(ENTRY, "utf8");
  for (const part of ["SKILL.md", "references/install.md", "learnings/"]) {
    assert.ok(text.includes(part), `entry skill does not mention ${part}`);
  }
});
