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
 * browser": its own window, its own tabs, and its own Electron session
 * partition, so cookies/localStorage/indexedDB of two spaces cannot see each
 * other even on the same site.
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

  /**
   * Which space owns this webContents? Used to pin renderer RPCs to the window
   * that sent them, so a `spaceId` in the payload cannot address a sibling window.
   * Returns null for anything that is not a space window (e.g. the API window).
   */
  spaceIdForContents(contents) {
    for (const space of this.spaces.values()) {
      if (space.window && !space.window.isDestroyed() && space.window.webContents === contents) {
        return space.id;
      }
    }
    return null;
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
      window: null,
      lastEvent: null,
    };

    const window = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: LAYOUT.minWidth,
      minHeight: LAYOUT.minHeight,
      title: `aragon-browser - ${space.name} (#${id})`,
      backgroundColor: "#11131a",
      show: false,
      // No native caption. The renderer paints its own title bar (brand plus the
      // minimize / maximize / close buttons, see src/renderer/index.html).
      // `frame: false` on Windows keeps the WS_THICKFRAME border because
      // `thickFrame` defaults to true, so the window still resizes from every
      // edge, still Aero-snaps and still keeps its shadow - only the caption, and
      // with it the system menu, is gone.
      frame: false,
      // The application menu still exists and still owns every accelerator; it is
      // just not worth 26px of vertical chrome. Alt reveals it.
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "..", "preload", "ui-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        additionalArguments: [`--aragon-space-id=${id}`],
      },
    });
    space.window = window;
    this.spaces.set(id, space);

    // The renderer's title bar draws a maximize/restore glyph, so it has to know
    // the real window state. Maximizing also changes the client area without a
    // resize event on every platform, so layout is re-run from these too.
    const publishWindowState = () => {
      // Both checks matter: closing a space destroys its tab views first, and the
      // 'destroyed' handler they trigger can run while `isDestroyed()` is still
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
      this.layout(space);
    });
    window.on("unmaximize", () => {
      publishWindowState();
      this.layout(space);
    });
    // Alt reveals the auto-hidden application menu, which shrinks the CLIENT area
    // while the HWND stays the same size - so no resize/resized event fires and the
    // page views keep their old bounds, ending up over the status bar. These two
    // events are the only signal the menu toggled.
    window.on("menu-bar-visible", () => this.layout(space));
    window.on("menu-bar-hidden", () => this.layout(space));

    window.loadFile(path.join(RENDERER_DIR, "index.html"));
    // The renderer's `<title>` must not rename the window. The OS title is how a
    // human tells these windows apart in the task bar (one BrowserWindow per
    // space), and it is also how `ui.captureWindow` identifies its own window:
    // without this every space window is called "aragon-browser", the same name
    // as any installed build you happen to have open.
    window.on("page-title-updated", (event) => event.preventDefault());
    window.once("ready-to-show", () => {
      window.show();
      // Lay out again once the window is really on screen. The client area at
      // creation time is not the client area users get: applying the application
      // menu and showing the window shave pixels off it (observed: 821px -> 795px),
      // and nothing fires a resize for that. Without this the tab views keep the
      // old bounds and the page view hangs off the bottom of the window - over the
      // renderer's status bar.
      this.layout(space);
    });
    window.on("resize", () => this.layout(space));
    window.on("resized", () => this.layout(space));
    window.on("enter-full-screen", () => {
      publishWindowState();
      this.layout(space);
    });
    window.on("leave-full-screen", () => {
      publishWindowState();
      this.layout(space);
    });
    window.on("closed", () => {
      void this.#dispose(space);
    });

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

    this.emitChange();
    return this.describe(space);
  }

  layout(space) {
    if (!space.window || space.window.isDestroyed()) return;
    const [width, height] = space.window.getContentSize();
    const bounds = pageBounds({ width, height });
    for (const tab of space.tabs) {
      tab.view.setBounds(bounds);
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
    space.window.contentView.addChildView(view);
    this.layout(space);
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
    for (const tab of space.tabs) {
      const visible = tab.id === tabId;
      if (typeof tab.view.setVisible === "function") tab.view.setVisible(visible);
    }
    this.layout(space);
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
    space.window.contentView.removeChildView(tab.view);
    space.tabs = space.tabs.filter((entry) => entry !== tab);
    if (space.activeTabId === tabId) {
      const next = space.tabs[space.tabs.length - 1];
      space.activeTabId = next ? next.id : null;
      if (next) next.view.setVisible(true);
    }
    try {
      tab.view.webContents.close();
    } catch {
      // Already gone.
    }
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
    space.tabs = [];
    space.refs.reset();
    this.spaces.delete(space.id);
    if (space.window && !space.window.isDestroyed()) space.window.destroy();
    space.window = null;
  }

  async disposeAll() {
    for (const space of [...this.spaces.values()]) await this.#dispose(space);
  }

  emitChange() {
    this.onStateChange(this.list());
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
