import fs from "node:fs";
import path from "node:path";
import { workspaceRoot } from "../../shared/paths.js";

/**
 * Learned site skills: discovery and manifest loading.
 *
 * Contract ported from ego-lite's learning subsystem so an existing
 * `learnings/` directory works unchanged:
 *
 *   learnings/<site-id>/
 *     manifest.json      { id, name, domains[], notes[], nodeTools{}, browserTools{} }
 *     notes/*.md         prose the agent reads before acting
 *     tools/*.js         node-side helpers, ESM, exported under `callable`
 *     browser-tools/*.js page-side helpers, evaluated in the page
 */

/** Where learnings live. ARAGON_AGENT_WORKSPACE overrides for tests. */
export function learningsRoot(workspace = agentWorkspace()) {
  return path.join(workspace, "learnings");
}

export function agentWorkspace() {
  const override = process.env.ARAGON_AGENT_WORKSPACE;
  if (override && override.trim()) return path.resolve(override.trim());
  return workspaceRoot();
}

export function urlHostname(url) {
  try {
    const parsed = String(url).includes("://")
      ? new URL(String(url))
      : new URL(`https://${url}`);
    return (parsed.hostname || "").toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/**
 * `example.com` matches that host exactly; `*.example.com` matches any subdomain
 * but NOT the apex. That is why real manifests list both - getting this wrong
 * means a site skill silently never loads on the bare domain.
 */
export function domainMatches(hostname, pattern) {
  const normalized = String(pattern || "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!normalized) return false;
  if (normalized.startsWith("*.")) {
    return hostname.endsWith(`.${normalized.slice(2)}`);
  }
  return hostname === normalized;
}

export async function pathExists(target) {
  try {
    await fs.promises.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Site directories, sorted, skipping `_drafts` style entries. */
export async function iterLearningDirs(root) {
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function toolSchemas(manifest, key) {
  const value = manifest?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

export async function loadLearningManifest(siteDir) {
  let parsed;
  try {
    parsed = JSON.parse(
      await fs.promises.readFile(path.join(siteDir, "manifest.json"), "utf8"),
    );
  } catch (error) {
    throw new Error(
      `site skill ${JSON.stringify(siteDir)} has invalid or missing manifest.json: ${error.message}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`site skill ${JSON.stringify(siteDir)} manifest must be an object`);
  }
  return parsed;
}

export function learningEntry(siteDir, manifest) {
  const notes = Array.isArray(manifest.notes) ? manifest.notes : [];
  const dirName = siteDir.split(/[\\/]/).at(-1);
  return {
    id: manifest.id || dirName,
    name: manifest.name || manifest.id || dirName,
    path: siteDir,
    domains: Array.isArray(manifest.domains) ? [...manifest.domains] : [],
    notes: notes.map((note) => path.join(siteDir, note)),
    nodeTools: toolSchemas(manifest, "nodeTools"),
    browserTools: toolSchemas(manifest, "browserTools"),
  };
}

/** Every site skill whose `domains` matches this URL, in directory order. */
export async function siteSkillsForUrl(url, options = {}) {
  const hostname = urlHostname(url);
  if (!hostname) return [];
  const root = options.root || learningsRoot(options.agentWorkspace);
  const matches = [];
  for (const siteDir of await iterLearningDirs(root)) {
    let manifest;
    try {
      manifest = await loadLearningManifest(siteDir);
    } catch {
      continue;
    }
    const domains = Array.isArray(manifest.domains) ? manifest.domains : [];
    if (domains.some((domain) => domainMatches(hostname, domain))) {
      matches.push(learningEntry(siteDir, manifest));
    }
  }
  return matches;
}

export async function checkDomainLearningExists(url, options = {}) {
  const matches = await siteSkillsForUrl(url, options);
  return matches.length > 0;
}

/**
 * Resolve a manifest-declared relative path, refusing anything that escapes the
 * site directory. A site skill is data plus code from possibly an untrusted
 * source, so `../` and absolute paths must be rejected, not normalised away.
 */
export function relativeSitePath(siteDir, manifestPath, label) {
  if (typeof manifestPath !== "string" || !manifestPath.trim()) {
    throw new Error(`${label} path must be a non-empty relative path`);
  }
  if (
    manifestPath.includes("\\") ||
    path.isAbsolute(manifestPath) ||
    manifestPath.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw new Error(`${label} path must be relative to the site skill directory`);
  }
  const resolved = path.resolve(siteDir, manifestPath);
  const siteRoot = path.resolve(siteDir);
  if (resolved !== siteRoot && !resolved.startsWith(`${siteRoot}${path.sep}`)) {
    throw new Error(`${label} path must stay inside the site skill directory`);
  }
  return resolved;
}

/** A note must be exactly `notes/<name>.md`, nothing else. */
export function isLearningNotePath(siteDir, notePath) {
  const relativePath = path.relative(path.resolve(siteDir), path.resolve(notePath));
  const parts = relativePath.split(/[\\/]/);
  return (
    parts.length === 2 &&
    parts[0] === "notes" &&
    parts[1].endsWith(".md") &&
    parts.every((part) => part && part !== "." && part !== "..")
  );
}
