import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyWindowAction, windowStateOf } from "../src/main/window-controls.js";
import { scopeRendererParams } from "../src/main/space-scope.js";
import { LAYOUT, pageBounds } from "../src/shared/layout.js";
import { decodePng, encodePng, resizeRgba } from "../scripts/png.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/**
 * Every `selector { body }` rule in the stylesheet, in order. The stylesheet has no
 * at-rules that nest blocks, so this flat scan is the whole file - which is what
 * lets a test say "no rule anywhere turns dragging back off" instead of checking
 * the handful of selectors someone remembered.
 */
function cssRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim().replace(/\s+/g, " "),
    body: match[2],
  }));
}

/** Selectors whose body sets `-webkit-app-region` to `value`. */
function appRegionSelectors(css, value) {
  return cssRules(css)
    .filter((rule) => new RegExp(`-webkit-app-region:\\s*${value}\\b`).test(rule.body))
    .map((rule) => rule.selector);
}

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

test("the title bar is a drag region and only the window buttons opt out", () => {
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

  // The regression this assertion exists for: `.tb-space` was `no-drag` so its
  // tooltip would work, but it is `flex: 1` - it covers the whole gap between the
  // brand and the buttons. Windows then hit-tests that span as HTCLIENT, i.e. the
  // window could only be dragged by the few pixels left of the brand. Verified
  // against a real window with WM_NCHITTEST: 90% of the strip answered HTCLIENT.
  //
  // So: no rule outside the window controls may switch dragging off. Any future
  // opt-out (a new button, an input in the strip) belongs under `.win-controls`
  // or has to update this list deliberately.
  assert.deepEqual(
    appRegionSelectors(css, "no-drag"),
    [".win-controls"],
    "only the window controls may be excluded from the drag region",
  );
  // And the label that fills the strip has to say so out loud, not rely on
  // inheriting an ancestor's region by accident.
  assert.match(cssBlock(css, ".tb-space {"), /-webkit-app-region:\s*drag/);
  // A tooltip inside a drag region can never open, so it must not pretend to.
  assert.doesNotMatch(read("src", "renderer", "ui.js"), /titleSpace\.title/, "a tooltip in the drag region never fires");

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

test("renderer RPCs are pinned to the space the window is showing", () => {
  const main = read("src", "main", "main.js");
  assert.match(main, /scopeRendererParams/, "a payload spaceId could otherwise address a background space");
  assert.match(
    main,
    /focusedSpaceIdForContents/,
    "the sender's space must come from the window's focused space, not the payload",
  );
  const scope = read("src", "main", "space-scope.js");
  assert.match(scope, /refused \$\{method\} for space/, "a foreign spaceId must be refused, not clamped");
});

test("space scoping: a window cannot touch a background space, but the sidebar still works", () => {
  // Pin the space the window is showing.
  assert.deepEqual(
    scopeRendererParams({ method: "ui.navigate", params: { spaceId: 1, url: "https://x" }, senderSpaceId: 1 }),
    { ok: true, params: { spaceId: 1, url: "https://x" } },
  );
  // Naming a background space is refused, not silently redirected: redirecting would
  // make the sidebar appear to work while navigating the wrong space.
  for (const method of [
    "ui.navigate",
    "ui.newTab",
    "ui.closeTab",
    "ui.handOff",
    "ui.takeOver",
  ]) {
    const result = scopeRendererParams({ method, params: { spaceId: 2 }, senderSpaceId: 1 });
    assert.equal(result.ok, false, `${method} must not reach a background space`);
    assert.match(result.error, /the window is showing space 1/);
  }
  // The rail's own actions: switching, creating, and the ✕ on any row.
  for (const method of ["ui.focusSpace", "ui.newSpace", "ui.closeSpace"]) {
    const result = scopeRendererParams({ method, params: { spaceId: 2 }, senderSpaceId: 1 });
    assert.equal(result.ok, true, `${method} is a rail action and must stay reachable`);
  }
  // A missing spaceId is filled from the sender, not left to the kernel's global
  // "current space", which can point at a background space.
  const filled = scopeRendererParams({ method: "ui.reload", params: {}, senderSpaceId: 7 });
  assert.equal(filled.params.spaceId, 7);
  // `null` is unset, not "some other space": the chrome has no focused space to
  // send before the first state push, and refusing that would break the rail on a
  // cold window instead of letting the kernel fill in the visible space.
  const nulled = scopeRendererParams({
    method: "ui.reload",
    params: { spaceId: null },
    senderSpaceId: 7,
  });
  assert.equal(nulled.ok, true, "a null spaceId must not be refused as foreign");
  assert.equal(nulled.params.spaceId, 7);
  // A non-space window (the API window) has nothing to pin to.
  const api = scopeRendererParams({ method: "ui.state", params: {}, senderSpaceId: null });
  assert.equal(api.ok, true);
});

test("the window title stays unique and follows the focused space", () => {
  const windowSource = read("src", "kernel", "task-spaces.js");
  // The title is the key `ui.captureWindow` uses. Two spaces may share a name
  // ("space-3" reused after a close), so the id has to be in the title, and the
  // renderer's <title> must not overwrite it.
  assert.match(windowSource, /aragon-browser - \$\{space\.name\} \(#\$\{space\.id\}\)/);
  const handler = windowSource.slice(windowSource.indexOf('window.on("page-title-updated"'));
  assert.match(
    handler.slice(0, handler.indexOf("\n")),
    /event\.preventDefault\(\)/,
    "without preventDefault the renderer renames every window to <title>",
  );
});

test("every space lives in one window, and switching is in-window", () => {
  const windowSource = read("src", "kernel", "task-spaces.js");

  // Exactly one construction site: the shell window. A second `new BrowserWindow`
  // anywhere in this manager is the "second agent opened a window" bug back again.
  const constructions = [...windowSource.matchAll(/new BrowserWindow\(/g)];
  assert.equal(constructions.length, 1, `expected 1 BrowserWindow, found ${constructions.length}`);
  assert.match(windowSource, /#ensureWindow\(\)/, "the shell window must be created lazily and shared");

  // Spaces never build their own window: they are tab sets inside the shell.
  const createBody = windowSource.slice(
    windowSource.indexOf("async create({"),
    windowSource.indexOf("setFocusedSpace("),
  );
  assert.doesNotMatch(createBody, /new BrowserWindow\(/, "create() must not open a window per space");
  assert.match(createBody, /#ensureWindow\(\)/, "create() must reuse the shell window");

  // Visibility is derived from the focused space, never stored, or a background
  // space keeps painting over the one the human is looking at.
  const layoutStart = windowSource.indexOf("layout() {");
  const layoutBody = windowSource.slice(layoutStart, windowSource.indexOf("\n  }\n", layoutStart));
  assert.match(
    layoutBody,
    /space\.id === this\.focusedSpaceId/,
    "only the focused space's active tab may occupy the page area",
  );
  // Parking off-window is not cosmetic: setVisible(false) also drops input, so a
  // hidden agent page can be seen but not clicked (the smoke suite catches it).
  assert.match(
    layoutBody,
    /offStage|x: width \+ 8/,
    "background tabs must be parked outside the window, not hidden",
  );

  // A closing window takes every space with it; a closing space must not destroy
  // the window its siblings still live in.
  assert.match(windowSource, /#dispose\(space\)[^]*this\.spaces\.size === 0/, "the window closes only with the last space");
});

test("the agent's new space never steals the human's view", () => {
  const windowSource = read("src", "kernel", "task-spaces.js");
  const focusStart = windowSource.indexOf("focusForAgent(space) {");
  const focus = windowSource.slice(focusStart, windowSource.indexOf("ensureOnStage(space) {"));
  assert.match(focus, /current\.owner === "agent"/, "only an agent-owned view may be replaced");
  assert.match(focus, /return false/, "the caller must be able to tell it stayed put");

  // Acting is different from selecting: Chromium drops real input for a page it
  // considers hidden, so the page an agent drives has to be the one on screen.
  const activeStart = windowSource.indexOf("activeTab(spaceId) {");
  const activeBody = windowSource.slice(activeStart, windowSource.indexOf("\n  }", activeStart));
  assert.match(
    activeBody,
    /this\.ensureOnStage\(space\)/,
    "every acting path must bring its space on stage, or clicks are silently dropped",
  );

  // The renderer reads the focused space from the pushed state, not from a value
  // baked into the preload at window creation time.
  const ui = read("src", "renderer", "ui.js");
  assert.match(ui, /focusedSpaceId/, "the chrome has to follow the pushed focused space");
  assert.doesNotMatch(read("src", "preload", "ui-preload.js"), /aragon-space-id/, "no per-window space id any more");
});

test("the sidebar and the agent surface both switch spaces in-window", () => {
  const kernel = read("src", "kernel", "browser-kernel.js");
  // The rail's click and the kernel's spaces.focus must reach the SAME function -
  // otherwise the sidebar keeps its old "focus a sibling window" meaning.
  for (const method of ["ui.focusSpace", "spaces.focus"]) {
    const start = kernel.indexOf(`"${method}": async`);
    assert.notEqual(start, -1, `${method} is missing`);
    const body = kernel.slice(start, kernel.indexOf("\n      },", start));
    assert.match(body, /spaces\.setFocusedSpace\(space\.id\)/, `${method} must switch in-window`);
    assert.doesNotMatch(body, /new BrowserWindow/, `${method} must not open a window`);
  }
  // Window- and chrome-level captures have to bring their space forward, or the
  // picture is of whatever the human happened to be looking at.
  for (const method of ["ui.captureChrome", "ui.captureWindow", "ui.layout"]) {
    const start = kernel.indexOf(`"${method}": async`);
    assert.notEqual(start, -1, `${method} is missing`);
    const body = kernel.slice(start, kernel.indexOf("\n      },", start));
    assert.match(
      body,
      /spaces\.setFocusedSpace\(space\.id\)/,
      `${method} must show the space it was asked about`,
    );
  }
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

test("the header shows the app icon, not a typed placeholder glyph", () => {
  const html = read("src", "renderer", "index.html");
  // The bug: the header drew "◈", which is the shape make-icon.mjs uses for its
  // PLACEHOLDER. So the packaged window showed something that had nothing to do
  // with the icon the installer, the exe and the task bar show.
  assert.doesNotMatch(html, /◈/, "the placeholder glyph is not the app's logo");
  assert.doesNotMatch(html, /class="mark"/, "the old glyph span is gone");
  assert.match(html, /<img[^>]*class="tb-mark"[^>]*src="brand\.png"/, "the brand mark is the icon file");
  assert.match(html, /alt=""/, "decorative next to the word mark, so an empty alt");
  // It must be inside the title bar, not somewhere else in the chrome.
  const titlebar = html.slice(html.indexOf('id="titlebar"'), html.indexOf('id="sidebar"'));
  assert.match(titlebar, /src="brand\.png"/);

  const css = read("src", "renderer", "styles.css");
  assert.match(cssBlock(css, ".tb-mark {"), /width:\s*18px/);
  // The old glyph rule has to be gone, or it silently loses its subject.
  assert.doesNotMatch(css, /\.tb-brand \.mark/);

  // Generated, not hand-edited: it has to be a real PNG the renderer can decode.
  const brand = decodePng(fs.readFileSync(path.join(ROOT, "src", "renderer", "brand.png")));
  assert.equal(brand.width, 64);
  assert.equal(brand.height, 64);
  // 18 CSS px at 3.5x DPI, and small enough that opening a window does not decode
  // a megapixel image for a 16px mark.
  assert.ok(fs.statSync(path.join(ROOT, "src", "renderer", "brand.png")).size < 40_000);
  // Transparent margin, opaque artwork: the swirl icon is a cut-out, and a brand
  // chip with a white box around it is exactly what the header looked wrong with.
  const alphaAt = (x, y) => brand.data[(y * brand.width + x) * 4 + 3];
  assert.equal(alphaAt(0, 0), 0, "the corner must be transparent");
  assert.equal(alphaAt(brand.width - 1, brand.height - 1), 0);
  const opaque = [...Array(brand.width * brand.height).keys()].filter(
    (i) => brand.data[i * 4 + 3] > 200,
  ).length;
  assert.ok(opaque > 1000, `the mark has only ${opaque} opaque pixels - the resize lost the artwork`);
});

test("brand.png is exactly the app icon, downscaled - so it cannot drift", () => {
  // One source of truth: build/icon.png is what electron-builder burns into the exe
  // and the installer, so the header must be derived from it, not drawn by hand.
  // Regenerating is byte-identical, which is why the file is committed and why
  // `npm run build` can safely refresh it.
  const icon = decodePng(fs.readFileSync(path.join(ROOT, "build", "icon.png")));
  const expected = encodePng(64, 64, resizeRgba(icon, 64, 64));
  const shipped = fs.readFileSync(path.join(ROOT, "src", "renderer", "brand.png"));
  assert.ok(
    expected.equals(shipped),
    "src/renderer/brand.png is stale: run `npm run brand` after changing build/icon.png",
  );
  // And it has to actually be packaged - a brand mark that only exists in the dev
  // tree is the "works before `npm run dist`" trap this project has hit before.
  assert.match(read("electron-builder.yml"), /"src\/renderer\/\*\*\/\*"/);
});
