import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { skillBodyDir } from "../src/shared/paths.js";
import { renderHelp, PUBLIC_API_SCHEMA } from "../src/shared/public-api-schema.js";

const SKILL_DIR = skillBodyDir();
const SKILL_PATH = path.join(SKILL_DIR, "SKILL.md");

/**
 * The installed skill is how an agent finds out this browser exists. If its
 * frontmatter is missing or malformed, the file lands in ~/.claude/skills and the
 * agent never loads it - the CLI works, the agent just never uses it. That
 * failure is silent, so it gets a test.
 */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.+)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}

test("SKILL.md starts with valid YAML frontmatter", () => {
  const text = fs.readFileSync(SKILL_PATH, "utf8");
  assert.equal(text.split(/\r?\n/)[0], "---", "frontmatter must be the first line");
  const fields = parseFrontmatter(text);
  assert.ok(fields, "no frontmatter block found");
  assert.equal(fields.name, "aragon-browser");
});

test("the skill description says what it does AND when to use it", () => {
  const fields = parseFrontmatter(fs.readFileSync(SKILL_PATH, "utf8"));
  const description = fields?.description ?? "";
  // Agents decide whether to load a skill from this one field.
  assert.ok(description.length > 120, "description is too short to be discoverable");
  assert.match(description, /aragon-browser/i, "must name the tool");
  assert.match(description, /\bUse when\b/, 'must contain a "Use when" trigger clause');
  assert.match(description, /automate|snapshot|scrape|extract|form/i);
});

test("the skill body documents the real invocation and the PATH fallback", () => {
  const text = fs.readFileSync(SKILL_PATH, "utf8");
  assert.match(text, /aragon-browser nodejs/, "must show the stdin entry point");
  assert.match(text, /not on PATH/i, "must explain what to do without PATH");
  assert.match(text, /ARAGON_RUNTIME_NOT_RUNNING/, "must name the not-running error");
});

test("the rendered guide documents every API entry", () => {
  // The appended HELP section is generated from PUBLIC_API_SCHEMA, so every
  // signature the runtime supports must appear there. A guide that omits a
  // method is how an agent "cannot" do something the browser can do.
  const help = renderHelp();
  const missing = PUBLIC_API_SCHEMA.filter((entry) => !help.includes(entry.signature)).map(
    (entry) => entry.name,
  );
  assert.deepEqual(missing, [], `rendered help is missing: ${missing.join(", ")}`);
});

test("the skill body links each API area in prose so agents can skim it", () => {
  const text = fs.readFileSync(SKILL_PATH, "utf8");
  for (const heading of [
    "Targets: refs and locators",
    "Spaces",
    "Observing",
    "Acting",
    "Verifying",
    "JS dialogs",
    "Clipboard",
    "Learned site skills",
  ]) {
    assert.match(text, new RegExp(`## ${heading}`), `missing section: ${heading}`);
  }
});

test("the HELP marker exists exactly once so the CLI can substitute it", () => {
  const text = fs.readFileSync(SKILL_PATH, "utf8");
  const count = text.split("<!-- HELP -->").length - 1;
  assert.equal(count, 1, `expected exactly one <!-- HELP --> marker, found ${count}`);
});

test("the bundled CLI ships a SKILL.md next to itself", () => {
  // `bin/skill-body/SKILL.md` is what an installed app serves; a missing copy
  // makes `aragon-browser skill` fail on a user's machine only.
  const bundled = path.join(process.cwd(), "bin", "skill-body", "SKILL.md");
  if (!fs.existsSync(path.join(process.cwd(), "bin", "aragon-browser.cjs"))) {
    // CLI has not been bundled in this checkout yet; nothing to compare.
    return;
  }
  assert.ok(fs.existsSync(bundled), `${bundled} is missing; run npm run build:cli`);
  assert.equal(
    fs.readFileSync(bundled, "utf8"),
    fs.readFileSync(SKILL_PATH, "utf8"),
    "the bundled SKILL.md is stale; run npm run build:cli",
  );
});
