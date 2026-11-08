import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { startFixture } from "./fixture-server.mjs";

/**
 * Verifies the PACKAGED app, not the dev tree.
 *
 * Everything that breaks only after packaging shows up here and nowhere else:
 * ESM inside app.asar, learnings living in resources/, the CLI bundle path, and
 * the first-run shim. A green dev smoke plus a broken installer is the exact
 * failure this script exists to catch.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
// `dist2` is accepted because antivirus can hold a lock on a freshly written
// `dist/` and the build then has to be redirected elsewhere.
const EXE = [
  path.join(ROOT, "dist", "win-unpacked", "aragon-browser.exe"),
  path.join(ROOT, "dist2", "win-unpacked", "aragon-browser.exe"),
].find((candidate) => fs.existsSync(candidate)) ?? path.join(ROOT, "dist", "win-unpacked", "aragon-browser.exe");
const RUNTIME_FILE = path.join(
  os.tmpdir(),
  "aragon-browser-packaged",
  `runtime-${process.pid}.json`,
);
const SCRATCH = path.join(os.tmpdir(), "aragon-packaged-scratch");
const LOCALAPPDATA = path.join(SCRATCH, "localappdata");
const SCRATCH_HOME = path.join(SCRATCH, "home");

let harnessPasses = 0;
function log(line) {
  if (line.startsWith("PASS")) harnessPasses += 1;
  process.stdout.write(`${line}\n`);
}

function runCli(source) {
  const cli = path.join(ROOT, "bin", "aragon-browser.cjs");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "nodejs"], {
      cwd: ROOT,
      env: { ...process.env, ARAGON_RUNTIME_FILE: RUNTIME_FILE },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(source);
  });
}

async function waitFor(predicate, { timeoutMs = 60_000, intervalMs = 250, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  if (!fs.existsSync(EXE)) {
    log(`FAIL packaged app not found at ${EXE} - run \`npm run dist\` first`);
    process.exitCode = 1;
    return;
  }
  log(`packaged app: ${EXE}`);

  fs.rmSync(path.dirname(RUNTIME_FILE), { recursive: true, force: true });
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(LOCALAPPDATA, { recursive: true });
  fs.mkdirSync(SCRATCH_HOME, { recursive: true });
  // A host directory must exist inside the scratch home for setup to install
  // the agent skill; that is what proves the ARAGON_HOME redirect works.
  fs.mkdirSync(path.join(SCRATCH_HOME, ".claude"), { recursive: true });

  const fixture = await startFixture();
  log(`fixture on ${fixture.baseUrl}`);

  const appOut = [];
  const child = spawn(EXE, ["--disable-gpu"], {
    cwd: path.dirname(EXE),
    env: {
      ...process.env,
      ARAGON_RUNTIME_FILE: RUNTIME_FILE,
      // Redirect first-run setup into a scratch dir so the test never touches
      // the real user profile or the real PATH.
      LOCALAPPDATA,
      // The home directory matters too: first-run setup writes agent skill
      // folders, and a test must never write into the real profile.
      ARAGON_HOME: SCRATCH_HOME,
      ARAGON_DEBUG: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    appOut.push(String(chunk));
    process.stdout.write(`[app] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    appOut.push(String(chunk));
    process.stderr.write(`[app:err] ${chunk}`);
  });

  const cleanup = async () => {
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      setTimeout(resolve, 4000);
    });
    await fixture.close();
    fs.rmSync(path.dirname(RUNTIME_FILE), { recursive: true, force: true });
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  };

  try {
    await waitFor(() => fs.existsSync(RUNTIME_FILE), { label: "runtime coordinates from the packaged app" });
    const coordinates = JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8"));
    log(`PASS packaged app published runtime on port ${coordinates.port}`);
    if (coordinates.packaged !== true) {
      throw new Error("runtime says it is not packaged; this is not testing the installer build");
    }
    log("PASS runtime reports packaged=true (asar + resources load correctly)");

    // The first-run shim is the whole point of an installed app.
    const shimDir = path.join(LOCALAPPDATA, "aragon-browser", "bin");
    const shim = path.join(shimDir, "aragon-browser.cmd");
    await waitFor(() => fs.existsSync(shim), { label: "first-run CLI shim" });
    log(`PASS first-run setup installed ${path.relative(LOCALAPPDATA, shim)}`);
    const shimText = fs.readFileSync(shim, "utf8");
    if (!shimText.includes("aragon-browser.cjs")) {
      throw new Error(`the shim does not point at the bundled CLI:\n${shimText}`);
    }
    log("PASS the shim points at the bundled CLI inside resources");

    // Prove the home redirect positively: create a host directory inside the
    // scratch home and require the skill to land THERE. Asserting "the real
    // profile is untouched" cannot work, because a genuine install legitimately
    // puts the same file in the real profile - absence proves nothing.
    const scratchHost = path.join(SCRATCH_HOME, ".claude");
    const scratchSkill = path.join(scratchHost, "skills", "aragon-browser", "SKILL.md");
    await waitFor(() => fs.existsSync(scratchSkill), { label: "agent skill in the scratch home" });
    log(`PASS agent skill installed under the redirected home (${path.relative(SCRATCH_HOME, scratchSkill)})`);

    // A skill file with no frontmatter sits in ~/.claude/skills and is never
    // discovered: the CLI works, the agent just never learns it exists.
    const entry = fs.readFileSync(scratchSkill, "utf8");
    if (!/^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(entry)) {
      throw new Error("the installed SKILL.md has no YAML frontmatter; agents cannot discover it");
    }
    if (!/^name:\s*aragon-browser\s*$/m.test(entry)) {
      throw new Error("the installed SKILL.md has no `name: aragon-browser` frontmatter field");
    }
    if (!/^description:\s*\S/m.test(entry)) {
      throw new Error("the installed SKILL.md has no description; an agent cannot decide when to use it");
    }
    log("PASS the installed skill is discoverable (valid frontmatter, name + description)");

    // The references and site skills travel with it.
    const installedSkillDir = path.dirname(scratchSkill);
    for (const part of ["references/install.md", "references/troubleshooting.md", "learnings"]) {
      if (!fs.existsSync(path.join(installedSkillDir, part))) {
        throw new Error(`the installed skill is missing ${part}`);
      }
    }
    log("PASS references and learnings shipped alongside the entry skill");

    // Learnings must resolve from resources, not from the dev tree.
    const script = `
      const version = await browserVersion();
      cliLog('VERSION ' + JSON.stringify(version));
      const learned = await listLearnedSites();
      if (!learned.sites.some((s) => s.id === 'aragon-fixture')) {
        throw new Error('learnings were not found in the packaged app: ' + JSON.stringify(learned));
      }
      cliLog('PASS packaged app found ' + learned.sites.length + ' learned site(s) at ' + learned.root);
      cliLog('VERSION ' + JSON.stringify(version));
      if (version.packaged !== true) throw new Error('runtime.version does not report packaged=true');
      if (version.learnedSites !== learned.sites.length) {
        throw new Error('runtime.version learnedSites disagrees with listLearnedSites');
      }
      cliLog('PASS runtime.version reports packaged state and a real learned-site count');
      const space = await taskSpace('packaged');
      const page = await space.newPage(${JSON.stringify(fixture.baseUrl)});
      await page.waitForLoad({ timeoutMs: 20000 });
      const shot = await page.snapshot();
      if (!shot.refs.some((r) => r.sessionId !== 'root')) {
        throw new Error('cross-site iframe was not flattened in the packaged app');
      }
      cliLog('PASS packaged snapshot flattened the cross-site frame (' + shot.refCount + ' refs)');
      await page.fill('css:#email', 'packaged@example.com');
      await page.click('loc=role:button[name="Continue"]');
      const result = await page.evaluate("document.getElementById('result').textContent");
      if (result !== 'clicked:packaged@example.com') {
        throw new Error('click/fill did not work in the packaged app: ' + result);
      }
      cliLog('PASS packaged app click+fill changed the real DOM');
      await page.screenshot({ save: 'artifacts/packaged.png' });
      cliLog('DONE packaged');
    `;
    const result = await runCli(script);
    if (result.code !== 0) {
      log(`\nFAIL cli against the packaged app exited ${result.code}`);
      log(appOut.join("").slice(-4000));
      process.exitCode = 1;
      return;
    }
    const passes = result.stdout.split("\n").filter((line) => line.startsWith("PASS")).length;
    log(`\nPACKAGED OK - ${harnessPasses + passes} checks passed against the installed build`);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  process.stderr.write(`packaged smoke failed: ${error?.message ?? error}\n`);
  process.exitCode = 1;
});
