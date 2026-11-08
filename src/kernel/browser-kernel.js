import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";
import { BrowserWindow, desktopCapturer } from "electron";
import {
  AragonError,
  ERROR_CODES,
  invalidArgument,
  operationFailed,
  optionalObject,
  requireSpaceId,
  requireString,
} from "../shared/protocol.js";
import { buildSnapshot } from "./ax-snapshot.js";
import { ROOT_SESSION } from "./cdp-channel.js";
import { ElementResolver } from "./element-resolver.js";
import { ElementResolutionError } from "./locator.js";
import {
  clickRef,
  fillRef,
  hoverRef,
  pressKey,
  scrollPage,
  typeText,
} from "./actions.js";
import {
  doubleClickAt,
  dragBetween,
  readClipboard,
  rightClickAt,
  setFiles,
  writeClipboard,
} from "./interactions.js";
import {
  waitForDialog,
  waitForExpression,
  waitForLoad,
  waitForNavigation,
  waitForNetworkIdle,
  waitForTarget,
  waitForText,
} from "./waits.js";
import { TaskSpaceManager } from "./task-spaces.js";
import { LAYOUT } from "../shared/layout.js";
import {
  loadLearnedContext,
  loadBrowserToolSource,
  runNodeSiteTool,
  validateLearnings,
  wrapBrowserTool,
} from "./learning/index.js";

const MAX_SNAPSHOT_CHARS = 120_000;

/**
 * The only `ui.*` methods the agent surface may call: read-only capture/layout
 * helpers that the CLI exposes as `page.captureChrome()` etc. Everything else on
 * the ui surface (closeTab with force, takeOver, closeSpace, navigate) is the
 * browser's own chrome and must not be reachable from an agent script.
 */
const AGENT_UI_ALLOWLIST = new Set(["ui.captureChrome", "ui.captureWindow", "ui.layout"]);

/**
 * The kernel: the single place that answers RPC. The CLI, the window UI and any
 * future MCP wrapper all go through here, so "what the browser can do" is
 * literally this method table.
 */
export class BrowserKernel {
  constructor({ version = "0.1.0", learningRoot } = {}) {
    this.version = version;
    this.learningRoot = learningRoot;
    this.transport = null;
    this.spaces = new TaskSpaceManager({
      onStateChange: (state) => {
        this.transport?.broadcast({
          event: "state",
          spaces: state.spaces,
          focusedSpaceId: state.focusedSpaceId,
        });
      },
    });
    this.methods = this.#buildMethods();
  }

  attach(transport) {
    this.transport = transport;
    return this;
  }

  /**
   * Answer one RPC.
   *
   * `surface` is the caller's identity, not a decoration: the method table holds
   * both the agent surface and the `ui.*` surface, and the ui methods are the ones
   * that deliberately skip the ownership check (`ui.closeTab` passes force, ...).
   * The renderer IPC handler is the only caller allowed to claim surface "ui".
   */
  async dispatch(method, params = {}, { surface = "agent" } = {}) {
    if (surface !== "ui" && method.startsWith("ui.") && !AGENT_UI_ALLOWLIST.has(method)) {
      throw new AragonError(
        ERROR_CODES.NO_SUCH_METHOD,
        `"${method}" belongs to the browser UI surface, not the agent surface`,
      );
    }
    const handler = this.methods[method];
    if (!handler) {
      throw new AragonError(
        ERROR_CODES.NO_SUCH_METHOD,
        `unknown method "${method}"; run \`aragon-browser skill\` for the surface`,
      );
    }
    return handler(optionalObject(params, "params"));
  }

  /** Resolve anything the caller accepts (@ref, css, loc=..., xpath=). */
  async #resolveTarget(space, tab, params, { purpose = "target" } = {}) {
    const target = params.target ?? params.ref ?? params.selector;
    if (target === undefined || target === null || target === "") {
      throw invalidArgument(
        "target is required: pass a snapshot @ref, or a locator such as css:#id, " +
          'loc=role:button[name="Save"], text=..., href:/path, xpath=//...',
      );
    }
    const resolver = new ElementResolver(tab.channel);
    return resolver.resolve(target, { registry: space.refs, purpose });
  }

  #buildMethods() {
    const spaces = this.spaces;

    const spaceOf = (params) => spaces.get(requireSpaceId(params.spaceId));

    /** Common prologue: space + control check + active tab. */
    const agentTab = (params) => {
      const space = spaceOf(params);
      spaces.requireAgentControl(space);
      return { space, tab: spaces.activeTab(space.id) };
    };

    const resolveFor = async (params, purpose = "target") => {
      const { space, tab } = agentTab(params);
      await tab.channel.attach();
      const entry = await this.#resolveTarget(space, tab, params, { purpose });
      return { space, tab, entry };
    };

    return {
      "runtime.version": async () => {
        // Never return a Promise inside the payload: JSON serialisation drops it
        // silently and the field just looks empty on the client.
        const { learningsRoot, iterLearningDirs, loadLearningManifest } = await import(
          "./learning/manifest.js"
        );
        let learnedSites = 0;
        try {
          const root = this.learningRoot ?? learningsRoot();
          for (const siteDir of await iterLearningDirs(root)) {
            try {
              await loadLearningManifest(siteDir);
              learnedSites += 1;
            } catch {
              // Broken manifests are reported by learn.validate, not here.
            }
          }
        } catch {
          learnedSites = 0;
        }
        return {
          currentVersion: this.version,
          updateAvailable: false,
          app: "aragon-browser",
          engine: `electron ${process.versions.electron ?? "?"} / chromium ${process.versions.chrome ?? "?"}`,
          node: process.versions.node,
          platform: `${process.platform}-${process.arch}`,
          spaces: spaces.list().length,
          // One window, many spaces. Reported as a number so an agent (and the
          // smoke test) can prove a new space did not open a window of its own.
          windows: BrowserWindow.getAllWindows().length,
          focusedSpaceId: spaces.focusedSpaceId,
          learnedSites,
          packaged: process.env.ARAGON_PACKAGED === "1",
        };
      },

      "profiles.list": async () => ({ profiles: spaces.listProfiles() }),

      "spaces.list": async () => ({ spaces: spaces.list() }),

      "spaces.create": async (params) =>
        spaces.create({
          name: params.name,
          profileId: params.profileId ?? spaces.defaultProfileId,
        }),

      "spaces.claim": async (params) => {
        const space = spaces.get(requireSpaceId(params.spaceId));
        if (params.name) space.name = requireString(params.name, "name");
        // Selecting a space must not steal it. `taskSpace(id)` and
        // currentTaskSpace() both come through here, so an unconditional
        // `owner = "agent"` made the whole handoff model optional: one routine
        // call and a space the user was typing in belonged to the agent again.
        // Taking control stays a separate, explicit step (spaces.takeOver).
        if (space.owner !== "user" || params.takeOver === true) {
          space.owner = "agent";
        }
        // Selecting a space is also how an agent says "this is where I work", so it
        // should be on screen - unless the human is looking at a space of their own,
        // in which case the sidebar entry (and its agent dot) is enough.
        spaces.focusForAgent(space);
        spaces.emitChange();
        return spaces.describe(space);
      },

      "spaces.close": async (params) => spaces.close(requireSpaceId(params.spaceId)),

      "spaces.complete": async (params) => {
        const space = spaces.get(requireSpaceId(params.spaceId));
        space.agentState = "idle";
        spaces.emitChange();
        return spaces.describe(space);
      },

      /**
       * finish(): keep is required on purpose. "Close everything" is
       * destructive, so the caller must say which Pages survive instead of
       * relying on a default that could delete a tab the user was using.
       */
      "spaces.finish": async (params) => {
        const space = spaceOf(params);
        const keep = params.keep;
        if (keep === undefined) {
          throw invalidArgument(
            'finish() requires keep: "all" or an array of Page labels',
          );
        }
        if (keep !== "all" && !Array.isArray(keep)) {
          throw invalidArgument('keep must be "all" or an array of unique non-empty Page labels');
        }
        const keptLabels = [];
        const closedLabels = [];
        const protectedTabs = [];
        for (const tab of [...space.tabs]) {
          const label = tab.label ?? null;
          const keepThis =
            keep === "all" || (Array.isArray(keep) && label !== null && keep.includes(label));
          if (keepThis) {
            keptLabels.push(label ?? `tab-${tab.id}`);
            continue;
          }
          if (tab.origin === "user") {
            // A tab the human opened is never closed by the agent's finish().
            protectedTabs.push(label ?? `tab-${tab.id}`);
            continue;
          }
          closedLabels.push(label ?? `tab-${tab.id}`);
          await spaces.closeTab(space.id, tab.id, { force: true });
        }
        const preservedUnmanagedCount = space.tabs.length;
        let closedSpace = false;
        if (keep !== "all" && space.tabs.length === 0 && protectedTabs.length === 0) {
          await spaces.close(space.id);
          closedSpace = true;
        }
        spaces.emitChange();
        return {
          spaceId: space.id,
          closedSpace,
          keptManagedLabels: keptLabels,
          closedManagedLabels: closedLabels,
          preservedUnmanagedCount,
        };
      },

      "spaces.handOff": async (params) => spaces.handOff(requireSpaceId(params.spaceId)),

      "spaces.takeOver": async (params) => spaces.takeOver(requireSpaceId(params.spaceId)),

      /**
       * Wait for the human to hand a space back. Polls without taking control:
       * an agent that grabs control while someone is typing is a bug, and
       * takeOver is only legal after an explicit hand-off anyway.
       */
      "spaces.waitForControl": async (params) => {
        const space = spaceOf(params);
        const timeout = Number.isInteger(params.timeout) ? params.timeout : 600_000;
        const interval = Number.isInteger(params.interval) ? params.interval : 20_000;
        const deadline = Date.now() + timeout;
        for (;;) {
          if (space.owner === "agent") return { spaceId: space.id, ownership: space.owner };
          if (Date.now() >= deadline) {
            throw new AragonError(
              ERROR_CODES.TASK_SPACE_USER_IN_CONTROL,
              `space ${space.id} is still owned by the user after ${timeout}ms`,
            );
          }
          await delay(interval);
        }
      },

      "spaces.setAgentState": async (params) => {
        const spaceId = requireSpaceId(params.spaceId);
        return spaces.setAgentState(spaceId, String(params.state ?? ""));
      },

      "spaces.focus": async (params) => {
        const space = spaceOf(params);
        // Switching is in-window now: focus the space, then the OS window. There is
        // no sibling window to bring forward any more.
        const descriptor = spaces.setFocusedSpace(space.id);
        space.window?.focus();
        return descriptor;
      },

      "tabs.create": async (params) => {
        const space = spaceOf(params);
        spaces.requireAgentControl(space);
        return spaces.createTab(space.id, params.url ?? "about:blank");
      },

      "tabs.list": async (params) => ({
        tabs: spaces.listTabs(requireSpaceId(params.spaceId)),
      }),

      "tabs.activate": async (params) => {
        const space = spaceOf(params);
        const tabId = Number(params.tabId);
        if (!Number.isInteger(tabId)) throw invalidArgument("tabId must be an integer");
        spaces.activateTab(space, tabId);
        return { spaceId: space.id, activeTabId: tabId };
      },

      "tabs.close": async (params) => {
        const space = spaceOf(params);
        spaces.requireAgentControl(space);
        return spaces.closeTab(space.id, Number(params.tabId));
      },

      "snapshot.capture": async (params) => {
        const space = spaceOf(params);
        spaces.requireAgentControl(space);
        return this.captureSnapshot(space, params);
      },

      "cdp.send": async (params) => {
        const space = spaceOf(params);
        spaces.requireAgentControl(space);
        const message = optionalObject(params.message, "message");
        const method = requireString(message.method, "message.method");
        const tab = spaces.activeTab(space.id);
        await tab.channel.attach();
        const sessionId =
          message.sessionId === undefined || message.sessionId === null
            ? ROOT_SESSION
            : String(message.sessionId);
        return {
          result: await tab.channel.send(method, message.params ?? {}, sessionId),
        };
      },

      // ---- actions ----------------------------------------------------------

      "act.click": async (params) => {
        const { space, tab, entry } = await resolveFor(params, "click");
        const result = await clickRef(tab.channel, entry, {
          button: params.button ?? "left",
          clickCount: Number.isInteger(params.clickCount) ? params.clickCount : 1,
        });
        return { spaceId: space.id, ref: entry.ref ?? null, ...result };
      },

      "act.doubleClick": async (params) => {
        const { space, tab, entry } = await resolveFor(params, "doubleClick");
        const { pointFor } = await import("./actions.js");
        const point = await pointFor(tab.channel, entry);
        const result = await doubleClickAt(tab.channel, point);
        return { spaceId: space.id, ...result };
      },

      "act.rightClick": async (params) => {
        const { space, tab, entry } = await resolveFor(params, "rightClick");
        const { pointFor } = await import("./actions.js");
        const point = await pointFor(tab.channel, entry);
        return { spaceId: space.id, ...(await rightClickAt(tab.channel, point)) };
      },

      "act.fill": async (params) => {
        const { space, tab, entry } = await resolveFor(params, "fill");
        const text = params.text === undefined ? "" : String(params.text);
        const result = await fillRef(tab.channel, entry, text, {
          submit: params.submit === true,
          delayMs: Number.isInteger(params.delayMs) ? params.delayMs : 0,
        });
        return { spaceId: space.id, ref: entry.ref ?? null, ...result };
      },

      "act.type": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        await typeText(tab.channel, params.text ?? "", {
          delayMs: Number.isInteger(params.delayMs) ? params.delayMs : 12,
        });
        return { spaceId: space.id, typed: String(params.text ?? "").length };
      },

      "act.press": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        const key = requireString(params.key, "key");
        return { spaceId: space.id, ...(await pressKey(tab.channel, key)) };
      },

      "act.hover": async (params) => {
        const { space, tab, entry } = await resolveFor(params, "hover");
        await hoverRef(tab.channel, entry);
        return { spaceId: space.id, ref: entry.ref ?? null };
      },

      "act.scroll": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        let point;
        if (params.target !== undefined || params.ref !== undefined) {
          const entry = await this.#resolveTarget(space, tab, params, { purpose: "scroll" });
          const { pointFor } = await import("./actions.js");
          point = await pointFor(tab.channel, entry, { scroll: true });
        }
        const dx = Number(params.dx ?? 0);
        const dy = Number(params.dy ?? 600);
        await scrollPage(tab.channel, { dx, dy, x: point?.x, y: point?.y });
        return { spaceId: space.id, dx, dy };
      },

      "act.upload": async (params) => {
        const { space, tab, entry } = await resolveFor(params, "upload");
        const files = params.files ?? params.paths;
        const result = await setFiles(tab.channel, entry, files);
        return { spaceId: space.id, ...result };
      },

      "act.drag": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        const fromEntry = await this.#resolveTarget(space, tab, {
          ...params,
          target: params.from ?? params.target,
        }, { purpose: "drag source" });
        if (params.to === undefined) {
          throw invalidArgument("drag needs `to`: the drop target");
        }
        const toEntry = await this.#resolveTarget(space, tab, { target: params.to }, {
          purpose: "drag target",
        });
        const result = await dragBetween(tab.channel, fromEntry, toEntry, params);
        return { spaceId: space.id, ...result };
      },

      "act.navigate": async (params) => {
        const { space, tab } = agentTab(params);
        const url = requireString(params.url, "url");
        space.refs.invalidateSession(ROOT_SESSION);
        const response = await tab.view.webContents.loadURL(url);
        return { spaceId: space.id, url: tab.view.webContents.getURL(), httpStatus: response?.statusCode ?? null };
      },

      "act.goBack": async (params) => {
        const { space, tab } = agentTab(params);
        const history = tab.view.webContents.navigationHistory;
        if (!history?.canGoBack?.()) {
          throw operationFailed("there is no previous page to go back to");
        }
        space.refs.invalidateSession(ROOT_SESSION);
        history.goBack();
        return { spaceId: space.id, url: tab.view.webContents.getURL() };
      },

      "act.goForward": async (params) => {
        const { space, tab } = agentTab(params);
        const history = tab.view.webContents.navigationHistory;
        if (!history?.canGoForward?.()) {
          throw operationFailed("there is no forward page to go to");
        }
        space.refs.invalidateSession(ROOT_SESSION);
        history.goForward();
        return { spaceId: space.id, url: tab.view.webContents.getURL() };
      },

      "act.reload": async (params) => {
        const { space, tab } = agentTab(params);
        space.refs.invalidateSession(ROOT_SESSION);
        tab.view.webContents.reload();
        return { spaceId: space.id };
      },

      // ---- observers --------------------------------------------------------

      "page.info": async (params) => {
        const space = spaceOf(params);
        const tab = spaces.activeTab(space.id);
        const history = tab.view.webContents.navigationHistory;
        return {
          spaceId: space.id,
          url: tab.view.webContents.getURL(),
          title: tab.title,
          tabs: space.tabs.length,
          canGoBack: Boolean(history?.canGoBack?.()),
          canGoForward: Boolean(history?.canGoForward?.()),
          isLoading: tab.view.webContents.isLoading(),
        };
      },

      "page.evaluate": async (params) => {
        const { space, tab } = agentTab(params);
        const expression = requireString(params.expression, "expression");
        await tab.channel.attach();
        const sessionId =
          params.sessionId === undefined || params.sessionId === null
            ? ROOT_SESSION
            : String(params.sessionId);
        const result = await tab.channel.send(
          "Runtime.evaluate",
          {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
            allowUnsafeEvalBlockedByCSP: true,
          },
          sessionId,
        );
        if (result?.exceptionDetails) {
          throw operationFailed(
            `page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
          );
        }
        return { spaceId: space.id, value: result?.result?.value ?? null };
      },

      "page.frames": async (params) => {
        const space = spaceOf(params);
        const tab = spaces.activeTab(space.id);
        await tab.channel.attach();
        await tab.channel.settleChildSessions();
        return {
          frames: tab.channel.sessionEntries().map((entry) => ({
            sessionId: entry.sessionId,
            frameId: entry.frameId,
            parentSessionId: entry.parent,
            type: entry.type,
          })),
        };
      },

      // ---- waits ------------------------------------------------------------

      /** Legacy expression wait, kept because helper code and users call it. */
      "wait.for": async (params) => {
        const { space, tab } = agentTab(params);
        const expression = requireString(params.expression, "expression");
        await tab.channel.attach();
        const timeoutMs = Number.isInteger(params.timeoutMs) ? params.timeoutMs : 10_000;
        const intervalMs = Number.isInteger(params.intervalMs) ? params.intervalMs : 100;
        const deadline = Date.now() + timeoutMs;
        let last = null;
        while (Date.now() < deadline) {
          const result = await tab.channel.sendOptional("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
          });
          if (result?.exceptionDetails) {
            throw operationFailed(
              `condition threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
            );
          }
          last = result?.result?.value;
          if (last === true) return { spaceId: space.id, ok: true, value: last };
          await delay(intervalMs);
        }
        return { spaceId: space.id, ok: false, value: last ?? null };
      },

      "wait.target": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        const resolver = new ElementResolver(tab.channel);
        const result = await waitForTarget(resolver, params.target ?? params.ref, {
          registry: space.refs,
          timeoutMs: params.timeoutMs,
          intervalMs: params.intervalMs,
        });
        return { spaceId: space.id, found: true, waitedMs: result.waitedMs };
      },

      "wait.text": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        const result = await waitForText(tab.channel, requireString(params.text, "text"), {
          timeoutMs: params.timeoutMs,
          intervalMs: params.intervalMs,
        });
        return { spaceId: space.id, ...result };
      },

      "wait.expression": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        const result = await waitForExpression(
          tab.channel,
          requireString(params.expression, "expression"),
          { timeoutMs: params.timeoutMs, intervalMs: params.intervalMs },
        );
        return { spaceId: space.id, ...result };
      },

      "wait.load": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        const result = await waitForLoad(tab.channel, {
          timeoutMs: params.timeoutMs,
          intervalMs: params.intervalMs,
        });
        return { spaceId: space.id, ...result };
      },

      "wait.navigation": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        const result = await waitForNavigation(tab.channel, {
          timeoutMs: params.timeoutMs,
          intervalMs: params.intervalMs,
        });
        return { spaceId: space.id, ...result };
      },

      "wait.networkIdle": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        const result = await waitForNetworkIdle(tab.channel, {
          timeoutMs: params.timeoutMs,
          intervalMs: params.intervalMs,
          idleMs: params.idleMs,
        });
        return { spaceId: space.id, ...result };
      },

      "wait.dialog": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        const result = await waitForDialog(tab.channel, {
          timeoutMs: params.timeoutMs,
          intervalMs: params.intervalMs,
        });
        const dialog = result.value;
        return {
          spaceId: space.id,
          dialog: {
            type: dialog.type,
            message: dialog.message,
            defaultPrompt: dialog.defaultPrompt,
          },
          handled: dialog.handled,
        };
      },

      // ---- dialogs ----------------------------------------------------------

      "dialog.list": async (params) => {
        const space = spaceOf(params);
        const tab = spaces.activeTab(space.id);
        await tab.channel.attach();
        return {
          dialogs: tab.channel.dialogs.map((entry) => ({
            type: entry.type,
            message: entry.message,
            defaultPrompt: entry.defaultPrompt,
            handled: entry.handled,
          })),
          policy: tab.channel.dialogPolicy,
        };
      },

      "dialog.answer": async (params) => {
        const space = spaceOf(params);
        space && spaces.requireAgentControl(space);
        const tab = spaces.activeTab(space.id);
        await tab.channel.attach();
        const answered = await tab.channel.answerDialog({
          accept: params.accept !== false,
          promptText: params.promptText,
        });
        return { spaceId: space.id, answered };
      },

      "dialog.policy": async (params) => {
        const space = spaceOf(params);
        spaces.requireAgentControl(space);
        const tab = spaces.activeTab(space.id);
        await tab.channel.attach();
        const policy = tab.channel.setDialogPolicy(String(params.policy ?? ""), {
          acceptText: params.acceptText,
        });
        return { spaceId: space.id, policy };
      },

      // ---- clipboard --------------------------------------------------------

      "clipboard.write": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        return { spaceId: space.id, ...(await writeClipboard(tab.channel, params.text ?? "", ROOT_SESSION)) };
      },

      "clipboard.read": async (params) => {
        const space = spaceOf(params);
        const tab = spaces.activeTab(space.id);
        await tab.channel.attach();
        return { spaceId: space.id, ...(await readClipboard(tab.channel, ROOT_SESSION)) };
      },

      // ---- events -----------------------------------------------------------

      "events.history": async (params) => {
        const space = spaceOf(params);
        const tab = spaces.activeTab(space.id);
        await tab.channel.attach();
        return {
          events: tab.channel.history({
            method: params.method,
            sessionId: params.sessionId,
            sinceSeq: Number(params.sinceSeq ?? 0),
            limit: Number(params.limit ?? 200),
          }),
          sequence: tab.channel.eventSequence,
        };
      },

      // ---- screenshots ------------------------------------------------------

      "shot.capture": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        const format = params.format === "jpeg" ? "jpeg" : "png";
        // captureBeyondViewport without an explicit clip is a hang, not a
        // full-page shot: the clip has to come from the layout metrics.
        let clip = params.clip;
        if (params.fullPage === true && !clip) {
          const metrics = await tab.channel.send("Page.getLayoutMetrics");
          const size = metrics?.cssContentSize ?? metrics?.contentSize;
          if (!size || !(size.width > 0) || !(size.height > 0)) {
            throw operationFailed("the page has no layout size to capture");
          }
          clip = {
            x: 0,
            y: 0,
            width: Math.ceil(size.width),
            height: Math.ceil(size.height),
            scale: 1,
          };
        }
        const shot = await tab.channel.send("Page.captureScreenshot", {
          format,
          ...(clip ? { clip } : {}),
          ...(params.fullPage === true ? { captureBeyondViewport: true } : {}),
        });
        return { spaceId: space.id, format, base64: shot?.data ?? "" };
      },

      "highlight.mouse": async (params) => {
        const { space, tab } = agentTab(params);
        await tab.channel.attach();
        const x = Number(params.x ?? 0);
        const y = Number(params.y ?? 0);
        await tab.channel.sendOptional("Runtime.evaluate", {
          expression: `(() => {
            const id = '__aragon_mouse';
            document.getElementById(id)?.remove();
            const dot = document.createElement('div');
            dot.id = id;
            Object.assign(dot.style, {
              position: 'fixed', left: '${x}px', top: '${y}px', width: '18px',
              height: '18px', borderRadius: '50%', pointerEvents: 'none',
              background: 'rgba(96,165,250,0.85)', boxShadow: '0 0 0 6px rgba(96,165,250,0.25)',
              transform: 'translate(-50%,-50%)', zIndex: 2147483647,
              transition: 'opacity 400ms', opacity: '1',
            });
            document.documentElement.appendChild(dot);
            setTimeout(() => { dot.style.opacity = '0'; }, 900);
            setTimeout(() => dot.remove(), 1500);
          })()`,
        });
        return { spaceId: space.id, x, y };
      },

      // ---- learned site skills ---------------------------------------------

      "learn.context": async (params) => {
        const space = spaceOf(params);
        const tab = spaces.activeTab(space.id);
        const url = params.url ?? tab.view.webContents.getURL();
        const context = await loadLearnedContext(url, { root: this.learningRoot });
        return { spaceId: space.id, url, ...context };
      },

      "learn.list": async () => {
        const { siteSkillsForUrl, iterLearningDirs, loadLearningManifest } =
          await import("./learning/manifest.js");
        const { learningsRoot } = await import("./learning/manifest.js");
        const root = this.learningRoot ?? learningsRoot();
        const sites = [];
        for (const siteDir of await iterLearningDirs(root)) {
          try {
            const manifest = await loadLearningManifest(siteDir);
            sites.push({
              id: manifest.id,
              name: manifest.name,
              domains: manifest.domains ?? [],
              nodeTools: Object.keys(manifest.nodeTools ?? {}),
              browserTools: Object.keys(manifest.browserTools ?? {}),
            });
          } catch {
            // A broken manifest is reported by learn.validate, not here.
          }
        }
        return { root, sites };
      },

      "learn.runTool": async (params) => {
        const space = spaceOf(params);
        spaces.requireAgentControl(space);
        const tab = spaces.activeTab(space.id);
        const siteId = requireString(params.siteId, "siteId");
        const toolName = requireString(params.toolName, "toolName");
        await tab.channel.attach();
        // The tool receives the live helper surface, bound to this space.
        const ctx = {
          box: this.#pageFacade(space, tab),
          space: this.#spaceFacade(space),
          helpers: this.#helperFacade(space),
          cliLog: (line) => this.transport?.broadcast({ event: "log", line: String(line) }),
        };
        const result = await runNodeSiteTool(siteId, toolName, params.args ?? {}, ctx, {
          root: this.learningRoot,
        });
        return { spaceId: space.id, siteId, toolName, result };
      },

      "learn.runBrowserTool": async (params) => {
        const space = spaceOf(params);
        spaces.requireAgentControl(space);
        const tab = spaces.activeTab(space.id);
        const siteId = requireString(params.siteId, "siteId");
        const toolName = requireString(params.toolName, "toolName");
        await tab.channel.attach();
        const source = await loadBrowserToolSource(siteId, toolName, {
          root: this.learningRoot,
        });
        const expression = wrapBrowserTool(source, params.args ?? {});
        const result = await tab.channel.send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        });
        if (result?.exceptionDetails) {
          throw operationFailed(
            `browser tool ${toolName} threw: ${
              result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
            }`,
          );
        }
        return { spaceId: space.id, siteId, toolName, result: result?.result?.value ?? null };
      },

      "learn.validate": async () => {
        const errors = await validateLearnings(this.learningRoot);
        return { ok: errors.length === 0, errors };
      },

      // ---- UI-facing methods ------------------------------------------------
      // Only these are reachable from the renderer: the IPC handler in main.js
      // refuses anything that does not start with "ui.".
      "ui.state": async () => ({
        spaces: spaces.list(),
        profiles: spaces.listProfiles(),
        version: this.version,
        runtimeFile: process.env.ARAGON_RUNTIME_FILE ?? null,
      }),

      "ui.newSpace": async (params) => {
        const descriptor = await spaces.create({
          name: params.name,
          profileId: params.profileId,
        });
        // A human clicked "+ new space": show it. (An agent creating a space goes
        // through the focus policy instead and never steals the view.)
        return spaces.setFocusedSpace(descriptor.id);
      },

      "ui.newTab": async (params) => {
        const space = spaceOf(params);
        return spaces.createTab(space.id, params.url ?? "about:blank", { force: true });
      },

      "ui.navigate": async (params) => {
        const space = spaceOf(params);
        const url = requireString(params.url, "url");
        const tab = spaces.activeTab(space.id);
        space.refs.invalidateSession(ROOT_SESSION);
        await tab.view.webContents.loadURL(url);
        return { url: tab.view.webContents.getURL() };
      },

      "ui.activateTab": async (params) => {
        const space = spaceOf(params);
        spaces.activateTab(space, Number(params.tabId));
        return spaces.describe(space);
      },

      "ui.closeTab": async (params) => {
        const space = spaceOf(params);
        return spaces.closeTab(space.id, Number(params.tabId), { force: true });
      },

      "ui.closeSpace": async (params) => spaces.close(requireSpaceId(params.spaceId)),

      "ui.focusSpace": async (params) => {
        const space = spaceOf(params);
        // The sidebar's entire purpose: show this space in the one window. The OS
        // window is raised too, because the click came from the human.
        const descriptor = spaces.setFocusedSpace(space.id);
        space.window?.focus();
        return descriptor;
      },

      "ui.handOff": async (params) => spaces.handOff(requireSpaceId(params.spaceId)),

      "ui.takeOver": async (params) => spaces.takeOver(requireSpaceId(params.spaceId)),

      "ui.goBack": async (params) => {
        const space = spaceOf(params);
        const tab = spaces.activeTab(space.id);
        const history = tab.view.webContents.navigationHistory;
        if (history?.canGoBack?.()) history.goBack();
        return { ok: Boolean(history?.canGoBack?.()) };
      },

      "ui.goForward": async (params) => {
        const space = spaceOf(params);
        const tab = spaces.activeTab(space.id);
        const history = tab.view.webContents.navigationHistory;
        if (history?.canGoForward?.()) history.goForward();
        return { ok: Boolean(history?.canGoForward?.()) };
      },

      /**
       * Screenshot of the browser's own chrome (not the page).
       *
       * Note: `webContents.capturePage()` does NOT composite child
       * WebContentsViews, so this shows the chrome and leaves the page area
       * blank. Use `ui.captureWindow` when you need real pixels of both.
       */
      "ui.captureChrome": async (params) => {
        const space = spaceOf(params);
        if (!space.window || space.window.isDestroyed()) {
          throw new AragonError(
            ERROR_CODES.OPERATION_FAILED,
            `space ${space.id} has no window to capture`,
          );
        }
        // The chrome always shows the focused space, so a capture of a background
        // space has to bring it forward first - otherwise the picture proves
        // nothing about the space that was asked for.
        spaces.setFocusedSpace(space.id);
        const image = await space.window.webContents.capturePage();
        return { base64: image.toPNG().toString("base64"), size: image.getSize() };
      },

      /**
       * OS-level capture of the whole window, page view included. This is the
       * only method that proves the composited result a human actually sees.
       */
      "ui.captureWindow": async (params) => {
        const space = spaceOf(params);
        if (!space.window || space.window.isDestroyed()) {
          throw new AragonError(
            ERROR_CODES.OPERATION_FAILED,
            `space ${space.id} has no window to capture`,
          );
        }
        // A minimized window has no thumbnail, and `show()` does not un-minimize on
        // Windows - so capture would fail for a perfectly capturable window.
        if (space.window.isMinimized()) space.window.restore();
        // Only the focused space is composited into the window, so the space has to
        // be the one on screen or the capture shows a sibling's page.
        spaces.setFocusedSpace(space.id);
        space.window.show();
        space.window.focus();
        await delay(350);
        const [width, height] = space.window.getSize();
        const sources = await desktopCapturer.getSources({
          types: ["window"],
          thumbnailSize: { width: width * 2, height: height * 2 },
        });
        const title = space.window.getTitle();
        // Exact title only. A prefix or loose /aragon/ match is NOT a fallback: the
        // installed build, an older dev instance, or a sibling space whose name
        // merely starts with this one ("home" vs "home2") matches it too, and the
        // capture then silently returns a picture of the WRONG window - a green
        // assertion that proves nothing. The title carries the space id
        // (`aragon-browser - <name> (#<id>)`) so it is unique by construction.
        const candidates = sources.filter((source) => source.name === title);
        if (candidates.length !== 1) {
          throw new AragonError(
            ERROR_CODES.OPERATION_FAILED,
            `no unique desktop capture source for window "${title}" (matched ${candidates.length}; ` +
              `sources: ${sources.map((source) => source.name || "<untitled>").join(" | ")})`,
          );
        }
        if (candidates[0].thumbnail.isEmpty()) {
          throw new AragonError(
            ERROR_CODES.OPERATION_FAILED,
            `window "${title}" produced an empty thumbnail (minimized, or the session is locked)`,
          );
        }
        const match = candidates[0];
        return {
          base64: match.thumbnail.toPNG().toString("base64"),
          size: match.thumbnail.getSize(),
          sourceName: match.name,
        };
      },

      "ui.layout": async (params) => {
        const space = spaceOf(params);
        if (!space.window || space.window.isDestroyed()) {
          throw new AragonError(ERROR_CODES.OPERATION_FAILED, "space has no window");
        }
        // Geometry and visibility are only meaningful for the space on screen.
        spaces.setFocusedSpace(space.id);
        const [width, height] = space.window.getContentSize();
        const [outerWidth, outerHeight] = space.window.getSize();
        const tab = space.tabs.find((entry) => entry.id === space.activeTabId);
        return {
          contentSize: { width, height },
          // A native caption and its borders live OUTSIDE the client area, so a
          // framed window always reports a getSize() tens of pixels bigger. Being
          // equal proves the self-drawn title bar replaced the native one. The one
          // exception is a *maximized* window, which hangs off the work area by
          // the resize border (8px per side on Windows) - hence "close", not "===".
          windowSize: { width: outerWidth, height: outerHeight },
          // Reported so a caller can tell which case it is looking at instead of
          // guessing from the numbers.
          maximized: space.window.isMaximized(),
          titleBarHeight: LAYOUT.titleBarHeight,
          chromeHeight: LAYOUT.chromeHeight,
          statusHeight: LAYOUT.statusHeight,
          viewBounds: tab ? tab.view.getBounds() : null,
          visible: tab ? tab.view.getVisible?.() ?? null : null,
          viewCount: space.tabs.length,
        };
      },
    };
  }

  /** A Page-shaped facade for site tools, backed by kernel methods. */
  #pageFacade(space, tab) {
    const call = async (kind, payload) => {
      const method = this.methods[kind];
      return method({ spaceId: space.id, ...payload });
    };
    return {
      spaceId: space.id,
      tabId: tab.id,
      label: tab.label,
      async goto(url) {
        return call("act.navigate", { url });
      },
      async snapshot(options = {}) {
        return this.captureSnapshot(space, options);
      },
      async click(target, options = {}) {
        return call("act.click", { target, ...options });
      },
      async fill(target, text, options = {}) {
        return call("act.fill", { target, text, ...options });
      },
      async type(text, options = {}) {
        return call("act.type", { text, ...options });
      },
      async press(key) {
        return call("act.press", { key });
      },
      async hover(target) {
        return call("act.hover", { target });
      },
      async upload(target, files) {
        return call("act.upload", { target, files });
      },
      async drag(from, to, options = {}) {
        return call("act.drag", { from, to, ...options });
      },
      async evaluate(expression) {
        const result = await call("page.evaluate", { expression });
        return result?.value ?? null;
      },
      async waitFor(target, options = {}) {
        return call("wait.target", { target, ...options });
      },
      async clipboard(text) {
        return call("clipboard.write", { text });
      },
      async screenshot(options = {}) {
        return call("shot.capture", options);
      },
      async cdp(message) {
        return call("cdp.send", { message });
      },
      async info() {
        return call("page.info", {});
      },
    };
  }

  #spaceFacade(space) {
    const call = async (kind, payload = {}) => {
      const method = this.methods[kind];
      return method({ spaceId: space.id, ...payload });
    };
    return {
      id: space.id,
      name: space.name,
      owner: space.owner,
      async newPage(url = "about:blank") {
        return call("tabs.create", { url });
      },
      async tabs() {
        return (await call("tabs.list")).tabs;
      },
      async handOff() {
        return call("spaces.handOff");
      },
      async finish(options = {}) {
        return call("spaces.finish", options);
      },
    };
  }

  #helperFacade(space) {
    // Site tools get the same verbs the agent has, minus the ability to change
    // owner/ownership, which belongs to the human.
    return {
      spaceId: space.id,
      listTabs: async () => (await this.methods["tabs.list"]({ spaceId: space.id })).tabs,
      snapshot: async (options = {}) => this.captureSnapshot(space, options),
      learn: async () => this.methods["learn.context"]({ spaceId: space.id }),
    };
  }

  /**
   * Snapshot orchestration: pull one AX tree per live CDP session (root document
   * plus every attached iframe), link child frames to their <iframe> element by
   * backend id, and let the pure builder flatten + stamp refs.
   */
  async captureSnapshot(space, options = {}) {
    const tab = this.spaces.activeTab(space.id);
    const channel = tab.channel;
    await channel.attach();
    await channel.ensureAccessibility(ROOT_SESSION);
    const settle = await channel.settleChildSessions();

    const frames = [];
    const failures = [];
    for (const entry of channel.sessionEntries()) {
      if (entry.type !== "page" && entry.type !== "iframe") continue;
      try {
        await channel.ensureAccessibility(entry.sessionId);
        const ax = await channel.send(
          "Accessibility.getFullAXTree",
          {},
          entry.sessionId,
        );
        const ownerBackendNodeId =
          entry.sessionId === ROOT_SESSION
            ? null
            : await channel.frameOwnerBackendId(entry.sessionId);
        frames.push({
          sessionId: entry.sessionId,
          frameId: entry.frameId,
          parentSessionId: entry.parent,
          ownerBackendNodeId,
          loaderId: entry.loaderId,
          url: entry.sessionId === ROOT_SESSION ? tab.view.webContents.getURL() : undefined,
          axNodes: Array.isArray(ax?.nodes) ? ax.nodes : [],
        });
      } catch (error) {
        failures.push({ sessionId: entry.sessionId, message: error?.message ?? String(error) });
      }
    }

    if (frames.length === 0) {
      throw new AragonError(
        ERROR_CODES.SNAPSHOT_FAILED,
        `no accessible document in space ${space.id}; is a tab open at a real page?`,
      );
    }

    const built = buildSnapshot(
      { frames },
      {
        maxDepth: options.maxDepth,
        interactiveOnly: options.interactiveOnly === true,
        assignRef: (node) => space.refs.assign(node),
      },
    );

    let text = built.text;
    if (text.length > MAX_SNAPSHOT_CHARS) {
      text = `${text.slice(0, MAX_SNAPSHOT_CHARS)}\n… snapshot truncated at ${MAX_SNAPSHOT_CHARS} characters; pass interactiveOnly:true or a smaller maxDepth`;
    }

    const header = `# space ${space.id} "${space.name}" owner=${space.owner} url=${tab.view.webContents.getURL()}`;
    const result = {
      spaceId: space.id,
      url: tab.view.webContents.getURL(),
      title: tab.title,
      frameCount: built.frameCount,
      refCount: built.nodes.length,
      text: `${header}\n${text}`,
      refs: built.nodes.map((node) => ({
        ref: node.ref,
        role: node.role,
        name: node.name,
        sessionId: node.sessionId,
      })),
      failures,
      unresolvedFrames: built.unresolvedFrames ?? [],
      sessionSettle: settle,
    };
    if (options.debug === true) {
      result.debugFrames = frames.map((frame) => ({
        sessionId: frame.sessionId,
        parentSessionId: frame.parentSessionId,
        frameId: frame.frameId,
        ownerBackendNodeId: frame.ownerBackendNodeId,
        loaderId: frame.loaderId,
        nodes: frame.axNodes.length,
        roots: frame.axNodes.filter((node) => !node.parentId).length,
      }));
    }
    return result;
  }

  async shutdown() {
    await this.spaces.disposeAll();
  }
}
