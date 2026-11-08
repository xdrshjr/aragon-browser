import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where bundled data lives.
 *
 * There are three real layouts and each one has to work:
 *   dev checkout     : src/cli/index.js        -> <root>/src/cli/skill-body
 *   bundled CLI      : bin/aragon-browser.cjs  -> <root>/bin/skill-body
 *   installed app    : app.asar                -> resources/learnings, resources/skill-body
 *
 * Hard-coding any one of them is how a packaged app ends up "working" in the
 * dev tree and broken on a user's machine, so every lookup tries candidates
 * and reports which one it used.
 */
const here = (() => {
  try {
    return __dirname;
  } catch {
    return ".";
  }
})();

function existing(candidates, marker) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const target = marker ? path.join(candidate, marker) : candidate;
      if (fs.existsSync(target)) return candidate;
    } catch {
      // A path we cannot stat is simply not a candidate.
    }
  }
  return null;
}

/** Root of the skill-body directory that holds SKILL.md. */
export function skillBodyDir() {
  const found = existing(
    [
      process.env.ARAGON_SKILL_DIR,
      path.join(here, "skill-body"),
      path.join(here, "..", "src", "cli", "skill-body"),
      process.env.ARAGON_RESOURCES_DIR
        ? path.join(process.env.ARAGON_RESOURCES_DIR, "skill-body")
        : null,
      path.join(here, "..", "..", "src", "cli", "skill-body"),
    ],
    "SKILL.md",
  );
  if (!found) {
    throw new Error(
      "aragon-browser: could not find skill-body/SKILL.md; reinstall or set ARAGON_SKILL_DIR",
    );
  }
  return found;
}

/**
 * Root that contains `learnings/`.
 *
 * Mirrors ego-lite's layout: site skills live inside the agent skill directory
 * (`skills/aragon-browser/learnings`), not at the repo root, so one directory is
 * the whole agent-facing surface.
 *
 * Three real layouts, each of which must work:
 *   dev checkout   : skills/aragon-browser/learnings
 *   installed app  : resources/skills/aragon-browser/learnings
 *   unpacked build : dist/win-unpacked/resources/skills/aragon-browser/learnings
 */
export function workspaceRoot() {
  if (process.env.ARAGON_AGENT_WORKSPACE) {
    return path.resolve(process.env.ARAGON_AGENT_WORKSPACE);
  }
  const skillDirName = path.join("skills", "aragon-browser");
  const found = existing(
    [
      path.join(here, "..", "..", skillDirName),
      path.join(here, "..", skillDirName),
      process.resourcesPath ? path.join(process.resourcesPath, skillDirName) : null,
      path.join(here, "..", ".."),
      path.join(here, "..", "..", ".."),
    ],
    path.join("learnings"),
  );
  // Falling back to the repo/bundle root keeps the error message honest
  // ("no learnings here") instead of pointing at a path that does not exist.
  return found ?? path.join(here, "..", "..");
}

export function projectRoot() {
  return path.resolve(here, "..", "..");
}
