import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { app } from "electron";

/**
 * First-run setup: put a working `aragon-browser` command on the user's PATH.
 *
 * Design constraints that matter more than convenience:
 *  - never write outside our own directory unless the user explicitly agrees;
 *  - never silently edit PATH. A browser that mutates the user's environment
 *    during onboarding is indistinguishable from malware, so this writes a
 *    shim into `%LOCALAPPDATA%\aragon-browser\bin` and tells the user exactly
 *    which line to add, offering the edit only when they ask for it;
 *  - be idempotent, so running setup twice does not append twice.
 */

const APP_DIR_NAME = "aragon-browser";

export function installRoot() {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.XDG_DATA_HOME ||
    path.join(os.homedir(), ".local", "share");
  return path.join(base, APP_DIR_NAME);
}

export function binDir() {
  return path.join(installRoot(), "bin");
}

/** Where the bundled CLI lives, resolved for both dev and packaged layouts. */
export function sourceCliPath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "cli", "aragon-browser.cjs"),
        path.join(process.resourcesPath, "app", "bin", "aragon-browser.cjs"),
        path.join(app.getAppPath(), "bin", "aragon-browser.cjs"),
      ]
    : [path.join(app.getAppPath(), "bin", "aragon-browser.cjs")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The agent-facing skill directory (`skills/aragon-browser`).
 *
 * This is the THIN entry skill agents discover, not the full guide printed by
 * `aragon-browser skill`. Both are needed: the entry file has the frontmatter an
 * agent scans to decide whether to load anything at all, and it points at the
 * versioned guide for the actual API.
 */
export function sourceAgentSkillDir() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "skills", "aragon-browser"),
        path.join(process.resourcesPath, "skills"),
        path.join(app.getAppPath(), "skills", "aragon-browser"),
      ]
    : [path.join(app.getAppPath(), "skills", "aragon-browser")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "SKILL.md"))) return candidate;
  }
  return null;
}

/** Where the CLI's printed guide lives (skill-body/SKILL.md). */
export function sourceSkillDir() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "cli", "skill-body"),
        path.join(app.getAppPath(), "bin", "skill-body"),
      ]
    : [path.join(app.getAppPath(), "bin", "skill-body")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "SKILL.md"))) return candidate;
  }
  return null;
}

function shimContents(scriptPath) {
  if (process.platform === "win32") {
    // A .cmd that finds a Node runtime. Electron's bundled node is used as a
    // fallback so the CLI works even on a machine with no Node installed.
    return [
      "@echo off",
      "setlocal",
      `set "ARAGON_CLI=${scriptPath}"`,
      "if exist \"%ARAGON_CLI%\" goto havecli",
      "echo aragon-browser: CLI bundle missing at %ARAGON_CLI% 1>&2",
      "exit /b 1",
      ":havecli",
      "where node >nul 2>nul",
      "if errorlevel 1 goto electronnode",
      "node \"%ARAGON_CLI%\" %*",
      "exit /b %errorlevel%",
      ":electronnode",
      `if exist "${process.execPath}" (`,
      // Run Electron's bundled Node, not the browser: a packaged Electron binary
      // ignores a script argument, boots the app instead, hits the single-instance
      // lock and exits 0 - so the CLI would silently do nothing.
      '  set "ELECTRON_RUN_AS_NODE=1"',
      `  "${process.execPath}" "${scriptPath}" %*`,
      "  exit /b %errorlevel%",
      ")",
      "echo aragon-browser: no Node runtime found and the bundled runtime is missing 1>&2",
      "exit /b 1",
      "",
    ].join("\r\n");
  }
  return [
    "#!/bin/sh",
    "set -e",
    `ARAGON_CLI="${scriptPath}"`,
    'if [ ! -f "$ARAGON_CLI" ]; then',
    '  echo "aragon-browser: CLI bundle missing at $ARAGON_CLI" >&2',
    "  exit 1",
    "fi",
    'exec node "$ARAGON_CLI" "$@"',
    "",
  ].join("\n");
}

/**
 * @returns {{ok: boolean, dir: string, command: string, onPath: boolean, message: string}}
 */
export function installCliShim() {
  const scriptPath = sourceCliPath();
  const dir = binDir();
  if (!scriptPath) {
    return {
      ok: false,
      dir,
      command: null,
      onPath: false,
      message:
        "the bundled CLI was not found in this install; run `npm run build:cli` before packaging",
    };
  }
  fs.mkdirSync(dir, { recursive: true });
  const command =
    process.platform === "win32"
      ? path.join(dir, "aragon-browser.cmd")
      : path.join(dir, "aragon-browser");
  fs.writeFileSync(command, shimContents(scriptPath), { mode: 0o755 });
  if (process.platform !== "win32") fs.chmodSync(command, 0o755);

  const pathEntries = (process.env.PATH || "")
    .split(path.delimiter)
    .map((entry) => entry.replace(/[\\/]+$/, "").toLowerCase());
  const onPath = pathEntries.includes(dir.replace(/[\\/]+$/, "").toLowerCase());

  return {
    ok: true,
    dir,
    command,
    onPath,
    message: onPath
      ? `${command} is ready and already on PATH`
      : `${command} is ready; add ${dir} to PATH to run it from any terminal`,
  };
}

/**
 * Copy the agent-facing entry skill into every detected agent's skill directory.
 *
 * The entry skill (with frontmatter) is what makes the browser discoverable; the
 * full API guide is printed on demand by `aragon-browser skill` so it always
 * matches the running build.
 */
export function installAgentSkill(agentDirs = defaultAgentSkillDirs()) {
  const skillDir = sourceAgentSkillDir();
  if (!skillDir) {
    return { installed: [], skipped: "skills/aragon-browser not found in this install" };
  }
  const installed = [];
  for (const parent of agentDirs) {
    const target = path.join(parent, "aragon-browser");
    try {
      fs.mkdirSync(parent, { recursive: true });
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(skillDir, target, { recursive: true });
      installed.push(target);
    } catch {
      // A directory we cannot write (permissions, read-only home) is skipped,
      // not fatal: the browser still works without an agent skill file.
    }
  }
  return { installed };
}

/** Common agent skill directories. Existing hosts only; we do not invent hosts. */
export function defaultAgentSkillDirs() {
  // Respect HOME/USERPROFILE overrides so tests and sandboxes never write into
  // the real user profile. `os.homedir()` ignores those on some platforms.
  const home =
    process.env.ARAGON_HOME || process.env.HOME || process.env.USERPROFILE || os.homedir();
  const candidates = [
    path.join(home, ".claude", "skills"),
    path.join(home, ".codex", "skills"),
    path.join(home, ".cursor", "skills"),
    path.join(home, ".config", "agents", "skills"),
  ];
  return candidates.filter((dir) => {
    try {
      // The host's config directory must already exist: an agent that is not
      // installed should not get a skills folder created for it.
      return fs.statSync(path.dirname(dir)).isDirectory();
    } catch {
      return false;
    }
  });
}

/** Add our bin dir to the user's PATH (opt-in only). */
export function addToUserPath() {
  if (process.platform !== "win32") {
    return {
      ok: false,
      message:
        "on this platform, add the directory to your shell profile: export PATH=\"$PATH:" +
        binDir() +
        '"',
    };
  }
  const result = spawnSetx(binDir());
  return result;
}

function spawnSetx(dir) {
  const current = process.env.PATH || "";
  const next = current.includes(dir) ? current : `${dir}${path.delimiter}${current}`;
  try {
    // setx truncates at 1024 chars on older Windows; warn instead of corrupting.
    if (next.length > 1023) {
      return {
        ok: false,
        message:
          `PATH is ${next.length} characters; setx would truncate it. Add this manually: ${dir}`,
      };
    }
    execFileSync("setx", ["PATH", next], { stdio: "ignore" });
    return { ok: true, message: `added ${dir} to the user PATH; reopen your terminal` };
  } catch (error) {
    return { ok: false, message: `could not update PATH: ${error.message}. Add this manually: ${dir}` };
  }
}
