import fs from "node:fs";
import {
  Menu,
  app,
  clipboard,
  dialog,
  shell,
} from "electron";
import {
  addToUserPath,
  binDir,
  installAgentSkill,
  installCliShim,
  sourceCliPath,
} from "./cli-install.js";

/**
 * First-run setup.
 *
 * Runs on every launch (cheap and idempotent) but only *announces* itself once,
 * because a modal on every start is how a browser becomes annoying.
 */
export function ensureSetup() {
  const shim = installCliShim();
  const skill = installAgentSkill();
  const firstRun = !app.getPath("userData").includes("__never__") && isFirstRun();

  if (firstRun) {
    // Recorded after the shim exists so a crashed first run is retried.
    markFirstRunDone();
    if (shim.ok) {
      // Announce non-blockingly: the user may already be scripting.
      setTimeout(() => {
        void dialog.showMessageBox({
          type: "info",
          title: "aragon-browser is ready",
          message: "The `aragon-browser` command is now installed.",
          detail: [
            shim.message,
            "",
            "Your agent can drive this browser by running a script:",
            '  aragon-browser nodejs -e "cliLog((await (await taskSpace()).newPage(\'https://example.com\')).snapshot().text)"',
            "",
            `Agent skill: ${skill.installed[0] ?? "not installed (no agent directory found)"}`,
          ].join("\n"),
          buttons: ["OK"],
          noLink: true,
        });
      }, 900);
    }
  }

  return {
    ...shim,
    skills: skill.installed,
    skillSkipped: skill.skipped,
  };
}

function firstRunMarker() {
  return `${app.getPath("userData")}/.setup-complete`;
}

function isFirstRun() {
  try {
    // eslint-disable-next-line no-sync
    return !fs.existsSync(firstRunMarker());
  } catch {
    return true;
  }
}

function markFirstRunDone() {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(firstRunMarker(), new Date().toISOString());
  } catch {
    // A read-only userData dir just means we announce again next time.
  }
}

/**
 * Menu. Every item here exists because it is something a user of an
 * agent-driven browser actually needs: see the API, copy the CLI path, open the
 * learnings folder, and add the command to PATH deliberately.
 */
export function buildAppMenu(setup, kernel) {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Space",
          accelerator: "CmdOrCtrl+N",
          click: async () => {
            const spaces = kernel.spaces.list();
            const space = await kernel.spaces.create({ name: `space-${spaces.length + 1}` });
            kernel.spaces.takeOver(space.id);
          },
        },
        { type: "separator" },
        {
          label: "Copy CLI path",
          click: () => {
            const cli = sourceCliPath();
            clipboard.writeText(cli ?? binDir());
          },
        },
        {
          label: "Add CLI to PATH",
          click: async () => {
            const result = addToUserPath();
            await dialog.showMessageBox({
              type: result.ok ? "info" : "warning",
              message: result.ok ? "PATH updated" : "PATH not updated",
              detail: result.message,
              buttons: ["OK"],
              noLink: true,
            });
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Agent",
      submenu: [
        {
          label: "Show API in a window",
          click: async () => {
            const { renderHelp } = await import("../shared/public-api-schema.js");
            const { BrowserWindow } = await import("electron");
            const win = new BrowserWindow({
              width: 900,
              height: 720,
              title: "aragon-browser API",
              backgroundColor: "#11131a",
            });
            const text = renderHelp()
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            await win.loadURL(
              `data:text/html;charset=utf-8,${encodeURIComponent(
                `<!doctype html><html><head><meta charset="utf-8"><title>aragon-browser API</title>
                 <style>
                   body{margin:0;padding:24px;background:#11131a;color:#e6e9f2;
                        font:13px/1.55 ui-monospace,'Cascadia Mono',Consolas,monospace}
                   pre{white-space:pre-wrap;margin:0}
                 </style></head><body><pre>${text}</pre></body></html>`,
              )}`,
            );
          },
        },
        {
          label: "Copy skill prompt",
          click: () => {
            clipboard.writeText(
              [
                "Set up aragon-browser for me.",
                "",
                "1. Run `aragon-browser --help` to confirm the CLI is installed.",
                "2. Run `aragon-browser skill` and read the guide it prints.",
                "3. Drive the browser by writing ONE script and piping it to",
                "   `aragon-browser nodejs`, not by calling the CLI repeatedly.",
              ].join("\n"),
            );
          },
        },
        { type: "separator" },
        {
          label: "Open learnings folder",
          click: async () => {
            const { learningsRoot } = await import("../kernel/learning/manifest.js");
            await shell.openPath(learningsRoot());
          },
        },
        {
          label: "Validate site skills",
          click: async () => {
            const { validateLearnings } = await import("../kernel/learning/validate.js");
            const errors = await validateLearnings();
            await dialog.showMessageBox({
              type: errors.length === 0 ? "info" : "error",
              message:
                errors.length === 0
                  ? "All site skills are valid"
                  : `${errors.length} problem(s) found`,
              detail: errors.length === 0 ? "" : errors.slice(0, 20).join("\n"),
              buttons: ["OK"],
              noLink: true,
            });
          },
        },
        { type: "separator" },
        {
          label: "Show setup status",
          click: async () => {
            await dialog.showMessageBox({
              type: setup.ok ? "info" : "warning",
              message: setup.ok ? "CLI installed" : "CLI not installed",
              detail: [
                setup.message,
                "",
                `bin directory: ${binDir()}`,
                `agent skills: ${setup.skills.length === 0 ? setup.skillSkipped ?? "none" : setup.skills.join("\n")}`,
              ].join("\n"),
              buttons: ["OK"],
              noLink: true,
            });
          },
        },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, ...(isMac ? [{ role: "front" }] : [])],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
