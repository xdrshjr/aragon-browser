import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, ipcMain } from "electron";
import { BrowserKernel } from "../kernel/browser-kernel.js";
import { RuntimeTransport } from "../kernel/runtime-transport.js";
import { runtimeFilePath } from "../shared/protocol.js";
import { ensureSetup, buildAppMenu } from "./menu.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = "0.1.0";

/**
 * aragon-browser main process.
 *
 * Boot order matters:
 *   1. one kernel, one runtime socket - a second window must not publish
 *      competing coordinates (hence the single-instance lock);
 *   2. publish `runtime.json` so `aragon-browser nodejs` can find the browser;
 *   3. give the human a space of their own so the window is usable immediately.
 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void boot();
}

async function boot() {
  await app.whenReady();
  // Set once, read by the kernel and the runtime metadata. `app.isPackaged` is
  // not available in every worker context, an env flag always is.
  process.env.ARAGON_PACKAGED = app.isPackaged ? "1" : "0";
  if (process.env.ARAGON_DEBUG === "1") {
    // Renderer errors otherwise vanish in the packaged app; this makes the UI
    // debuggable from the terminal that started the browser.
    app.on("web-contents-created", (_event, contents) => {
      contents.on("console-message", (event) => {
        console.log(`[ui:${contents.getType()}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
      });
      contents.on("preload-error", (_e, preloadPath, error) => {
        console.error(`[ui] preload failed ${preloadPath}: ${error?.message ?? error}`);
      });
    });
  }
  const kernel = new BrowserKernel({ version: VERSION });
  const transport = new RuntimeTransport({
    handler: (method, params) => kernel.dispatch(method, params),
    runtimeFile: runtimeFilePath(),
    metadata: {
      app: "aragon-browser",
      version: VERSION,
      chromium: process.versions.chrome,
      electron: process.versions.electron,
      packaged: app.isPackaged,
    },
  });
  kernel.attach(transport);

  // First-run setup. This is what makes it an installed desktop app rather than
  // a checkout: the agent's `aragon-browser` command has to work afterwards.
  const setup = ensureSetup();
  console.log(`[aragon-browser] setup: ${setup.message}`);
  for (const skillPath of setup.skills) {
    console.log(`[aragon-browser] agent skill: ${skillPath}`);
  }
  buildAppMenu(setup, kernel);

  const broadcastState = kernel.spaces.onStateChange;
  kernel.spaces.onStateChange = (spaceList) => {
    broadcastState(spaceList);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("aragon:state", spaceList);
    }
  };

  ipcMain.handle("aragon:rpc", async (_event, payload) => {
    const method = String(payload?.method ?? "");
    // The renderer is the untrusted-ish side: it can drive chrome, never the
    // agent surface. This is the one line that keeps that promise.
    if (!method.startsWith("ui.")) {
      return { ok: false, error: { message: `refused ${method} from the renderer` } };
    }
    try {
      const result = await kernel.dispatch(method, payload?.params ?? {}, { surface: "ui" });
      return { ok: true, result };
    } catch (error) {
      return {
        ok: false,
        error: { message: error?.message ?? String(error), code: error?.error_code },
      };
    }
  });

  ipcMain.handle("aragon:state", async () => ({
    spaces: kernel.spaces.list(),
    version: VERSION,
    engine: `chromium ${process.versions.chrome}`,
    runtimeFile: runtimeFilePath(),
  }));

  const coordinates = await transport.listen();
  console.log(
    `[aragon-browser] runtime listening on 127.0.0.1:${coordinates.port} ` +
      `(coordinates: ${coordinates.runtimeFile})`,
  );

  const home = await kernel.spaces.create({ name: "home" });
  kernel.spaces.takeOver(home.id);

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    void kernel.shutdown().finally(() => transport.close());
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const space = await kernel.spaces.create({ name: "home" });
      kernel.spaces.takeOver(space.id);
    }
  });
}
