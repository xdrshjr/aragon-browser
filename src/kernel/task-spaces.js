import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, WebContentsView, session } from "electron";
import { AragonError, ERROR_CODES, invalidArgument, requireString } from "../shared/protocol.js";
import { LAYOUT, pageBounds } from "../shared/layout.js";
import { partitionFor } from "../shared/partitions.js";
import { CdpChannel } from "./cdp-channel.js";
import { RefRegistry } from "./ref-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = path.join(__dirname, "..", "renderer");

/**
 * Task spaces.
 *
 * A space is the aragon-browser answer to "my agent should not fight me for the
 * browser": its own tabs and its own Electron session partition, so
 * cookies/localStorage/indexedDB of two spaces cannot see each other even on the
 * same site.
 *
 * ONE window, many spaces. The window is the shell the human looks at (sidebar,
 * tabs, address bar, agent badge); a space is a set of page views inside it, and
 * exactly one space is *focused* at a time. The sidebar switches which space is
 * shown - it does not summon another OS window. That is the whole point: a second
 * agent asking for a space must appear in the sidebar next to the first one
 * instead of opening a window of its own.
 *
 * Visibility is derived, never stored: the focused space's active tab is laid out in
 * the page area and every other tab is parked just outside the window
 * (`layout()`). Hidden spaces keep running and stay clickable - agents work in the
 * background - they are just not composited over the page the human is reading.
 *
 * Ownership (`agent` / `user`) is the control handoff. While a space is owned by
 * the user, every mutating kernel call is refused - the agent cannot type into a
 * form the human is filling in, exactly like a human would not.
 */
export class TaskSpaceManager {
  constructor({ onStateChange = () => {}, defaultProfileId = "default" } = {}) {
    this.spaces = new Map();
    this.nextId = 1;
    this.nextTabId = 1;
    this.nextPageLabel = 1;
    this.onStateChange = onStateChange;
    this.defaultProfileId = defaultProfileId;
    this.profiles = [
      { id: defaultProfileId, name: "Default profile", kind: "persistent" },
      { id: "ephemeral", name: "Ephemeral profile (no disk writes)", kind: "memory" },
    ];
    // The shell window and which space it is currently showing.
    this.window = null;
    this.focusedSpaceId = null;
  }

  partitionFor(profileId, spaceId) {
    const partition = partitionFor(profileId, spaceId, this.profiles);
    if (!partition) {
      throw new AragonError(
        ERROR_CODES.OPERATION_FAILED,
        `unknown profile "${profileId}"; call listProfiles first`,
      );
    }
    return partition;
  }

  listProfiles() {
    return this.profiles.map((profile) => ({ ...profile }));
  }

  list() {
    return [...this.spaces.values()].map((space) => this.describe(space));
  }

  /** What the renderer and the transport both need: spaces plus the focused one. */
  stateSnapshot() {
    return { spaces: this.list(), focusedSpaceId: this.focusedSpaceId };
  }

  /**
   * Which space is this window showing? Used to pin renderer RPCs to the space
   * the human can actually see, so a stale `spaceId` in a payload cannot drive a
   * background space. Returns null for anything that is not the shell window
   * (e.g. the API window opened from the Agent menu).
   */
  focusedSpaceIdForContents(contents) {
    const window = this.window;
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return null;
    if (window.webContents !== contents) return null;
    return this.focusedSpaceId;
  }

  describe(space) {
    return {
      id: space.id,
      name: space.name,
      owner: space.owner,
      agentState: space.agentState,
      profileId: space.profileId,
      partition: space.partition,
      activeTabId: space.activeTabId,
      focused: space.id === this.focusedSpaceId,
      tabs: space.tabs.map((tab) => ({
        id: tab.id,
        label: tab.label,
        origin: tab.origin,
        url: tab.view.webContents.getURL(),
        title: tab.title,
        active: tab.id === space.activeTabId,
      })),
    };
  }

  get(spaceId) {
    const space = this.spaces.get(Number(spaceId));
    if (!space) {
      throw new AragonError(
        ERROR_CODES.TASK_SPACE_NOT_FOUND,
        `task space ${spaceId} does not exist; list spaces to see live ids`,
      );
    }
    return space;
  }

  requireAgentControl(space) {
    if (space.owner !== "agent") {
      throw new AragonError(
        ERROR_CODES.TASK_SPACE_USER_IN_CONTROL,
        `space ${space.id} ("${space.name}") is being driven by the user; wait, or take it back with takeOverTaskSpace(${space.id}) after asking`,
      );
    }
  }

  /**
   * The one window every space lives in.
   *
   * Created lazily, kept until the last space goes away. `frame: false` because the
   * renderer paints its own title bar (brand plus minimize / maximize / close, see
   * src/renderer/index.html) - `frame: false` on Windows keeps the WS_THICKFRAME
   * border because `thickFrame` defaults to true, so the window still resizes from
   * every edge, still Aero-snaps and still keeps its shadow; only the caption, and
   * with it the system menu, is gone.
   */
  #ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: LAYOUT.minWidth,
      minHeight: LAYOUT.minHeight,
      title: "aragon-browser",
      backgroundColor: "#11131a",
      show: false,
      frame: false,
      // The application menu still exists and still owns every accelerator; it is
      // just not worth 26px of vertical chrome. Alt reveals it.
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "..", "preload", "ui-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    this.window = window;

    // The renderer's title bar draws a maximize/restore glyph, so it has to know
    // the real window state. Maximizing also changes the client area without a
    // resize event on every platform, so layout is re-run from these too.
    const publishWindowState = () => {
      // Both checks matter: closing the window destroys its tab views first, and
      // the 'destroyed' handler they trigger can run while `isDestroyed()` is still
      // false but `webContents` is already gone. Sending then throws from inside an
      // event handler, i.e. uncaught in the main process.
      if (window.isDestroyed() || window.webContents.isDestroyed()) return;
      window.webContents.send("aragon:window-state", {
        maximized: window.isMaximized(),
        fullScreen: window.isFullScreen(),
      });
    };
    window.on("maximize", () => {
      publishWindowState();
      this.layout();
    });
    window.on("unmaximize", () => {
      publishWindowState();
      this.layout();
    });
    // Alt reveals the auto-hidden application menu, which shrinks the CLIENT area
    // while the HWND stays the same size - so no resize/resized event fires and the
    // page views keep their old bounds, ending up over the status bar. These two
    // events are the only signal the menu toggled.
    window.on("menu-bar-visible", () => this.layout());
    window.on("menu-bar-hidden", () => this.layout());

    window.loadFile(path.join(RENDERER_DIR, "index.html"));
    // The renderer's `<title>` must not rename the window. The OS title is how a
    // human tells the browser apart in the task bar, and it is also how
    // `ui.captureWindow` identifies its own window: without this the window is
    // called "aragon-browser", the same name as any installed build you happen to
    // have open.
    window.on("page-title-updated", (event) => event.preventDefault());
    window.once("ready-to-show", () => {
      window.show();
      // Lay out again once the window is really on screen. The client area at
      // creation time is not the client area users get: applying the application
      // menu and showing the window shave pixels off it (observed: 821px -> 795px),
      // and nothing fires a resize for that. Without this the tab views keep the
      // old bounds and the page view hangs off the bottom of the window - over the
      // renderer's status bar.
      this.layout();
    });
    window.on("resize", () => this.layout());
    window.on("resized", () => this.layout());
    window.on("enter-full-screen", () => {
      publishWindowState();
      this.layout();
    });
    window.on("leave-full-screen", () => {
      publishWindowState();
      this.layout();
    });
    window.on("closed", () => {
      // The human closed the shell (or the app is quitting): every space goes with
      // it. `disposeAll` must not try to destroy the window it already lost.
      this.window = null;
      this.focusedSpaceId = null;
      void this.disposeAll();
    });
    return window;
  }

  async create({ name, profileId = this.defaultProfileId } = {}) {
    if (name !== undefined && name !== null) requireString(name, "name");
    const id = this.nextId++;
    const partition = this.partitionFor(profileId, id);
    const space = {
      id,
      name: name ?? `space-${id}`,
      owner: "agent",
      agentState: "idle",
      profileId,
      partition,
      tabs: [],
      activeTabId: null,
      refs: new RefRegistry().setSpace(id),
      window: this.#ensureWindow(),
      lastEvent: null,
    };
    this.spaces.set(id, space);

    await session.fromPartition(partition).setPermissionRequestHandler((contents, permission, callback) => {
      // A browser an agent drives must never silently grant powerful APIs.
      // Clipboard is the deliberate exception: it is an explicit capability of
      // this browser (agents paste into forms), and it is scoped to the space's
      // own session, not to the user's main profile.
      const allowed = new Set([
        "fullscreen",
        "clipboard-sanitized-write",
        "clipboard-read",
      ]);
      callback(allowed.has(permission));
    });

    // The focus policy, in one line: a space the agent just made appears in the
    // sidebar, but it does not yank the view away from a space the human is using.
    this.focusForAgent(space);
    this.emitChange();
    return this.describe(space);
  }

  /**
   * Show a space in the shell. Explicit (the human clicked the sidebar), so it
   * always wins.
   */
  setFocusedSpace(spaceId) {
    const space = this.get(spaceId);
    this.focusedSpaceId = space.id;
    const window = this.window;
    if (window && !window.isDestroyed()) {
      // The title carries the id because two spaces may share a name ("space-3"
      // reused after a close) and `ui.captureWindow` matches on the exact title.
      window.setTitle(`aragon-browser - ${space.name} (#${space.id})`);
      if (!window.isVisible()) window.show();
      if (window.isMinimized()) window.restore();
    }
    this.layout();
    this.emitChange();
    return this.describe(space);
  }

  /**
   * Focus a space on the agent's behalf when the agent merely *selects* or creates
   * it: the rail entry appears, but the human's view is left alone.
   *
   * This is only the cheap half of the policy. Chromium drops pointer and keyboard
   * input for a page it does not consider visible (`document.visibilityState` is
   * "hidden"), so the moment the agent actually *acts* on the space, `activeTab()`
   * brings it on stage - see `ensureOnStage()`. Creating a space is quiet; driving
   * one is visible.
   *
   * Returns whether the view actually moved, so a caller (and a test) can tell
   * "the browser put it in the sidebar" from "the browser switched to it".
   */
  focusForAgent(space) {
    const current =
      this.focusedSpaceId === null ? null : this.spaces.get(this.focusedSpaceId) ?? null;
    if (current === null || current.id === space.id || current.owner === "agent") {
      this.setFocusedSpace(space.id);
      return true;
    }
    // The human is looking at a space of their own: leave the view alone. The new
    // space is still in the sidebar, with its agent dot.
    return false;
  }

  /**
   * Put a space on stage because something is about to touch its page.
   *
   * Not cosmetic: a web contents the window is not showing reports
   * `document.visibilityState === "hidden"` and Chromium discards real
   * `Input.dispatch*` events for it - verified by the smoke suite, where a click in
   * a parked background space reached nothing. An agent that can read but not click
   * is useless, so acting implies being on screen.
   */
  ensureOnStage(space) {
    if (this.focusedSpaceId === space.id) return false;
    this.setFocusedSpace(space.id);
    return true;
  }

  /**
   * Geometry AND visibility for every tab of every space - they share one client
   * area, so there is exactly one place that decides what the window shows.
   *
   * The focused space's active tab sits in the page area. Everything else keeps its
   * full size but is parked just outside the window instead of being hidden:
   * `setVisible(false)` also stops that web contents from receiving input - a click
   * in a background page is then silently dropped (the smoke suite fails on exactly
   * that) - and an agent that can see but not click is useless. Parking off-window
   * keeps the human's page on screen and the agent's page alive and drivable.
   */
  layout() {
    const window = this.window;
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    const onStage = pageBounds({ width, height });
    const offStage = { ...onStage, x: width + 8 };
    for (const space of this.spaces.values()) {
      for (const tab of space.tabs) {
        const showing = space.id === this.focusedSpaceId && tab.id === space.activeTabId;
        tab.view.setBounds(showing ? onStage : offStage);
        if (typeof tab.view.setVisible === "function") tab.view.setVisible(true);
      }
    }
  }

  async createTab(spaceId, url = "about:blank", { force = false, origin = "agent" } = {}) {
    const space = this.get(spaceId);
    if (!force) this.requireAgentControl(space);
    const sessionForSpace = session.fromPartition(space.partition);
    const view = new WebContentsView({
      webPreferences: {
        session: sessionForSpace,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const tab = {
      id: this.nextTabId++,
      // Durable label (p1, p2, ...) so a caller can name a Page across rounds
      // instead of juggling tab ids that change when a tab closes.
      label: `p${this.nextPageLabel++}`,
      origin,
      view,
      title: "",
      channel: new CdpChannel(view.webContents, `space-${space.id}-tab`),
    };
    space.tabs.push(tab);
    const window = this.#ensureWindow();
    space.window = window;
    window.contentView.addChildView(view);
    this.activateTab(space, tab.id);

    view.webContents.on("page-title-updated", (_event, title) => {
      tab.title = title;
      this.emitChange();
    });
    view.webContents.on("did-navigate", () => {
      // A new document invalidates every ref captured in the old one.
      space.refs.invalidateSession("root");
      this.emitChange();
    });
    view.webContents.on("did-navigate-in-page", () => this.emitChange());
    view.webContents.on("destroyed", () => {
      space.tabs = space.tabs.filter((entry) => entry !== tab);
      this.emitChange();
    });
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      // A human clicking target="_blank" (or a page calling window.open) must get
      // a tab even while they own the space - that is *their* action, not the
      // agent's - so this bypasses the control check and marks the tab as
      // user-owned (spaces.finish never closes those). The catch matters: `void`
      // on a promise that rejects is an unhandled rejection, and loadURL can fail.
      void this.createTab(space.id, target, { force: true, origin: "user" }).catch(() => {});
      return { action: "deny" };
    });

    const normalized = normalizeUrl(url);
    if (normalized) await view.webContents.loadURL(normalized);
    this.emitChange();
    return {
      id: tab.id,
      label: tab.label,
      origin: tab.origin,
      spaceId: space.id,
      active: true,
      url: view.webContents.getURL(),
    };
  }

  activateTab(space, tabId) {
    space.activeTabId = tabId;
    this.layout();
    this.emitChange();
  }

  activeTab(spaceId) {
    const space = this.get(spaceId);
    const tab = space.tabs.find((entry) => entry.id === space.activeTabId);
    if (!tab) {
      throw new AragonError(
        ERROR_CODES.WEB_CONTENTS_UNAVAILABLE,
        `space ${space.id} has no open tab; call createTab first`,
      );
    }
    // Any kernel path that resolves "the page to act on" goes through here, so this
    // is also the one place that guarantees the page can receive input. It runs
    // after the tab check on purpose: a call that is about to fail must not move
    // the human's view first.
    this.ensureOnStage(space);
    return tab;
  }

  listTabs(spaceId) {
    const space = this.get(spaceId);
    return space.tabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      origin: tab.origin,
      spaceId: space.id,
      url: tab.view.webContents.getURL(),
      title: tab.title,
      active: tab.id === space.activeTabId,
    }));
  }

  async closeTab(spaceId, tabId, { force = false } = {}) {
    const space = this.get(spaceId);
    if (force !== true) this.requireAgentControl(space);
    const tab = space.tabs.find((entry) => entry.id === tabId);
    if (!tab) {
      throw new AragonError(ERROR_CODES.INVALID_ARGUMENT, `tab ${tabId} is not open`);
    }
    await tab.channel.detach();
    const window = space.window && !space.window.isDestroyed() ? space.window : this.window;
    if (window && !window.isDestroyed()) {
      try {
        window.contentView.removeChildView(tab.view);
      } catch {
        // Already detached (e.g. the window is going away).
      }
    }
    space.tabs = space.tabs.filter((entry) => entry !== tab);
    if (space.activeTabId === tabId) {
      const next = space.tabs[space.tabs.length - 1];
      space.activeTabId = next ? next.id : null;
    }
    try {
      tab.view.webContents.close();
    } catch {
      // Already gone.
    }
    this.layout();
    this.emitChange();
  }

  handOff(spaceId) {
    const space = this.get(spaceId);
    space.owner = "user";
    space.agentState = "paused";
    this.emitChange();
    return this.describe(space);
  }

  takeOver(spaceId) {
    const space = this.get(spaceId);
    space.owner = "agent";
    this.emitChange();
    return this.describe(space);
  }

  setAgentState(spaceId, state) {
    const space = this.get(spaceId);
    const allowed = new Set(["idle", "running", "paused", "error"]);
    if (!allowed.has(state)) throw invalidArgument(`state must be one of ${[...allowed]}`);
    space.agentState = state;
    this.emitChange();
    return this.describe(space);
  }

  async close(spaceId) {
    const space = this.get(spaceId);
    space.owner = "user";
    await this.#dispose(space);
    this.emitChange();
    return { id: space.id, closed: true };
  }

  async #dispose(space) {
    for (const tab of space.tabs) {
      await tab.channel.detach();
    }
    const window = this.window;
    for (const tab of space.tabs) {
      if (window && !window.isDestroyed()) {
        try {
          window.contentView.removeChildView(tab.view);
        } catch {
          // Already detached.
        }
      }
      try {
        tab.view.webContents.close();
      } catch {
        // Already gone.
      }
    }
    space.tabs = [];
    space.refs.reset();
    this.spaces.delete(space.id);
    space.window = null;

    if (this.focusedSpaceId === space.id) {
      // Hand the view to a surviving space. No setFocusedSpace here: this runs
      // inside dispose loops, and each call would emit a state change of its own.
      const next = [...this.spaces.values()].at(-1) ?? null;
      this.focusedSpaceId = next ? next.id : null;
      if (next && window && !window.isDestroyed()) {
        window.setTitle(`aragon-browser - ${next.name} (#${next.id})`);
      }
    }
    this.layout();

    // The window IS the app. When the last space goes, the window goes too, so
    // `window-all-closed` quits instead of leaving an empty shell behind.
    if (this.spaces.size === 0 && window && !window.isDestroyed()) {
      this.window = null;
      window.destroy();
    }
  }

  async disposeAll() {
    for (const space of [...this.spaces.values()]) await this.#dispose(space);
  }

  emitChange() {
    this.onStateChange(this.stateSnapshot());
  }
}

export function normalizeUrl(input) {
  if (input === undefined || input === null || input === "") return "about:blank";
  const value = String(input).trim();
  if (value === "about:blank") return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(value)) return `http://${value}`;
  return `https://${value}`;
}
