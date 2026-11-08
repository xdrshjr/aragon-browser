import { setTimeout as delay } from "node:timers/promises";
import { AragonError, ERROR_CODES } from "../shared/protocol.js";

export const ROOT_SESSION = "root";

/**
 * One CDP channel per tab.
 *
 * Electron gives a tab a single debugger socket; a modern page can spread its
 * content across out-of-process iframes, each of which is a *separate* CDP
 * session. Everything interesting in aragon-browser (snapshot, refs, clicks)
 * has to work across those sessions, so this class owns the session topology:
 *
 *   - `Target.setAutoAttach({flatten:true})` so child frames become sessions we
 *     can inspect. `waitForDebuggerOnStart` is deliberately FALSE: pausing a
 *     new iframe blocks the parent's load event, so a page with an iframe would
 *     never reach readyState "complete" and every navigation wait would hang.
 *     Frames created before we attached are picked up by
 *     `attachExistingFrames()` instead.
 *   - a session -> {frameId, parent, loaderId} table, because refs are only
 *     valid inside one document (`loaderId`);
 *   - parent-session routing for `DOM.getFrameOwner`, which is what lets the
 *     snapshot splice a cross-process iframe at its real <iframe> element.
 */
export class CdpChannel {
  constructor(webContents, label = "tab") {
    this.webContents = webContents;
    this.label = label;
    this.sessions = new Map(); // sessionKey -> {frameId, parent, loaderId, type}
    this.sessions.set(ROOT_SESSION, {
      frameId: null,
      parent: null,
      loaderId: null,
      type: "page",
    });
    this.attached = false;
    this.listeners = new Set();
    this.domEnabled = new Set();
    this.accessibilityEnabled = new Set();
    this.mainFrameId = null;
    // Event-driven main-frame state. Wait primitives read these fields instead
    // of round-tripping to the renderer: a round trip is long enough for the
    // navigation you are trying to observe to commit first, which makes
    // "wait for the next navigation" miss it entirely.
    this.mainLoaderId = null;
    this.mainUrl = null;
    this.navigationSeq = 0;
    // Bounded event history: an unbounded queue is a memory leak in a browser
    // that is meant to run for hours.
    this.maxEvents = 10_000;
    this.events = [];
    this.eventSequence = 0;
    // JS dialogs block the renderer until someone answers them, so they are
    // tracked here rather than left to time out. Bounded for the same reason the
    // event ring is: a page that opens a dialog in a loop must not grow this.
    this.dialogs = [];
    this.maxDialogs = 100;
    this.dialogPolicy = "dismiss";
    // In-flight network requests, keyed by session + requestId. A Set, not a
    // counter: a redirect emits a second `requestWillBeSent` for the same
    // requestId but only one `loadingFinished`, so a counter never returns to 0
    // and `waitForNetworkIdle` would fail forever after any http->https hop.
    this.inflight = new Set();
  }

  get debugger() {
    return this.webContents.debugger;
  }

  isAttached() {
    return this.attached && !this.webContents.isDestroyed();
  }

  async attach() {
    if (this.isAttached()) return this;
    try {
      this.debugger.attach("1.3");
    } catch (error) {
      if (!/already attached/i.test(String(error?.message))) {
        throw new AragonError(
          ERROR_CODES.CDP_CHANNEL_UNAVAILABLE,
          `could not attach the DevTools channel: ${error?.message ?? error}`,
          error,
        );
      }
    }
    this.attached = true;
    this.debugger.on("message", (event, method, params, sessionId) => {
      // Electron hands back an EMPTY STRING for the root session, never
      // undefined: `??` would keep "" and every parent lookup would miss.
      const key = sessionId ? sessionId : ROOT_SESSION;
      this.#recordEvent(key, method, params);
      this.#onEvent(method, params, key);
    });
    this.debugger.on("detach", (_event, reason) => {
      this.attached = false;
      this.sessions.clear();
      this.sessions.set(ROOT_SESSION, {
        frameId: null,
        parent: null,
        loaderId: null,
        type: "page",
      });
      for (const listener of this.listeners) listener({ type: "detach", reason });
    });
    await this.send("Page.enable");
    await this.send("Target.setAutoAttach", {
      autoAttach: true,
      // FALSE on purpose: pausing a child frame blocks the parent load event, so
      // a page containing an iframe would never reach readyState "complete".
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    const tree = await this.send("Page.getFrameTree");
    this.mainFrameId = tree?.frameTree?.frame?.id ?? null;
    this.mainLoaderId = tree?.frameTree?.frame?.loaderId ?? null;
    this.mainUrl = tree?.frameTree?.frame?.url ?? null;
    const root = this.sessions.get(ROOT_SESSION);
    root.frameId = this.mainFrameId;
    root.loaderId = this.mainLoaderId;
    return this;
  }

  async detach() {
    this.attached = false;
    this.sessions.clear();
    try {
      if (!this.webContents.isDestroyed()) this.debugger.detach();
    } catch {
      // Detaching an already-detached debugger is not an error we care about.
    }
  }

  async send(method, params = {}, sessionId = ROOT_SESSION) {
    if (!this.isAttached()) {
      throw new AragonError(
        ERROR_CODES.CDP_CHANNEL_UNAVAILABLE,
        "no DevTools channel for this tab",
      );
    }
    const target = sessionId === ROOT_SESSION ? undefined : sessionId;
    try {
      return await this.debugger.sendCommand(method, params, target);
    } catch (error) {
      const message = String(error?.message ?? error);
      // "Session with given id not found" means the frame went away mid-call.
      if (/session with given id not found|cannot find context/i.test(message)) {
        this.sessions.delete(sessionId);
        throw new AragonError(
          ERROR_CODES.REF_STALE,
          "the frame this ref lived in is gone; take a fresh snapshot",
          error,
        );
      }
      throw new AragonError(
        ERROR_CODES.CDP_SEND_FAILED,
        `${method} failed: ${message}`,
        error,
      );
    }
  }

  async sendOptional(method, params = {}, sessionId = ROOT_SESSION) {
    try {
      return await this.send(method, params, sessionId);
    } catch {
      return null;
    }
  }

  #recordEvent(sessionId, method, params) {
    this.eventSequence += 1;
    const entry = { seq: this.eventSequence, sessionId, method, params, at: Date.now() };
    this.events.push(entry);
    if (this.events.length > this.maxEvents) {
      // Drop in chunks: shifting one at a time on every event is O(n) per push.
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    if (method === "Network.requestWillBeSent") {
      const requestId = params?.requestId;
      // A redirect hop reuses the requestId and never gets its own
      // loadingFinished, so it must not add a second in-flight entry.
      if (requestId && !params?.redirectResponse) {
        this.inflight.add(`${sessionId}:${requestId}`);
      }
    } else if (
      method === "Network.loadingFinished" ||
      method === "Network.loadingFailed"
    ) {
      const requestId = params?.requestId;
      if (requestId) this.inflight.delete(`${sessionId}:${requestId}`);
    }
    return entry;
  }

  #onEvent(method, params, sessionId) {
    if (method === "Target.attachedToTarget") {
      const child = params?.sessionId;
      const info = params?.targetInfo ?? {};
      if (child && info.type === "iframe") {
        this.sessions.set(child, {
          // targetId is the frame id the PARENT knows this frame by; the child
          // session reports its own root frame id separately (localFrameId) and
          // the two are not interchangeable for DOM.getFrameOwner.
          frameId: info.targetId ?? null,
          localFrameId: null,
          parent: sessionId,
          loaderId: null,
          type: info.type,
        });
      }
      if (child) {
        void this.#adoptSession(child);
      }
      return;
    }
    if (method === "Target.detachedFromTarget") {
      const child = params?.sessionId;
      if (child) {
        this.sessions.delete(child);
        this.domEnabled.delete(child);
        this.accessibilityEnabled.delete(child);
      }
      return;
    }
    if (method === "Page.frameNavigated") {
      const frame = params?.frame;
      const entry = this.sessions.get(sessionId);
      if (entry && frame) {
        if (sessionId === ROOT_SESSION) {
          entry.frameId = frame.id;
           this.mainFrameId = frame.id;
          // A commit happened: bump the counter so a waiter can tell "this is a
          // new document" without asking the renderer anything.
          this.mainLoaderId = frame.loaderId ?? this.mainLoaderId;
          this.mainUrl = frame.url ?? this.mainUrl;
          this.navigationSeq += 1;
        } else if (frame.id === entry.frameId || frame.id === entry.localFrameId) {
          entry.localFrameId = frame.id;
        }
        entry.loaderId = frame.loaderId ?? entry.loaderId;
      }
      for (const listener of this.listeners) {
        listener({ type: "frameNavigated", sessionId, frame });
      }
      return;
    }
    if (method === "Page.javascriptDialogOpening") {
      // The renderer is blocked from here on: either answer it now or the page
      // hangs. Recording it first means the agent can still see what was asked.
      const dialog = {
        sessionId,
        type: params?.type ?? "alert",
        message: params?.message ?? "",
        defaultPrompt: params?.defaultPrompt,
        url: params?.url,
        at: Date.now(),
        handled: null,
      };
      this.dialogs.push(dialog);
      if (this.dialogs.length > this.maxDialogs) {
        this.dialogs.splice(0, this.dialogs.length - this.maxDialogs);
      }
      void this.#handleDialog(dialog, sessionId);
    }
    if (method === "Page.javascriptDialogClosed") {
      // The page (or a navigation) closed it without us: retire the newest entry
      // still marked open, so it is not reported as awaiting an answer forever and
      // a later `answerDialog` does not error on a dialog that is already gone.
      const open = [...this.dialogs].reverse().find((entry) => entry.handled === null);
      if (open) open.handled = "closed";
    }
    for (const listener of this.listeners) {
      listener({ type: "event", sessionId, method, params });
    }
  }

  async #handleDialog(dialog, sessionId) {
    if (this.dialogPolicy === "manual") return;
    try {
      await this.send(
        "Page.handleJavaScriptDialog",
        {
          accept: this.dialogPolicy === "accept",
          ...(this.dialogAcceptText === undefined
            ? {}
            : { promptText: this.dialogAcceptText }),
        },
        sessionId,
      );
      dialog.handled = this.dialogPolicy;
    } catch {
      dialog.handled = "failed";
    }
  }

  /**
   * Answer the newest open dialog explicitly. Returns false when there is
   * nothing open, so a caller can tell "already gone" from "answered".
   */
  async answerDialog({ accept = true, promptText } = {}) {
    const dialog = [...this.dialogs].reverse().find((entry) => entry.handled === null);
    if (!dialog) return false;
    await this.send(
      "Page.handleJavaScriptDialog",
      { accept, ...(promptText === undefined ? {} : { promptText }) },
      dialog.sessionId,
    );
    dialog.handled = accept ? "accept" : "dismiss";
    return true;
  }

  setDialogPolicy(policy, { acceptText } = {}) {
    if (!["accept", "dismiss", "manual"].includes(policy)) {
      throw new AragonError(
        ERROR_CODES.INVALID_ARGUMENT,
        'dialog policy must be "accept", "dismiss" or "manual"',
      );
    }
    this.dialogPolicy = policy;
    this.dialogAcceptText = acceptText;
    return policy;
  }

  async #adoptSession(childSessionId) {
    // Harmless when the frame was never paused, and still correct if a future
    // autoAttach setting pauses it again.
    await this.sendOptional("Runtime.runIfWaitingForDebugger", {}, childSessionId);
    await this.sendOptional("Page.enable", {}, childSessionId);
    await this.sendOptional(
      "Target.setAutoAttach",
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      childSessionId,
    );
    const tree = await this.sendOptional("Page.getFrameTree", {}, childSessionId);
    const entry = this.sessions.get(childSessionId);
    if (entry && tree?.frameTree?.frame) {
      entry.localFrameId = tree.frameTree.frame.id;
      entry.loaderId = tree.frameTree.frame.loaderId ?? entry.loaderId;
    }
    await this.sendOptional("Accessibility.enable", {}, childSessionId);
    this.accessibilityEnabled.add(childSessionId);
  }

  /**
   * `Target.setAutoAttach` only catches iframes that appear *after* it runs, so a
   * page that was already loaded has its out-of-process frames invisible. Attach
   * to the existing ones explicitly - without this, snapshots of a pre-loaded
   * page silently lose every cross-origin frame.
   */
  async attachExistingFrames() {
    if (!this.isAttached()) return 0;
    const targets = await this.sendOptional("Target.getTargets");
    const infos = Array.isArray(targets?.targetInfos) ? targets.targetInfos : [];
    const known = new Set(
      [...this.sessions.values()].map((entry) => entry.frameId).filter(Boolean),
    );
    let attached = 0;
    for (const info of infos) {
      if (info.type !== "iframe" || known.has(info.targetId)) continue;
      try {
        const result = await this.send("Target.attachToTarget", {
          targetId: info.targetId,
          flatten: true,
        });
        const childSessionId = result?.sessionId;
        if (!childSessionId) continue;
        this.sessions.set(childSessionId, {
          frameId: info.targetId,
          parent: ROOT_SESSION,
          loaderId: null,
          type: "iframe",
        });
        await this.#adoptSession(childSessionId);
        attached += 1;
      } catch {
        // A frame that dies between listing and attaching is not an error.
      }
    }
    return attached;
  }

  /**
   * Wait until every iframe target the browser knows about has a CDP session in
   * this channel.
   *
   * The trap this exists for: `Target.attachedToTarget` is delivered as a
   * queued debugger *event*, while `Target.getTargets` is answered immediately.
   * Snapshotting right after `attach()` therefore sees the frame in
   * `getTargets` but not yet in our session table, and silently produces a tree
   * with the iframe's contents missing.
   */
  async settleChildSessions({ timeoutMs = 1500, intervalMs = 60 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let missing = [];
    for (;;) {
      const targets = await this.sendOptional("Target.getTargets");
      const infos = (Array.isArray(targets?.targetInfos) ? targets.targetInfos : []).filter(
        (info) => info.type === "iframe",
      );
      const known = new Set(
        [...this.sessions.values()]
          .flatMap((entry) => [entry.frameId, entry.localFrameId])
          .filter(Boolean),
      );
      missing = infos.filter((info) => !known.has(info.targetId));
      if (missing.length === 0) return { settled: true, missing: [] };
      await this.attachExistingFrames();
      if (Date.now() >= deadline) {
        return { settled: false, missing: missing.map((info) => info.targetId) };
      }
      await delay(intervalMs);
    }
  }

  /** Recent CDP events, optionally filtered by method prefix or session. */
  history({ method, sessionId, sinceSeq = 0, limit = 200 } = {}) {
    let list = this.events;
    if (sinceSeq > 0) list = list.filter((entry) => entry.seq > sinceSeq);
    if (method) {
      list = list.filter((entry) =>
        method.endsWith("*")
          ? entry.method.startsWith(method.slice(0, -1))
          : entry.method === method,
      );
    }
    if (sessionId) list = list.filter((entry) => entry.sessionId === sessionId);
    return list.slice(-limit);
  }

  /** Wait for a matching event, including ones that already arrived. */
  async waitForEvent(method, { predicate, timeoutMs = 10_000, sinceSeq = 0 } = {}) {
    const matches = (entry) =>
      (method.endsWith("*")
        ? entry.method.startsWith(method.slice(0, -1))
        : entry.method === method) && (!predicate || predicate(entry.params, entry));
    const already = this.events.find((entry) => entry.seq > sinceSeq && matches(entry));
    if (already) return already;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(
          new AragonError(
            ERROR_CODES.OPERATION_FAILED,
            `timed out after ${timeoutMs}ms waiting for CDP event ${method}`,
          ),
        );
      }, timeoutMs);
      const off = this.onEvent((event) => {
        if (event.type !== "event" || !matches(event)) return;
        clearTimeout(timer);
        off();
        resolve({
          seq: this.eventSequence,
          sessionId: event.sessionId,
          method: event.method,
          params: event.params,
        });
      });
    });
  }

  get inflightRequests() {
    return this.inflight.size;
  }

  async enableNetwork() {
    if (this.networkEnabled) return;
    await this.sendOptional("Network.enable", {});
    this.networkEnabled = true;
  }

  async enableDialogs() {
    if (this.dialogsEnabled) return;
    await this.sendOptional("Page.enable");
    this.dialogsEnabled = true;
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** sessionKey -> loaderId for every live session, used for ref invalidation. */
  loaderIds() {
    const map = new Map();
    for (const [key, entry] of this.sessions) map.set(key, entry.loaderId);
    return map;
  }

  sessionEntries() {
    return [...this.sessions.entries()].map(([sessionId, entry]) => ({
      sessionId,
      ...entry,
    }));
  }

  async ensureDom(sessionId = ROOT_SESSION) {
    if (this.domEnabled.has(sessionId)) return;
    await this.send("DOM.enable", {}, sessionId);
    this.domEnabled.add(sessionId);
  }

  async ensureAccessibility(sessionId = ROOT_SESSION) {
    if (this.accessibilityEnabled.has(sessionId)) return;
    await this.send("Accessibility.enable", {}, sessionId);
    this.accessibilityEnabled.add(sessionId);
  }

  /**
   * `DOM.getFrameOwner` must run on the *parent* session, so route it there and
   * return the backend id of the <iframe> element that hosts `frameId`.
   */
  async frameOwnerBackendId(childSessionId) {
    const entry = this.sessions.get(childSessionId);
    if (!entry || !entry.parent) return null;
    await this.ensureDom(entry.parent);
    const candidates = [entry.frameId, entry.localFrameId].filter(Boolean);
    for (const frameId of candidates) {
      const owner = await this.sendOptional(
        "DOM.getFrameOwner",
        { frameId },
        entry.parent,
      );
      if (owner?.backendNodeId !== undefined && owner?.backendNodeId !== null) {
        return owner.backendNodeId;
      }
    }
    return null;
  }

  async url() {
    try {
      return this.webContents.getURL();
    } catch {
      return "";
    }
  }
}
