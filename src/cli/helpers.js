import fs from "node:fs";
import path from "node:path";
import { AragonError, ERROR_CODES } from "../shared/protocol.js";
import {
  PUBLIC_API_SCHEMA,
  renderHelp,
  validateOptions,
} from "../shared/public-api-schema.js";

const SCHEMA_BY_NAME = new Map(PUBLIC_API_SCHEMA.map((entry) => [entry.name, entry]));

function checkOptions(apiName, options) {
  const schema = SCHEMA_BY_NAME.get(apiName);
  if (schema) validateOptions(apiName, schema, options);
}

/**
 * Helper surface injected into agent scripts.
 *
 * Names follow the ego lite contract (taskSpace / Page / snapshot /
 * sendCDPMessage / handOff) because that vocabulary is what agents have already
 * been taught. Everything here is a thin client over the runtime socket: there
 * is no hidden native layer.
 */
export function createHelpers(client, { log = console.log } = {}) {
  let selectedSpaceId = null;

  // Methods that are *supposed* to block for longer than the client's default
  // patience, mapped to the timeout the kernel itself defaults to. Without this,
  // `space.waitForControl()` (600s in the kernel) was killed client-side after
  // 30s with "timed out" while the kernel kept polling.
  const KERNEL_TIMEOUT_MS = new Map([
    ["spaces.waitForControl", 600_000],
    ["wait.target", 10_000],
    ["wait.text", 10_000],
    ["wait.expression", 10_000],
    ["wait.load", 10_000],
    ["wait.navigation", 30_000],
    ["wait.networkIdle", 10_000],
    ["wait.dialog", 10_000],
  ]);
  const DEFAULT_TIMEOUT_MS = 30_000;
  const TIMEOUT_SLACK_MS = 10_000;

  function timeoutFor(method, params) {
    const kernelDefault = KERNEL_TIMEOUT_MS.get(method);
    if (kernelDefault === undefined) return undefined;
    const requested = Number.isInteger(params.timeout)
      ? params.timeout
      : Number.isInteger(params.timeoutMs)
        ? params.timeoutMs
        : kernelDefault;
    return Math.max(DEFAULT_TIMEOUT_MS, requested) + TIMEOUT_SLACK_MS;
  }

  const call = (method, params = {}) =>
    client.request(method, params, { timeoutMs: timeoutFor(method, params) });

  const withSpace = (params = {}) => {
    if (selectedSpaceId === null) {
      throw new AragonError(
        ERROR_CODES.TASK_SPACE_NOT_SELECTED,
        "no task space selected; call taskSpace(name) (creates one if needed) or useTaskSpace(id)",
      );
    }
    return { ...params, spaceId: selectedSpaceId };
  };

  async function resolveSpace(nameOrId) {
    if (nameOrId === undefined || nameOrId === null) {
      const { spaces } = await call("spaces.list");
      if (spaces.length === 0) {
        const created = await call("spaces.create", {});
        selectedSpaceId = created.id;
        return created;
      }
      const agentSpace = spaces.find((space) => space.owner === "agent") ?? spaces[0];
      selectedSpaceId = agentSpace.id;
      return agentSpace;
    }
    if (Number.isInteger(nameOrId) || /^\d+$/.test(String(nameOrId))) {
      const id = Number(nameOrId);
      const space = await call("spaces.claim", { spaceId: id });
      selectedSpaceId = id;
      return space;
    }
    const name = String(nameOrId);
    const { spaces } = await call("spaces.list");
    const match = spaces.find((space) => space.name === name);
    if (match) {
      selectedSpaceId = match.id;
      return match;
    }
    const created = await call("spaces.create", { name });
    selectedSpaceId = created.id;
    return created;
  }

  class Page {
    constructor(spaceId, tabId = null, label = null) {
      this.spaceId = spaceId;
      this.tabId = tabId;
      this.label = label;
    }

    async #ensureTab() {
      const { tabs } = await call("tabs.list", { spaceId: this.spaceId });
      if (tabs.length === 0) {
        const created = await call("tabs.create", { spaceId: this.spaceId, url: "about:blank" });
        this.tabId = created.id;
        this.label = created.label ?? this.label;
        return;
      }
      const target = this.tabId
        ? tabs.find((tab) => tab.id === this.tabId)
        : tabs.at(-1);
      if (target && !target.active) {
        await call("tabs.activate", { spaceId: this.spaceId, tabId: target.id });
      }
      if (target) {
        this.tabId = target.id;
        this.label = target.label ?? this.label;
      }
    }

    /**
     * Every method below goes through here.
     *
     * The kernel resolves `act.*`, `wait.*`, `snapshot.capture` and the dialog/
     * event methods against the space's ACTIVE tab, so calling them directly meant
     * `p1.click()` landed in whichever tab was opened or activated last.
     * Activating this handle's own tab first is what makes `newPage(a)`,
     * `newPage(b)`, `p1.click()` click in `a`.
     */
    async #call(method, params = {}) {
      await this.#ensureTab();
      return call(method, { ...params, spaceId: this.spaceId });
    }

    async goto(url) {
      const result = await this.#call("act.navigate", { url });
      const { tabs } = await call("tabs.list", { spaceId: this.spaceId });
      const active = tabs.find((tab) => tab.active);
      if (active) {
        this.tabId = active.id;
        this.label = active.label ?? this.label;
      }
      return result;
    }

    async info() {
      return this.#call("page.info");
    }

    async frames() {
      return this.#call("page.frames");
    }

    async snapshot(options = {}) {
      checkOptions("Page.snapshot", options);
      return this.#call("snapshot.capture", options);
    }

    async click(target, options = {}) {
      checkOptions("Page.click", options);
      return this.#call("act.click", { target, ...options });
    }

    async doubleClick(target) {
      return this.#call("act.doubleClick", { target });
    }

    async rightClick(target) {
      return this.#call("act.rightClick", { target });
    }

    async fill(target, text, options = {}) {
      checkOptions("Page.fill", options);
      return this.#call("act.fill", { target, text, ...options });
    }

    async type(text, options = {}) {
      checkOptions("Page.type", options);
      return this.#call("act.type", { text, ...options });
    }

    async press(key) {
      return this.#call("act.press", { key });
    }

    async hover(target) {
      return this.#call("act.hover", { target });
    }

    async scroll(options = {}) {
      checkOptions("Page.scroll", options);
      return this.#call("act.scroll", options);
    }

    async drag(from, to, options = {}) {
      checkOptions("Page.drag", options);
      return this.#call("act.drag", { from, to, ...options });
    }

    async upload(target, files) {
      return this.#call("act.upload", { target, files });
    }

    async clipboard(text) {
      return this.#call("clipboard.write", { text });
    }

    async readClipboard() {
      return this.#call("clipboard.read");
    }

    async goBack() {
      return this.#call("act.goBack");
    }

    async goForward() {
      return this.#call("act.goForward");
    }

    async reload() {
      return this.#call("act.reload");
    }

    async waitFor(target, options = {}) {
      checkOptions("Page.waitFor", options);
      return this.#call("wait.target", { target, ...options });
    }

    async waitForText(text, options = {}) {
      checkOptions("Page.waitForText", options);
      return this.#call("wait.text", { text, ...options });
    }

    async waitForExpression(expression, options = {}) {
      checkOptions("Page.waitForExpression", options);
      return this.#call("wait.expression", { expression, ...options });
    }

    async waitForLoad(options = {}) {
      checkOptions("Page.waitForLoad", options);
      return this.#call("wait.load", options);
    }

    /**
     * Wait for a real navigation. Use this after a click that navigates:
     * waitForLoad would return immediately because the old document is complete.
     */
    async waitForNavigation(options = {}) {
      checkOptions("Page.waitForNavigation", options);
      return this.#call("wait.navigation", options);
    }

    async waitForNetworkIdle(options = {}) {
      checkOptions("Page.waitForNetworkIdle", options);
      return this.#call("wait.networkIdle", options);
    }

    async waitForDialog(options = {}) {
      checkOptions("Page.waitForDialog", options);
      return this.#call("wait.dialog", options);
    }

    async answerDialog(options = {}) {
      checkOptions("Page.answerDialog", options);
      return this.#call("dialog.answer", options);
    }

    async setDialogPolicy(policy) {
      return this.#call("dialog.policy", { policy });
    }

    async dialogs() {
      return this.#call("dialog.list");
    }

    async events(options = {}) {
      checkOptions("Page.events", options);
      return this.#call("events.history", options);
    }

    async evaluate(expression, options = {}) {
      checkOptions("Page.evaluate", options);
      const result = await this.#call("page.evaluate", { expression, ...options });
      return result?.value ?? null;
    }

    async screenshot(options = {}) {
      checkOptions("Page.screenshot", options);
      const shot = await this.#call("shot.capture", {
        format: options.format,
        clip: options.clip,
        fullPage: options.fullPage,
      });
      if (!options.save) {
        return { ...shot, bytes: Buffer.from(shot.base64, "base64").length };
      }
      const target = path.resolve(options.save);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(shot.base64, "base64"));
      return { path: target, format: shot.format, bytes: fs.statSync(target).size };
    }

    async cdp(message) {
      return this.#call("cdp.send", { message });
    }

    /** Learned site knowledge that applies to this page. */
    async learn(options = {}) {
      return this.#call("learn.context", options);
    }

    async captureChrome() {
      return this.#call("ui.captureChrome");
    }

    async captureWindow() {
      return this.#call("ui.captureWindow");
    }
  }

  class TaskSpace {
    constructor(descriptor) {
      this.id = descriptor.id;
      this.spaceId = descriptor.id;
      this.name = descriptor.name;
      this.owner = descriptor.owner;
      this.ownership = descriptor.owner;
      this.agentState = descriptor.agentState;
      this.profileId = descriptor.profileId;
      this.partition = descriptor.partition;
      this._tabs = descriptor.tabs ?? [];
    }

    async refresh() {
      const { spaces } = await call("spaces.list");
      const found = spaces.find((space) => space.id === this.id);
      if (found) {
        Object.assign(this, found);
        this.ownership = found.owner;
        this._tabs = found.tabs ?? [];
      }
      return this;
    }

    async captureChrome() {
      return call("ui.captureChrome", { spaceId: this.id });
    }

    async captureWindow() {
      return call("ui.captureWindow", { spaceId: this.id });
    }

    async layout() {
      return call("ui.layout", { spaceId: this.id });
    }

    async pages() {
      const { tabs } = await call("tabs.list", { spaceId: this.id });
      return tabs.map((tab) => new Page(this.id, tab.id, tab.label));
    }

    async tabs() {
      const { tabs } = await call("tabs.list", { spaceId: this.id });
      return tabs;
    }

    /** A Page handle for a durable label, without checking it exists. */
    page(label) {
      const found = this._tabs.find((tab) => tab.label === label);
      return new Page(this.id, found?.id ?? null, label);
    }

    async newPage(url = "about:blank") {
      const tab = await call("tabs.create", { spaceId: this.id, url });
      this._tabs.push(tab);
      return new Page(this.id, tab.id, tab.label);
    }

    async page_() {
      const pages = await this.pages();
      if (pages.length > 0) return pages.at(-1);
      return this.newPage("about:blank");
    }

    async snapshot(options = {}) {
      checkOptions("Page.snapshot", options);
      return call("snapshot.capture", { spaceId: this.id, ...options });
    }

    async setAgentState(state) {
      const descriptor = await call("spaces.setAgentState", { spaceId: this.id, state });
      Object.assign(this, descriptor);
      return this;
    }

    async handOff() {
      const descriptor = await call("spaces.handOff", { spaceId: this.id });
      Object.assign(this, { owner: descriptor.owner, ownership: descriptor.owner });
      return descriptor;
    }

    async complete() {
      return call("spaces.complete", { spaceId: this.id });
    }

    async finish(options = {}) {
      checkOptions("TaskSpace.finish", options);
      if (options.keep === undefined) {
        throw new TypeError(
          'finish() requires keep: "all" or an array of Page labels - closing tabs is destructive',
        );
      }
      return call("spaces.finish", { spaceId: this.id, keep: options.keep });
    }

    async waitForControl(options = {}) {
      checkOptions("TaskSpace.waitForControl", options);
      return call("spaces.waitForControl", { spaceId: this.id, ...options });
    }

    async learn(options = {}) {
      return call("learn.context", { spaceId: this.id, ...options });
    }

    async close() {
      return call("spaces.close", { spaceId: this.id });
    }
  }

  const helpers = {
    async browserVersion() {
      return call("runtime.version");
    },

    async listProfiles() {
      return call("profiles.list");
    },

    async listTaskSpaces() {
      const { spaces } = await call("spaces.list");
      return spaces;
    },

    async listLearnedSites() {
      return call("learn.list");
    },

    async createTaskSpace(name, profileId) {
      return new TaskSpace(await call("spaces.create", { name, profileId }));
    },

    async claimTaskSpace(id, name) {
      return new TaskSpace(await call("spaces.claim", { spaceId: id, name }));
    },

    async taskSpace(nameOrId) {
      const descriptor = await resolveSpace(nameOrId);
      return new TaskSpace(descriptor);
    },

    useTaskSpace(id) {
      selectedSpaceId = Number(id);
      return selectedSpaceId;
    },

    async currentTaskSpace() {
      if (selectedSpaceId === null) {
        throw new AragonError(
          ERROR_CODES.TASK_SPACE_NOT_SELECTED,
          "no task space selected yet",
        );
      }
      return new TaskSpace(await call("spaces.claim", { spaceId: selectedSpaceId }));
    },

    async takeOverTaskSpace(id = selectedSpaceId) {
      const spaceId = id === null || id === undefined ? selectedSpaceId : Number(id);
      if (!spaceId) {
        throw new AragonError(
          ERROR_CODES.TASK_SPACE_NOT_SELECTED,
          "takeOverTaskSpace() needs an id when no space is selected",
        );
      }
      return call("spaces.takeOver", { spaceId });
    },

    async closeTaskSpace(id = selectedSpaceId) {
      return call("spaces.close", { spaceId: id ?? selectedSpaceId });
    },

    async createTab(url = "about:blank") {
      const space = await helpers.currentTaskSpace();
      return space.newPage(url);
    },

    async listTabs() {
      const space = await helpers.currentTaskSpace();
      return space.tabs();
    },

    async snapshot(options = {}) {
      checkOptions("Page.snapshot", options);
      const space = await helpers.currentTaskSpace();
      return space.snapshot(options);
    },

    async sendCDPMessage(message) {
      return call("cdp.send", {
        spaceId: selectedSpaceId,
        message,
      });
    },

    async learnContext(options = {}) {
      return call("learn.context", withSpace(options));
    },

    async runSiteTool(siteId, toolName, args = {}) {
      return call("learn.runTool", withSpace({ siteId, toolName, args }));
    },

    async runSiteBrowserTool(siteId, toolName, args = {}) {
      return call("learn.runBrowserTool", withSpace({ siteId, toolName, args }));
    },

    async validateSiteSkills() {
      return call("learn.validate");
    },

    cliLog(...args) {
      log(args.map((arg) => (typeof arg === "string" ? arg : safeJson(arg))).join(" "));
    },

    help() {
      log(renderHelp());
    },
  };

  Object.defineProperty(helpers, "__selectedSpaceId", {
    get: () => selectedSpaceId,
  });

  return helpers;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Kept for callers that only want the short summary. */
export function skillSummary() {
  return renderHelp();
}
