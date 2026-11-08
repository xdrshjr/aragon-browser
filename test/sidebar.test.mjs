import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/**
 * The sidebar is the spaces rail. It used to end in a footer that printed
 * `nano · chromium 156.0.8078.80` and the absolute path of `runtime.json`.
 *
 * That footer was debug scaffolding that shipped: the path is a
 * C:\Users\<name>\AppData\Local\Temp\... string that means nothing to a person
 * running a browser, it wraps over three lines at the default window width, and
 * the Chromium build number is the kind of detail that belongs in a crash report,
 * not in permanent chrome. Both values are still on stdout at startup
 * (`[aragon-browser] runtime listening ...`) and in `aragon-browser version` via
 * the CLI, so nothing is lost - it is just not painted into the window.
 *
 * These assertions are file-level on purpose. The footer cannot be checked from a
 * unit test any other way: the renderer needs a real window, and the whole point
 * is that the DOM element no longer exists to be filled in.
 */

test("the sidebar has no engine / runtime-path footer", () => {
  const html = read("src", "renderer", "index.html");
  const sidebar = html.slice(html.indexOf('id="sidebar"'), html.indexOf('id="chrome"'));
  assert.ok(sidebar.length > 0, "the sidebar block moved; this test is reading the wrong slice");
  for (const id of ["engine", "runtime", "side-foot"]) {
    assert.doesNotMatch(sidebar, new RegExp(`id="${id}"`), `#${id} is back in the sidebar`);
    assert.doesNotMatch(sidebar, new RegExp(`class="[^"]*${id}`), `.${id} is back in the sidebar`);
  }
  // The rail still has to have its two real controls: the list and the + button.
  assert.match(sidebar, /<ul id="space-list">/);
  assert.match(sidebar, /id="new-space"/);

  const css = read("src", "renderer", "styles.css");
  assert.doesNotMatch(css, /\.side-foot/, "dead CSS for a removed element");
  // `.mono` existed for the monospaced runtime path and nothing else in the
  // renderer ever used it; it goes with the element it was written for.
  assert.doesNotMatch(css, /^\.mono\s*\{/m, "dead CSS for the removed path label");
});

test("nothing writes an engine string or a runtime path into the chrome", () => {
  const ui = read("src", "renderer", "ui.js");
  assert.doesNotMatch(ui, /getElementById\("engine"\)/);
  assert.doesNotMatch(ui, /getElementById\("runtime"\)/);
  assert.doesNotMatch(ui, /runtimeFile/);
  assert.doesNotMatch(ui, /nano ·/);
  // The state IPC is not the place to keep shipping it either: a payload field
  // nothing reads is how the footer comes back one "small fix" later.
  const main = read("src", "main", "main.js");
  const handler = main.slice(main.indexOf('ipcMain.handle("aragon:state"'));
  const body = handler.slice(0, handler.indexOf("}));"));
  assert.doesNotMatch(body, /engine:/);
  assert.doesNotMatch(body, /runtimeFile:/);
  // Still the two things the renderer actually needs.
  assert.match(body, /spaces: kernel\.spaces\.list\(\)/);
  assert.match(body, /focusedSpaceId/);
});

test("the runtime path is still discoverable, just not in the window", () => {
  // Removing the footer must not remove the information: the path is logged on
  // stdout at startup and published in runtime.json, which is how the CLI finds
  // the browser. Losing it entirely would break `aragon-browser nodejs`.
  const main = read("src", "main", "main.js");
  assert.match(main, /coordinates: \$\{coordinates\.runtimeFile\}/);
  assert.match(main, /runtimeFile: runtimeFilePath\(\)/);
});
