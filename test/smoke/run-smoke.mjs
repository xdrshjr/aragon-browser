import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { startFixture } from "./fixture-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const RUNTIME_FILE = path.join(os.tmpdir(), "aragon-browser-smoke", `runtime-${process.pid}.json`);
// Everything this run writes lives under one scratch root, so a test can never
// touch the real profile.
const SMOKE_ROOT = path.dirname(RUNTIME_FILE);
// The app takes a single-instance lock per userData directory. Without this the
// smoke run silently fails ("timed out waiting for runtime coordinates") whenever
// the human has an aragon-browser open - including the very build you just made.
// A scratch userData dir also keeps the test out of the real profile.
const USER_DATA = path.join(SMOKE_ROOT, `userdata-${process.pid}`);

function log(line) {
  process.stdout.write(`${line}\n`);
}

async function waitFor(predicate, { timeoutMs = 40_000, intervalMs = 250, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function runCli(source) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "src", "cli", "index.js"), "nodejs"], {
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

async function main() {
  fs.rmSync(path.dirname(RUNTIME_FILE), { recursive: true, force: true });
  // A fresh userData dir means the first-run dialog would pop up mid-test and
  // steal focus from the window the UI check captures. The marker is the same
  // file ensureSetup() writes, so pre-creating it just says "announced already".
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.writeFileSync(path.join(USER_DATA, ".setup-complete"), new Date().toISOString());
  const fixture = await startFixture(0, path.join(ROOT, "artifacts"));
  log(`fixture on ${fixture.baseUrl}`);

  const appOut = [];
  const electron = spawn(electronPath, [ROOT, "--disable-gpu", `--user-data-dir=${USER_DATA}`], {
    cwd: ROOT,
    env: {
      ...process.env,
      ARAGON_RUNTIME_FILE: RUNTIME_FILE,
      // First-run setup writes the CLI shim into LOCALAPPDATA and copies the agent
      // skill into ~/.claude, ~/.codex and ~/.cursor. Point both at scratch dirs:
      // the comment on USER_DATA above would otherwise be a lie, and a test must
      // never rewrite the developer's real profile.
      LOCALAPPDATA: path.join(SMOKE_ROOT, "localappdata"),
      ARAGON_HOME: path.join(SMOKE_ROOT, "home"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  electron.stdout.on("data", (chunk) => {
    const text = String(chunk);
    appOut.push(text);
    process.stdout.write(`[app] ${text}`);
  });
  electron.stderr.on("data", (chunk) => {
    const text = String(chunk);
    appOut.push(text);
    process.stderr.write(`[app:err] ${text}`);
  });

  const cleanup = async () => {
    await new Promise((resolve) => {
      if (electron.exitCode !== null) return resolve();
      electron.once("exit", resolve);
      // Electron spawns helper processes; on Windows a tree kill is required.
      spawn("taskkill", ["/pid", String(electron.pid), "/T", "/F"], { stdio: "ignore" });
      setTimeout(resolve, 3000);
    });
    await fixture.close();
    fs.rmSync(path.dirname(RUNTIME_FILE), { recursive: true, force: true });
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  };

  try {
    await waitFor(() => fs.existsSync(RUNTIME_FILE), { label: "runtime coordinates" });
    const coordinates = JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8"));
    log(`browser published port ${coordinates.port} (pid ${coordinates.pid})`);

    const scriptName = process.argv[2] || "agent-script.js";
    // The sweep happens when the CLI exits, so proving it needs more than one
    // process: phase 1 leaves tabs open, phase 2 checks they are gone and opens one
    // kept + one unkept tab, phase 3 checks which of the two survived.
    const extraScripts =
      scriptName === "agent-script.js" ? ["sweep-check.js", "sweep-verify.js"] : [];
    let passes = 0;

    for (const name of [scriptName, ...extraScripts]) {
      const template = fs.readFileSync(path.join(__dirname, name), "utf8");
      const source = template
        .replaceAll("FIXTURE_URL", JSON.stringify(fixture.baseUrl))
        .replaceAll("UPLOAD_FILE", JSON.stringify(fixture.uploadFile));
      const result = await runCli(source);

      if (result.code !== 0) {
        log(`\nFAIL ${name}: cli exited ${result.code}`);
        log(appOut.join("").slice(-4000));
        process.exitCode = 1;
        return;
      }
      if (!/^DONE /m.test(result.stdout)) {
        log(`\nFAIL ${name} finished without reaching the DONE marker`);
        process.exitCode = 1;
        return;
      }
      passes += result.stdout.split("\n").filter((line) => line.startsWith("PASS")).length;
    }
    log(`\nSMOKE OK - ${passes} checks passed against the real browser`);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  process.stderr.write(`smoke failed: ${error?.message ?? error}\n`);
  process.exitCode = 1;
});
