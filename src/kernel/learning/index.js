import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkDomainLearningExists,
  isLearningNotePath,
  iterLearningDirs,
  learningsRoot,
  loadLearningManifest,
  relativeSitePath,
  siteSkillsForUrl,
  urlHostname,
} from "./manifest.js";

export {
  checkDomainLearningExists,
  isLearningNotePath,
  iterLearningDirs,
  learningsRoot,
  loadLearningManifest,
  relativeSitePath,
  siteSkillsForUrl,
  urlHostname,
};
export { validateLearning, validateLearnings, validateSiteSkills } from "./validate.js";

/**
 * Everything the agent should know about a site before acting: the notes, and
 * the tool signatures with a ready-to-paste call example.
 */
export async function loadLearnedContext(url, options = {}) {
  const matches = await siteSkillsForUrl(url, options);
  if (matches.length === 0) {
    return {
      exists: false,
      siteId: null,
      siteName: null,
      domain: urlHostname(url),
      knowledge: [],
      tools: [],
    };
  }

  const knowledge = [];
  const tools = [];
  for (const entry of matches) {
    for (const notePath of entry.notes) {
      if (!isLearningNotePath(entry.path, notePath)) continue;
      let content;
      try {
        content = await fs.promises.readFile(notePath, "utf8");
      } catch {
        continue;
      }
      knowledge.push({
        siteId: entry.id,
        fileName: notePath.split(/[\\/]/).pop() || "",
        content,
      });
    }
    for (const [toolName, schema] of Object.entries(entry.nodeTools)) {
      tools.push({
        siteId: entry.id,
        toolName,
        toolType: "node",
        description: schema.description || "",
        args: schema.args || {},
        example: `await runSiteTool("${entry.id}", "${toolName}", { ... })`,
      });
    }
    for (const [toolName, schema] of Object.entries(entry.browserTools)) {
      tools.push({
        siteId: entry.id,
        toolName,
        toolType: "browser",
        description: schema.description || "",
        args: schema.args || {},
        example: `await runSiteBrowserTool("${entry.id}", "${toolName}", { ... })`,
      });
    }
  }

  return {
    exists: true,
    siteId: matches[0].id,
    siteName: matches[0].name,
    domain: urlHostname(url),
    knowledge,
    tools,
  };
}

export async function findSiteSkill(siteId, options = {}) {
  const root = options.root || learningsRoot(options.agentWorkspace);
  for (const siteDir of await iterLearningDirs(root)) {
    const manifest = await loadLearningManifest(siteDir);
    if (manifest.id === siteId) return { siteDir, manifest };
  }
  const workspace = process.env.ARAGON_AGENT_WORKSPACE || "unset";
  throw new Error(
    [
      `site skill not found: ${JSON.stringify(siteId)}`,
      `  searched: ${root}`,
      `  ARAGON_AGENT_WORKSPACE: ${workspace}`,
    ].join("\n"),
  );
}

function declaredSchema(manifest, key, toolName, siteId, label) {
  const value = manifest[key] || {};
  const schema =
    value && typeof value === "object" && !Array.isArray(value)
      ? value[toolName]
      : undefined;
  if (!schema || typeof schema !== "object") {
    throw new Error(
      `${label} ${JSON.stringify(toolName)} is not declared by site skill ${JSON.stringify(siteId)}`,
    );
  }
  return schema;
}

/**
 * Run a node-side site tool. The tool gets `ctx` (the live helper context) plus
 * its declared args: this is the mechanism that lets a learned skill do real
 * multi-step browser work instead of just printing advice.
 */
export async function runNodeSiteTool(siteId, toolName, args = {}, ctx, options = {}) {
  const { siteDir, manifest } = await findSiteSkill(siteId, options);
  const schema = declaredSchema(manifest, "nodeTools", toolName, siteId, "Node tool");
  const toolPath = relativeSitePath(siteDir, schema.path, "Node tool");
  const module = await import(`${pathToFileURL(toolPath).href}?t=${Date.now()}`);
  if (typeof schema.callable !== "string" || !schema.callable.trim()) {
    throw new Error(`Node tool ${JSON.stringify(toolName)} must declare a callable`);
  }
  const tool = module[schema.callable];
  if (typeof tool !== "function") {
    throw new Error(
      `site skill ${JSON.stringify(siteId)} is missing Node callable ${JSON.stringify(schema.callable)}`,
    );
  }
  return tool(ctx, args || {});
}

export async function loadBrowserToolSource(siteId, toolName, options = {}) {
  const { siteDir, manifest } = await findSiteSkill(siteId, options);
  const schema = declaredSchema(
    manifest,
    "browserTools",
    toolName,
    siteId,
    "browser tool",
  );
  const toolPath = relativeSitePath(siteDir, schema.path, "browser tool");
  return fs.promises.readFile(toolPath, "utf8");
}

/**
 * A browser tool is a function expression evaluated in the page. Wrapping it in
 * an async IIFE with the args baked in means the page never sees our variables
 * and the tool can await its own fetches.
 */
export function wrapBrowserTool(source, args = {}) {
  return `(async () => { const __aragonBrowserTool = ${source}; return await __aragonBrowserTool(${JSON.stringify(args || {})}); })()`;
}

export { path, pathToFileURL };
