import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyWindowAction, windowStateOf } from "../src/main/window-controls.js";
import { scopeRendererParams } from "../src/main/space-scope.js";
import { LAYOUT, pageBounds } from "../src/shared/layout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/**
 * The body of one CSS rule, brace-matched. A plain `slice(indexOf(...), next }})`
 * silently reads only the first block, so a later override of the same selector
 * could re-enable dragging while the assertion stayed green.
 */
function cssBlock(css, selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `stylesheet has no ${selector} rule`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces in ${selector}`);
}

/**
 * The window has no native title bar, so every control a user needs in order to
 * move, resize and close the window is drawn by the renderer and routed through
 * IPC. These tests exist because that is exactly the kind of wiring that silently
 * half-works: buttons that render but do nothing look fine in a screenshot.
 */

function fakeWindow({ maximized = false } = {}) {
  const calls = [];
  const state = { maximized };
  return {
    calls,
    minimize: () => calls.push("minimize"),
    maximize: () => {
      calls.push("maximize");
      state.maximized = true;
    },
    unmaximize: () => {
      calls.push("unmaximize");
      state.maximized = false;
    },
    close: () => calls.push("close"),
    isMaximized: () => state.maximized,
    isFullScreen: () => false,
    isFocused: () => true,
  };
}

test("window controls: minimize, maximize, restore, close", () => {
  const win = fakeWindow();
  assert.deepEqual(windowStateOf(win), { maximized: false, fullScreen: false, focused: true });

  let state = applyWindowAction(win, "minimize");
  assert.deepEqual(win.calls, ["minimize"]);
  assert.equal(state.maximized, false);

  state = applyWindowAction(win, "toggle-maximize");
  assert.deepEqual(win.calls, ["minimize", "maximize"]);
  assert.equal(state.maximized, true, "the button must report the state it just created");

  // The same button must be able to undo itself, or a maximized window is stuck.
  state = applyWindowAction(win, "toggle-maximize");
  assert.deepEqual(win.calls, ["minimize", "maximize", "unmaximize"]);
  assert.equal(state.maximized, false);

  applyWindowAction(win, "close");
  assert.deepEqual(win.calls.at(-1), "close");
});

test("window controls: close reports the state before the window dies", () => {
  const win = fakeWindow({ maximized: true });
  const state = applyWindowAction(win, "close");
  assert.equal(state.maximized, true);
  assert.deepEqual(win.calls, ["close"]);
});

test("window controls: 'state' is a read, not an action", () => {
  const win = fakeWindow({ maximized: true });
  const state = applyWindowAction(win, "state");
  assert.deepEqual(win.calls, []);
  assert.equal(state.maximized, true);
});

test("window controls: an unknown action is refused out loud", () => {
  const win = fakeWindow();
  assert.throws(() => applyWindowAction(win, "devtools"), /unknown window action devtools/);
  assert.throws(() => applyWindowAction(win, ""), /unknown window action/);
  assert.deepEqual(win.calls, [], "a refused action must not touch the window");
});

test("the window is frameless and its title bar is drawn by the renderer", () => {
  const windowSource = read("src", "kernel", "task-spaces.js");
  assert.match(windowSource, /frame:\s*false/, "the native caption has to go");
  assert.match(windowSource, /autoHideMenuBar:\s*true/, "the menu must not eat 26px");
  // The renderer's <title> would otherwise rename every space window to the same
  // string, which is what the window capture uses to find its own window.
  assert.match(windowSource, /page-title-updated/);
});

test("the title bar carries minimize, maximize and close, in that order, on the right", () => {
  const html = read("src", "renderer", "index.html");
  assert.match(html, /id="titlebar"/);
  const controls = html.slice(html.indexOf('class="win-controls"'));
  const order = [...controls.matchAll(/data-win="([a-z-]+)"/g)].map((match) => match[1]);
  // DOM order is left-to-right, so this is also the visual order.
  assert.deepEqual(order, ["minimize", "maximize", "close"]);
  // "on the right" is a CSS fact, not a DOM one: the middle label must absorb the
  // free space, or the buttons jump next to the brand with the same DOM order.
  const css = read("src", "renderer", "styles.css");
  const label = cssBlock(css, ".tb-space {");
  assert.match(label, /flex:\s*1/, ".tb-space must push the controls to the right edge");
  assert.match(cssBlock(css, ".win-controls {"), /flex:\s*none/);
});

test("the title bar is a drag region and its buttons are not", () => {
  const css = read("src", "renderer", "styles.css");
  // Brace-matched, so a later override of the same selector cannot hide behind a
  // first-match slice, and the height assertion binds to the variable.
  const block = cssBlock(css, "#titlebar {");
  assert.match(block, /-webkit-app-region:\s*drag/, "the strip has to drag the window");
  assert.match(
    block,
    /height:\s*var\(--titlebar-height\)/,
    "a hard-coded height here could drift from LAYOUT.titleBarHeight",
  );
  assert.match(
    cssBlock(css, ".win-controls {"),
    /-webkit-app-region:\s*no-drag/,
    "a draggable button cannot be clicked",
  );
  // The CSS height and the layout constant have to agree or the page view covers
  // the buttons. Both are read here so drift fails a test instead of a human.
  assert.match(css, new RegExp(`--titlebar-height:\\s*${LAYOUT.titleBarHeight}px`));
  // The other strips are declared in --* variables too; if only the title bar were
  // bound, titleBarHeight+4 with chromeHeight-4 would stay green while the page
  // view started 4px above the toolbar's bottom edge.
  assert.match(css, new RegExp(`--chrome-height:\\s*${LAYOUT.chromeHeight}px`));
  assert.match(css, new RegExp(`--status-height:\\s*${LAYOUT.statusHeight}px`));
  assert.match(css, new RegExp(`--sidebar-width:\\s*${LAYOUT.sidebarWidth}px`));
  assert.match(css, /#chrome \{[^}]*top: var\(--titlebar-height\)/);
  assert.match(css, /#sidebar \{[^}]*top: var\(--titlebar-height\)/);
});

test("the preload exposes the window actions and nothing wider", () => {
  const preload = read("src", "preload", "ui-preload.js");
  assert.match(preload, /windowAction:\s*\(action\)\s*=>\s*ipcRenderer\.invoke\("aragon:window"/);
  assert.match(preload, /onWindowState:/);
  // Node must stay out of the renderer; the bridge is the only surface.
  assert.doesNotMatch(preload, /require\(|process\.binding/);
});

test("the renderer wires all three buttons and follows OS-driven maximize", () => {
  const ui = read("src", "renderer", "ui.js");
  for (const action of ["minimize", "toggle-maximize", "close"]) {
    assert.match(ui, new RegExp(`"${action}"`), `the ${action} button is not wired`);
  }
  // Maximizing from the OS (double click, Win+Up, snap) must update the glyph, so
  // the renderer has to listen as well as ask.
  assert.match(ui, /onWindowState\(/);
  // Full screen swallows the maximize button; the glyph has to follow it or the
  // button is a dead control that lies about the state.
  assert.match(ui, /state\?\.fullScreen/, "applyWindowState must treat full screen as maximized");
});

test("the IPC handler actually forwards the action it was given", () => {
  // Without this, the whole suite stays green with a handler that ignores `action`
  // (e.g. hard-codes "state") - i.e. every button dead, all tests passing.
  const main = read("src", "main", "main.js");
  const handler = main.slice(main.indexOf('ipcMain.handle("aragon:window"'));
  assert.match(handler.slice(0, handler.indexOf("});")), /applyWindowAction\(win,\s*action\)/);
  // And it must resolve the window from the sender, not from anything the renderer
  // can name - otherwise one space could close another.
  assert.match(handler.slice(0, handler.indexOf("});")), /BrowserWindow\.fromWebContents/);
});

test("renderer RPCs are pinned to the window that sent them", () => {
  const main = read("src", "main", "main.js");
  assert.match(main, /scopeRendererParams/, "a payload spaceId could otherwise address another window");
  assert.match(main, /spaceIdForContents/, "the sender's space must come from the window, not the payload");
  const scope = read("src", "main", "space-scope.js");
  assert.match(scope, /refused \$\{method\} for space/, "a foreign spaceId must be refused, not clamped");
});

test("space scoping: a window cannot touch a sibling, but the sidebar still works", () => {
  // Pin the window's own space.
  assert.deepEqual(
    scopeRendererParams({ method: "ui.navigate", params: { spaceId: 1, url: "https://x" }, senderSpaceId: 1 }),
    { ok: true, params: { spaceId: 1, url: "https://x" } },
  );
  // Naming a sibling is refused, not silently redirected: redirecting would make
  // the sidebar appear to work while navigating the wrong window.
  for (const method of [
    "ui.navigate",
    "ui.newTab",
    "ui.closeTab",
    "ui.closeSpace",
    "ui.handOff",
    "ui.takeOver",
  ]) {
    const result = scopeRendererParams({ method, params: { spaceId: 2 }, senderSpaceId: 1 });
    assert.equal(result.ok, false, `${method} must not reach another space`);
    assert.match(result.error, /from the window of space 1/);
  }
  // Clicking a space in the sidebar focuses a SIBLING window - the one deliberate
  // exception. Without it the whole left rail silently stops working.
  const focus = scopeRendererParams({
    method: "ui.focusSpace",
    params: { spaceId: 2 },
    senderSpaceId: 1,
  });
  assert.equal(focus.ok, true);
  assert.equal(focus.params.spaceId, 2);
  // A missing spaceId is filled from the sender, not left to the kernel's global
  // "current space", which can point at a sibling.
  const filled = scopeRendererParams({ method: "ui.reload", params: {}, senderSpaceId: 7 });
  assert.equal(filled.params.spaceId, 7);
  // A non-space window (the API window) has nothing to pin to.
  const api = scopeRendererParams({ method: "ui.state", params: {}, senderSpaceId: null });
  assert.equal(api.ok, true);
});

test("the window title stays unique per space", () => {
  const windowSource = read("src", "kernel", "task-spaces.js");
  // The title is the key `ui.captureWindow` uses. Two spaces may share a name
  // ("space-3" reused after a close), so the id has to be in the title, and the
  // renderer's <title> must not overwrite it.
  assert.match(windowSource, /aragon-browser - \$\{space\.name\} \(#\$\{id\}\)/);
  const handler = windowSource.slice(windowSource.indexOf('window.on("page-title-updated"'));
  assert.match(
    handler.slice(0, handler.indexOf("\n")),
    /event\.preventDefault\(\)/,
    "without preventDefault the renderer renames every window to <title>",
  );
});

test("every glyph is centred on an integer row", () => {
  const css = read("src", "renderer", "styles.css");
  // A 34px bar with a 1px inside border is a 33px content box: flex-centring a
  // 10px glyph then starts it on a half pixel and the 1px borders alias to two soft
  // rows. The 1px bottom padding restores an even content box.
  assert.match(cssBlock(css, "#titlebar {"), /padding:\s*0 0 1px/);
  // The minimize dash must sit on the same centre as the square and the X: shrinking
  // the box to 1px re-centres it, so a positive translateY pushes it 4px low.
  const dash = cssBlock(css, '.win-btn[data-win="minimize"] .win-glyph {');
  assert.match(dash, /transform:\s*translateY\(-4px\)/);
});

test("the page view starts below the title bar, not under it", () => {
  const bounds = pageBounds({ width: 1280, height: 860 });
  assert.equal(bounds.y, LAYOUT.titleBarHeight + LAYOUT.chromeHeight);
  assert.equal(bounds.y, 112);
  assert.ok(bounds.height > 700, `page view is only ${bounds.height}px tall`);
});
