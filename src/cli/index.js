#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { AragonError, ERROR_CODES, runtimeFilePath } from "../shared/protocol.js";
import { RuntimeClient } from "./transport-client.js";
import { createHelpers } from "./helpers.js";
import { runScript } from "./run.js";
import { renderHelp } from "../shared/public-api-schema.js";
import { skillBodyDir } from "../shared/paths.js";
import { describeSweep } from "./tab-cleanup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USAGE = `aragon-browser - drive the aragon nano browser from a script

Usage:
  aragon-browser [nodejs] [options]        read JavaScript from stdin and run it
  aragon-browser nodejs -e "<code>"        run inline code
  aragon-browser status                    runtime version and live spaces
  aragon-browser spaces                    list task spaces
  aragon-browser skill                     agent guide (helpers rendered from the schema)
  aragon-browser help-api                  the API surface only
  aragon-browser learn                     validate every installed site skill
  aragon-browser -h | --help               this text

Options:
  -e, --eval <code>      script source instead of stdin
  -s, --space <id|name>  select a task space before the script runs
      --keep-tabs        keep the tabs this script opened (default: close them)
      --runtime-file <p> coordinates file (default: %TEMP%\\aragon-browser\\runtime.json)
      --json             print the raw result object as JSON
`;

function parseArgs(argv) {
  const options = {
    command: null,
    evalCode: null,
    space: null,
    json: false,
    // Default: a script closes the tabs it opened. `--keep-tabs` (or the env var,
    // for a host that cannot pass flags) turns that off.
    keepTabs: process.env.ARAGON_KEEP_TABS === "1",
    runtimeFile: runtimeFilePath(),
  };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.command = "help";
      continue;
    }
    if (arg === "-e" || arg === "--eval") {
      options.evalCode = argv[++index] ?? "";
      continue;
    }
    if (arg === "-s" || arg === "--space") {
      options.space = argv[++index] ?? null;
      continue;
    }
    if (arg === "--keep-tabs") {
      options.keepTabs = true;
      continue;
    }
    if (arg === "--runtime-file") {
      options.runtimeFile = path.resolve(argv[++index] ?? "");
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--sdk-path") {
      // Accepted for compatibility with ego-browser invocations; ignored here.
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new AragonError(ERROR_CODES.INVALID_ARGUMENT, `unknown option ${arg}`);
    }
    rest.push(arg);
  }
  options.command = options.command ?? rest[0] ?? "nodejs";
  return options;
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (options.command === "skill") {
    // The guide is rendered from the schema, so it cannot drift from the runtime.
    process.stdout.write(fs.readFileSync(path.join(skillBodyDir(), "SKILL.md"), "utf8").replace(
      "<!-- HELP -->",
      renderHelp(),
    ));
    return 0;
  }
  if (options.command === "help-api") {
    process.stdout.write(`${renderHelp()}\n`);
    return 0;
  }
  if (options.command === "learn") {
    const { validateLearnings } = await import("../kernel/learning/validate.js");
    const errors = await validateLearnings();
    if (errors.length === 0) {
      process.stdout.write("all site skills valid\n");
      return 0;
    }
    process.stderr.write(`${errors.join("\n")}\n`);
    return 1;
  }

  const client = new RuntimeClient({ runtimeFile: options.runtimeFile });
  const info = await client.connect();

  try {
    if (options.command === "status") {
      const version = await client.request("runtime.version");
      const { spaces } = await client.request("spaces.list");
      process.stdout.write(
        `${JSON.stringify({ runtime: { ...info, token: "«redacted»" }, version, spaces }, null, 2)}\n`,
      );
      return 0;
    }
    if (options.command === "spaces") {
      const { spaces } = await client.request("spaces.list");
      process.stdout.write(`${JSON.stringify(spaces, null, 2)}\n`);
      return 0;
    }
    if (options.command !== "nodejs") {
      throw new AragonError(
        ERROR_CODES.INVALID_ARGUMENT,
        `unknown command "${options.command}"; try --help`,
      );
    }

    const source = options.evalCode ?? (await readStdin());
    if (!source.trim()) {
      process.stderr.write("aragon-browser: no script on stdin (use -e for inline code)\n");
      return 2;
    }

    const helpers = createHelpers(client, {
      log: (line) => process.stdout.write(`${line}\n`),
      logError: (line) => process.stderr.write(`${line}\n`),
    });
    if (options.space !== null) {
      const space = await helpers.taskSpace(options.space);
      helpers.useTaskSpace(space.id);
    }
    // Everything the script opened is closed on the way out unless it said
    // otherwise: a run that opens pages and never closes them is what fills the
    // rail with dead tabs. The `finally` means a failed script is swept too.
    const focusBaseline = await helpers.__focusBaseline();
    try {
      await runScript(source, helpers, {
        log: (line) => process.stdout.write(`${line}\n`),
      });
    } finally {
      let swept = null;
      try {
        swept = await helpers.__sweepTabs({ keepTabs: options.keepTabs });
      } catch {
        // A sweep failure must never turn a successful run into a failed one.
        swept = null;
      }
      const note = describeSweep(swept, { keepTabs: options.keepTabs });
      if (note) process.stderr.write(`${note}\n`);
      // Acting on a page puts it on screen, so the run may have taken the view from
      // the human. Give it back before exiting.
      await helpers.__restoreFocus(focusBaseline);
    }
    return 0;
  } finally {
    client.close();
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    const code = error?.error_code ?? "ARAGON_ERROR";
    process.stderr.write(`aragon-browser: ${code}: ${error?.message ?? error}\n`);
    process.exit(1);
  });

/**
 * Windows consoles render with the OEM code page (936 on a Chinese system), so
 * UTF-8 page text printed to a *terminal* looks like mojibake even though the
 * bytes are correct - piping to a file or an agent's pipe is unaffected.
 * Say so once instead of letting people think the snapshot is corrupted.
 */
if (process.platform === "win32" && process.stdout.isTTY) {
  process.stderr.write(
    "[aragon-browser] note: if non-ASCII page text looks garbled, run " +
      "`chcp 65001` first; the data itself is valid UTF-8.\n",
  );
}
