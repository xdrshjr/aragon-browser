import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  domainMatches,
  isLearningNotePath,
  learningsRoot,
  loadLearningManifest,
  relativeSitePath,
  siteSkillsForUrl,
  urlHostname,
} from "../src/kernel/learning/manifest.js";
import {
  loadLearnedContext,
  loadBrowserToolSource,
  runNodeSiteTool,
  wrapBrowserTool,
} from "../src/kernel/learning/index.js";
import { validateLearning, validateLearnings } from "../src/kernel/learning/validate.js";

// Site skills live inside the agent-facing skill directory (ego-lite layout).
const REPO_LEARNINGS = path.join(process.cwd(), "skills", "aragon-browser", "learnings");

test("domain matching: apex is exact, *. covers subdomains only", () => {
  assert.equal(domainMatches("x.com", "x.com"), true);
  assert.equal(domainMatches("www.x.com", "x.com"), false, "apex pattern is exact");
  assert.equal(domainMatches("www.x.com", "*.x.com"), true);
  assert.equal(domainMatches("x.com", "*.x.com"), false, "wildcard excludes the apex");
  assert.equal(domainMatches("evilx.com", "x.com"), false, "suffix must not match mid-label");
  assert.equal(domainMatches("a.b.x.com", "*.x.com"), true);
  assert.equal(domainMatches("x.com", ""), false);
});

test("urlHostname normalises scheme, case and trailing dot", () => {
  assert.equal(urlHostname("https://Example.COM./a"), "example.com");
  assert.equal(urlHostname("example.com/path"), "example.com");
  assert.equal(urlHostname("not a url"), "");
});

test("the bundled fixture learning validates clean", async () => {
  const errors = await validateLearnings(REPO_LEARNINGS);
  assert.deepEqual(errors, []);
});

test("a learning is found by any of its declared domains", async () => {
  for (const url of ["http://127.0.0.1:1234/", "http://localhost:1234/frame"]) {
    const matches = await siteSkillsForUrl(url, { root: REPO_LEARNINGS });
    assert.equal(matches.length, 1, `no match for ${url}`);
    assert.equal(matches[0].id, "aragon-fixture");
  }
  const none = await siteSkillsForUrl("https://example.com/", { root: REPO_LEARNINGS });
  assert.deepEqual(none, []);
});

test("loadLearnedContext surfaces notes and tool signatures", async () => {
  const context = await loadLearnedContext("http://localhost:9/", {
    root: REPO_LEARNINGS,
  });
  assert.equal(context.exists, true);
  assert.equal(context.siteId, "aragon-fixture");
  assert.equal(context.knowledge.length, 1);
  assert.match(context.knowledge[0].fileName, /^overview\.md$/);
  assert.match(context.knowledge[0].content, /Durable locators/);

  const nodeTool = context.tools.find((tool) => tool.toolName === "submit_email");
  assert.equal(nodeTool.toolType, "node");
  assert.match(nodeTool.example, /runSiteTool\("aragon-fixture", "submit_email"/);
  const browserTool = context.tools.find((tool) => tool.toolName === "form_state");
  assert.equal(browserTool.toolType, "browser");
  assert.match(browserTool.example, /runSiteBrowserTool/);
});

test("a missing site yields exists:false rather than throwing", async () => {
  const context = await loadLearnedContext("https://nope.invalid/", {
    root: REPO_LEARNINGS,
  });
  assert.equal(context.exists, false);
  assert.deepEqual(context.knowledge, []);
  assert.deepEqual(context.tools, []);
});

test("node tool paths cannot escape the site directory", () => {
  const siteDir = path.join(REPO_LEARNINGS, "aragon-fixture");
  assert.throws(() => relativeSitePath(siteDir, "../evil.js", "Node tool"), /relative/);
  assert.throws(() => relativeSitePath(siteDir, "tools\\evil.js", "Node tool"), /relative/);
  assert.throws(() => relativeSitePath(siteDir, "/etc/passwd", "Node tool"), /relative/);
  assert.throws(() => relativeSitePath(siteDir, "", "Node tool"), /non-empty/);
  assert.match(
    relativeSitePath(siteDir, "tools/read-email.js", "Node tool"),
    /read-email\.js$/,
  );
});

test("only notes/<name>.md counts as a note path", () => {
  const siteDir = path.join(REPO_LEARNINGS, "aragon-fixture");
  assert.equal(isLearningNotePath(siteDir, path.join(siteDir, "notes", "a.md")), true);
  assert.equal(isLearningNotePath(siteDir, path.join(siteDir, "notes", "a.txt")), false);
  assert.equal(isLearningNotePath(siteDir, path.join(siteDir, "a.md")), false);
  assert.equal(
    isLearningNotePath(siteDir, path.join(siteDir, "notes", "sub", "a.md")),
    false,
  );
});

test("browser tools are wrapped so the page cannot see our scope", async () => {
  const source = await loadBrowserToolSource("aragon-fixture", "form_state", {
    root: REPO_LEARNINGS,
  });
  const wrapped = wrapBrowserTool(source, { a: 1 });
  assert.match(wrapped, /^\(async \(\) => \{/);
  assert.match(wrapped, /__aragonBrowserTool/);
  assert.match(wrapped, /\{"a":1\}/);
});

test("declaring a tool the manifest does not know is an error", async () => {
  await assert.rejects(
    () =>
      runNodeSiteTool("aragon-fixture", "no_such_tool", {}, {}, { root: REPO_LEARNINGS }),
    /not declared by site skill/,
  );
  await assert.rejects(
    () => runNodeSiteTool("no-such-site", "x", {}, {}, { root: REPO_LEARNINGS }),
    /site skill not found/,
  );
});

test("node tools run with the live context and their args", async () => {
  // A fake page object: the tool only needs evaluate/fill/click.
  const calls = [];
  const fakeBox = {
    async evaluate(expression) {
      calls.push(["evaluate", expression]);
      return "agent@example.com";
    },
    async fill(locator, value) {
      calls.push(["fill", locator, value]);
    },
    async click(locator) {
      calls.push(["click", locator]);
    },
  };
  const value = await runNodeSiteTool(
    "aragon-fixture",
    "read_email_field",
    {},
    { box: fakeBox },
    { root: REPO_LEARNINGS },
  );
  assert.equal(value, "agent@example.com");

  const submitted = await runNodeSiteTool(
    "aragon-fixture",
    "submit_email",
    { email: "a@b.c" },
    { box: fakeBox },
    { root: REPO_LEARNINGS },
  );
  assert.equal(submitted.filled, "a@b.c");
  // Order matters: fill then click, and the page is read afterwards.
  const fillIndex = calls.findIndex((call) => call[0] === "fill");
  const clickIndex = calls.findIndex((call) => call[0] === "click");
  assert.deepEqual(calls[fillIndex], ["fill", "css:#email", "a@b.c"]);
  assert.deepEqual(calls[clickIndex], ["click", 'loc=role:button[name="Continue"]']);
  assert.ok(fillIndex < clickIndex, "the tool must fill before it clicks");
});

// ---------------------------------------------------------------------------
// validator: every rule, exercised against a throwaway site
// ---------------------------------------------------------------------------

async function tempSite(manifest, files = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "aragon-learn-"));
  const siteDir = path.join(root, "site");
  await fs.promises.mkdir(siteDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(siteDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(siteDir, relative);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, content);
  }
  return { root, siteDir };
}

const minimalManifest = {
  id: "site",
  name: "Site",
  domains: ["example.com"],
};

test("validator: id must match the directory name", async () => {
  const { siteDir } = await tempSite({ ...minimalManifest, id: "other" });
  const errors = await validateLearning(siteDir);
  assert.match(errors.join("\n"), /id must match directory name/);
});

test("validator: name, domains and domain syntax", async () => {
  const { siteDir } = await tempSite({
    id: "site",
    name: "  ",
    domains: ["https://example.com/x", "a.*.com", "*"],
  });
  const errors = (await validateLearning(siteDir)).join("\n");
  assert.match(errors, /name must be a non-empty string/);
  assert.match(errors, /invalid domain/);
});

test("validator: notes must exist and be notes/*.md", async () => {
  const { siteDir } = await tempSite({
    ...minimalManifest,
    notes: ["notes/missing.md", "wrong.txt"],
  });
  const errors = (await validateLearning(siteDir)).join("\n");
  assert.match(errors, /notes must point to notes\/\*\.md/);
  assert.match(errors, /missing note/);
});

test("validator: a note holding a temporary ref is rejected", async () => {
  const { siteDir } = await tempSite(
    { ...minimalManifest, notes: ["notes/a.md"] },
    { "notes/a.md": "Click @12 to continue.\n" },
  );
  const errors = (await validateLearning(siteDir)).join("\n");
  assert.match(errors, /temporary snapshot ref/);
});

test("validator: node tool needs a callable, an existing file and that export", async () => {
  const manifest = {
    ...minimalManifest,
    nodeTools: {
      missing_callable: {
        description: "x",
        path: "tools/a.js",
        args: {},
        returns: { type: "string", description: "x" },
      },
      missing_file: {
        description: "x",
        path: "tools/b.js",
        callable: "run",
        args: {},
        returns: { type: "string", description: "x" },
      },
      wrong_export: {
        description: "x",
        path: "tools/c.js",
        callable: "nope",
        args: {},
        returns: { type: "string", description: "x" },
      },
    },
  };
  const { siteDir } = await tempSite(manifest, {
    "tools/c.js": "export async function run() { return 1; }\n",
  });
  const errors = (await validateLearning(siteDir)).join("\n");
  assert.match(errors, /callable must be a non-empty string/);
  assert.match(errors, /missing Node tool file/);
  assert.match(errors, /missing Node callable/);
});

test("validator: arg types, required flags and bad tool names", async () => {
  const manifest = {
    ...minimalManifest,
    browserTools: {
      "bad/name": { description: "x", path: "browser-tools/a.js", args: {}, returns: { type: "string", description: "x" } },
      ok: {
        description: "x",
        path: "browser-tools/a.js",
        args: { q: { type: "null", required: "yes", description: "" } },
        returns: { type: "string" },
      },
    },
  };
  const { siteDir } = await tempSite(manifest, {
    "browser-tools/a.js": "() => 1;\n",
  });
  const errors = (await validateLearning(siteDir)).join("\n");
  assert.match(errors, /invalid tool name/);
  assert.match(errors, /invalid arg type/);
  assert.match(errors, /required must be a boolean/);
});

test("validator: browser tool path must be browser-tools/*.js", async () => {
  const manifest = {
    ...minimalManifest,
    browserTools: {
      bad: { description: "x", path: "tools/a.js", args: {}, returns: { type: "string", description: "x" } },
    },
  };
  const { siteDir } = await tempSite(manifest);
  const errors = (await validateLearning(siteDir)).join("\n");
  assert.match(errors, /browser-tools\/\*\.js/);
});

test("validator: unreadable manifest is reported, not thrown", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "aragon-learn-"));
  const siteDir = path.join(root, "broken");
  await fs.promises.mkdir(siteDir, { recursive: true });
  await fs.promises.writeFile(path.join(siteDir, "manifest.json"), "{ not json");
  const errors = await validateLearning(siteDir);
  assert.match(errors.join("\n"), /invalid or missing manifest\.json/);
  await assert.rejects(() => loadLearningManifest(siteDir), /invalid or missing/);
});

test("learningsRoot honours the workspace override", () => {
  const previous = process.env.ARAGON_AGENT_WORKSPACE;
  process.env.ARAGON_AGENT_WORKSPACE = path.join(os.tmpdir(), "ws");
  try {
    assert.equal(learningsRoot(), path.join(os.tmpdir(), "ws", "learnings"));
  } finally {
    if (previous === undefined) delete process.env.ARAGON_AGENT_WORKSPACE;
    else process.env.ARAGON_AGENT_WORKSPACE = previous;
  }
});
