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
  const fixture = await startFixture(0, path.join(ROOT, "artifacts"));
  log(`fixture on ${fixture.baseUrl}`);

  const appOut = [];
  const electron = spawn(electronPath, [ROOT, "--disable-gpu"], {
    cwd: ROOT,
    env: { ...process.env, ARAGON_RUNTIME_FILE: RUNTIME_FILE },
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
  };

  try {
    await waitFor(() => fs.existsSync(RUNTIME_FILE), { label: "runtime coordinates" });
    const coordinates = JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8"));
    log(`browser published port ${coordinates.port} (pid ${coordinates.pid})`);

    const scriptName = process.argv[2] || "agent-script.js";
    const template = fs.readFileSync(path.join(__dirname, scriptName), "utf8");
    const source = template
      .replaceAll("FIXTURE_URL", JSON.stringify(fixture.baseUrl))
      .replaceAll("UPLOAD_FILE", JSON.stringify(fixture.uploadFile));
    const result = await runCli(source);

    if (result.code !== 0) {
      log(`\nFAIL cli exited ${result.code}`);
      log(appOut.join("").slice(-4000));
      process.exitCode = 1;
      return;
    }
    if (!/^DONE /m.test(result.stdout)) {
      log("\nFAIL script finished without reaching the DONE marker");
      process.exitCode = 1;
      return;
    }
    const passes = result.stdout.split("\n").filter((line) => line.startsWith("PASS")).length;
    log(`\nSMOKE OK - ${passes} checks passed against the real browser`);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  process.stderr.write(`smoke failed: ${error?.message ?? error}\n`);
  process.exitCode = 1;
});
