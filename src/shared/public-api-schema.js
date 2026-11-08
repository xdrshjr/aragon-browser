/**
 * The public API description. This file is the single source of truth for
 * `help()`: the runtime and the printed guide are generated from it, so they
 * cannot drift apart the way hand-written docs do.
 *
 * `kind` drives runtime validation of options objects, matching ego-lite's
 * vocabulary so an agent's existing expectations hold:
 *   boolean | string | nonEmptyString | finiteNumber | positiveInteger |
 *   nonNegativeNumber | positiveMilliseconds | object
 */

export const PUBLIC_API_SCHEMA = [
  // --- discovery -----------------------------------------------------------
  {
    name: "browserVersion",
    signature: "await browserVersion()",
    area: "discovery",
    summary: "Browser version, engine, platform and live space count.",
  },
  {
    name: "listProfiles",
    signature: "await listProfiles()",
    area: "discovery",
    summary: 'Available profiles: [{ id, name, kind }]. "ephemeral" never writes to disk.',
  },
  {
    name: "listTaskSpaces",
    signature: "await listTaskSpaces()",
    area: "discovery",
    summary: "Every space with id, name, owner, agentState, profile and tabs.",
  },
  {
    name: "listLearnedSites",
    signature: "await listLearnedSites()",
    area: "discovery",
    summary: "Installed site skills: id, name, domains, tool names.",
  },

  // --- spaces --------------------------------------------------------------
  {
    name: "taskSpace",
    signature: "await taskSpace(nameOrId)",
    area: "spaces",
    summary:
      "Select an existing space by name or id, creating it when the name is new. Reuses an agent-owned space of that name.",
  },
  {
    name: "createTaskSpace",
    signature: "await createTaskSpace(name, profileId?)",
    area: "spaces",
    summary: "Create a space. profileId comes from listProfiles().",
  },
  {
    name: "claimTaskSpace",
    signature: "await claimTaskSpace(id)",
    area: "spaces",
    summary: "Take an agent-owned space by numeric id and make it current.",
  },
  {
    name: "useTaskSpace",
    signature: "useTaskSpace(id)",
    area: "spaces",
    summary: "Select a space for the bare helpers (snapshot, listTabs, sendCDPMessage).",
  },
  {
    name: "takeOverTaskSpace",
    signature: "await takeOverTaskSpace(id?)",
    area: "spaces",
    summary: "Resume driving after the user had control.",
  },
  {
    name: "closeTaskSpace",
    signature: "await closeTaskSpace(id?)",
    area: "spaces",
    summary: "Close a space and its window.",
  },

  // --- TaskSpace methods ---------------------------------------------------
  {
    name: "TaskSpace.pages",
    signature: "await space.pages()",
    area: "space-methods",
    summary: "Page handles for every tab in the space.",
  },
  {
    name: "TaskSpace.tabs",
    signature: "await space.tabs()",
    area: "space-methods",
    summary: "Tab inventory: { id, label, origin, url, title, active }.",
  },
  {
    name: "TaskSpace.newPage",
    signature: "await space.newPage(url?)",
    area: "space-methods",
    summary: "Open a tab (default about:blank) and return its Page.",
  },
  {
    name: "TaskSpace.page",
    signature: "space.page(label)",
    area: "space-methods",
    summary: "A Page handle for a durable label such as p1.",
  },
  {
    name: "TaskSpace.handOff",
    signature: "await space.handOff()",
    area: "space-methods",
    summary:
      "Give control to the user. Every mutating call fails with EGO_TASK_SPACE_USER_IN_CONTROL until takeOver.",
  },
  {
    name: "TaskSpace.finish",
    signature: "await space.finish({ keep })",
    area: "space-methods",
    summary:
      'keep is required: "all" or an array of Page labels. Closes agent tabs, never a tab the user opened.',
    options: { keep: "keep" },
  },
  {
    name: "TaskSpace.waitForControl",
    signature: "await space.waitForControl({ interval?, timeout? })",
    area: "space-methods",
    summary: "Poll until the user hands the space back, without taking control.",
    options: {
      interval: "positiveMilliseconds",
      timeout: "positiveMilliseconds",
    },
  },
  {
    name: "TaskSpace.setAgentState",
    signature: "await space.setAgentState(state)",
    area: "space-methods",
    summary: 'idle | running | paused | error, shown in the UI.',
  },
  {
    name: "TaskSpace.learn",
    signature: "await space.learn({ url? })",
    area: "space-methods",
    summary: "Learned notes and tool signatures that apply to this page.",
  },

  // --- Page observation ----------------------------------------------------
  {
    name: "Page.snapshot",
    signature: "await page.snapshot({ interactiveOnly?, maxDepth?, debug? })",
    area: "observe",
    summary:
      "Accessibility snapshot: text plus refs[]. Cross-site iframes are flattened at their <iframe> element.",
    options: {
      interactiveOnly: "boolean",
      maxDepth: "positiveInteger",
      debug: "boolean",
    },
  },
  {
    name: "Page.info",
    signature: "await page.info()",
    area: "observe",
    summary: "url, title, tab count, history availability, loading flag.",
  },
  {
    name: "Page.frames",
    signature: "await page.frames()",
    area: "observe",
    summary: "CDP session topology: sessionId, frameId, parentSessionId per frame.",
  },
  {
    name: "Page.screenshot",
    signature: "await page.screenshot({ format?, clip?, fullPage?, save? })",
    area: "observe",
    summary: "Page pixels. `save` writes a file and returns its path and byte size.",
    options: {
      format: "screenshotFormat",
      // Advertised in the signature above, and forwarded by the CLI, so it has to
      // be declared here or `checkOptions` rejected it before the call went out.
      clip: "object",
      fullPage: "boolean",
      save: "nonEmptyString",
    },
  },
  {
    name: "Page.events",
    signature: "await page.events({ method?, sinceSeq?, limit? })",
    area: "observe",
    summary: "Recent CDP events (bounded 10k ring). method accepts a `*` suffix.",
    options: {
      method: "string",
      sinceSeq: "nonNegativeNumber",
      limit: "positiveInteger",
    },
  },
  {
    name: "Page.dialogs",
    signature: "await page.dialogs()",
    area: "observe",
    summary: "JS dialogs seen so far and the current auto-handling policy.",
  },

  // --- acting --------------------------------------------------------------
  {
    name: "Page.goto",
    signature: "await page.goto(url)",
    area: "act",
    summary: "Navigate the current tab. Invalidates every ref from the old document.",
  },
  {
    name: "Page.click",
    signature: "await page.click(target, { button?, clickCount? })",
    area: "act",
    summary: "Trusted pointer click at the element's measured position.",
    options: { button: "mouseButton", clickCount: "positiveInteger" },
  },
  {
    name: "Page.doubleClick",
    signature: "await page.doubleClick(target)",
    area: "act",
    summary: "Two real clicks with the native double-click interval.",
  },
  {
    name: "Page.rightClick",
    signature: "await page.rightClick(target)",
    area: "act",
    summary: "Right button click (context menu).",
  },
  {
    name: "Page.fill",
    signature: "await page.fill(target, text, { submit?, delayMs? })",
    area: "act",
    summary:
      "Focus, select-all, then insertText so framework-controlled inputs see a real input event.",
    options: { submit: "boolean", delayMs: "nonNegativeNumber" },
  },
  {
    name: "Page.type",
    signature: "await page.type(text, { delayMs? })",
    area: "act",
    summary: "Type into whatever currently has focus.",
    options: { delayMs: "nonNegativeNumber" },
  },
  {
    name: "Page.press",
    signature: "await page.press(key)",
    area: "act",
    summary: "Enter | Tab | Escape | Backspace | Delete | Arrow* | space | a single character.",
  },
  {
    name: "Page.hover",
    signature: "await page.hover(target)",
    area: "act",
    summary: "Move the pointer over an element.",
  },
  {
    name: "Page.scroll",
    signature: "await page.scroll({ dx?, dy?, target? })",
    area: "act",
    summary: "Wheel scroll, optionally aimed at an element.",
    // `target` is in the signature and forwarded by `Page.scroll`; declaring it
    // here is what makes scrolling at an element possible at all.
    options: { dx: "finiteNumber", dy: "finiteNumber", target: "string" },
  },
  {
    name: "Page.drag",
    signature: "await page.drag(from, to, { steps? })",
    area: "act",
    summary: "Pointer drag with intermediate moves, which drag implementations require.",
    options: { steps: "positiveInteger" },
  },
  {
    name: "Page.upload",
    signature: "await page.upload(target, files)",
    area: "act",
    summary: 'Attach files to an <input type="file">. Paths are existence-checked first.',
  },
  {
    name: "Page.clipboard",
    signature: "await page.clipboard(text) / await page.readClipboard()",
    area: "act",
    summary: "Write to and read from the real system clipboard.",
  },
  {
    name: "Page.goBack",
    signature: "await page.goBack()",
    area: "act",
    summary: "Browser back.",
  },
  {
    name: "Page.goForward",
    signature: "await page.goForward()",
    area: "act",
    summary: "Browser forward.",
  },
  {
    name: "Page.reload",
    signature: "await page.reload()",
    area: "act",
    summary: "Reload the current document.",
  },

  // --- waiting -------------------------------------------------------------
  {
    name: "Page.waitFor",
    signature: "await page.waitFor(target, { timeoutMs?, intervalMs? })",
    area: "wait",
    summary: "Wait for a target to resolve. Retries only transient failures.",
    options: { timeoutMs: "positiveMilliseconds", intervalMs: "positiveMilliseconds" },
  },
  {
    name: "Page.waitForText",
    signature: "await page.waitForText(text, { timeoutMs? })",
    area: "wait",
    summary: "Wait until the page text contains this substring (case-insensitive).",
    options: { timeoutMs: "positiveMilliseconds" },
  },
  {
    name: "Page.waitForExpression",
    signature: "await page.waitForExpression(js, { timeoutMs? })",
    area: "wait",
    summary: "Wait until a JS expression is truthy.",
    options: { timeoutMs: "positiveMilliseconds" },
  },
  {
    name: "Page.waitForLoad",
    signature: "await page.waitForLoad({ timeoutMs? })",
    area: "wait",
    summary: "Wait for document.readyState === 'complete'.",
    options: { timeoutMs: "positiveMilliseconds" },
  },
  {
    name: "Page.waitForNavigation",
    signature: "await page.waitForNavigation({ timeoutMs? })",
    area: "wait",
    summary:
      "Wait for a real navigation (loaderId change, then load). Needed after a click: waitForLoad returns instantly on the old document.",
    options: { timeoutMs: "positiveMilliseconds" },
  },
  {
    name: "Page.waitForNetworkIdle",
    signature: "await page.waitForNetworkIdle({ idleMs?, timeoutMs? })",
    area: "wait",
    summary: "Wait until no request has been in flight for idleMs.",
    options: { idleMs: "positiveMilliseconds", timeoutMs: "positiveMilliseconds" },
  },
  {
    name: "Page.waitForDialog",
    signature: "await page.waitForDialog({ timeoutMs? })",
    area: "wait",
    summary: "Wait for a JS dialog to open.",
    options: { timeoutMs: "positiveMilliseconds" },
  },

  // --- dialogs -------------------------------------------------------------
  {
    name: "Page.answerDialog",
    signature: "await page.answerDialog({ accept?, promptText? })",
    area: "dialogs",
    summary: "Answer the oldest open dialog explicitly.",
    options: { accept: "boolean", promptText: "string" },
  },
  {
    name: "Page.setDialogPolicy",
    signature: "await page.setDialogPolicy(policy)",
    area: "dialogs",
    summary:
      'accept | dismiss | manual. Default is dismiss: an unanswered dialog hangs the page.',
  },

  // --- verification --------------------------------------------------------
  {
    name: "Page.evaluate",
    signature: "await page.evaluate(js, { sessionId? })",
    area: "verify",
    summary: "Run JS in the page (or a frame, given its sessionId) and return the value.",
    options: { sessionId: "string" },
  },
  {
    name: "Page.cdp",
    signature: "await page.cdp({ method, params?, sessionId? })",
    area: "verify",
    summary: "Raw CDP escape hatch, including per-frame sessions.",
    options: { sessionId: "string" },
  },
  {
    name: "sendCDPMessage",
    signature: "await sendCDPMessage({ method, params?, sessionId? })",
    area: "verify",
    summary: "Same as Page.cdp for the selected space.",
  },

  // --- learned site skills -------------------------------------------------
  {
    name: "runSiteTool",
    signature: "await runSiteTool(siteId, toolName, args?)",
    area: "learn",
    summary: "Run a learned node-side site tool. It receives the live browser context.",
  },
  {
    name: "runSiteBrowserTool",
    signature: "await runSiteBrowserTool(siteId, toolName, args?)",
    area: "learn",
    summary: "Run a learned page-side site tool (evaluated inside the page).",
  },
  {
    name: "learnContext",
    signature: "await learnContext({ url? })",
    area: "learn",
    summary: "Notes and tool signatures for a URL.",
  },
  {
    name: "validateSiteSkills",
    signature: "await validateSiteSkills()",
    area: "learn",
    summary: "Check every installed site skill; returns { ok, errors }.",
  },

  // --- utilities -----------------------------------------------------------
  {
    name: "cliLog",
    signature: "cliLog(...values)",
    area: "utility",
    summary: "Print a line to the agent's output.",
  },
  {
    name: "help",
    signature: "help()",
    area: "utility",
    summary: "Print this guide.",
  },
];

/** Validation kinds used by both the runtime and this description. */
export function validateOptionValue(name, kind, value) {
  if (value === undefined) return null;
  const fail = (expectation) =>
    `option ${name} ${expectation}, got ${JSON.stringify(value)}`;
  switch (kind) {
    case "boolean":
      return typeof value === "boolean" ? null : fail("must be a boolean");
    case "string":
      return typeof value === "string" ? null : fail("must be a string");
    case "nonEmptyString":
      return typeof value === "string" && value.trim()
        ? null
        : fail("must be a non-empty string");
    case "finiteNumber":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : fail("must be a finite number");
    case "nonNegativeNumber":
      return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? null
        : fail("must be a number >= 0");
    case "positiveInteger":
      return Number.isInteger(value) && value > 0 ? null : fail("must be a positive integer");
    case "positiveMilliseconds":
      return typeof value === "number" && Number.isFinite(value) && value > 0
        ? null
        : fail("must be a positive number of milliseconds");
    case "mouseButton":
      return ["left", "right", "middle"].includes(value)
        ? null
        : fail("must be one of left, right, middle");
    case "screenshotFormat":
      return ["png", "jpeg"].includes(value) ? null : fail("must be png or jpeg");
    case "keep":
      if (value === "all") return null;
      if (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === "string" && entry.trim()) &&
        new Set(value).size === value.length
      ) {
        return null;
      }
      return fail('must be "all" or an array of unique non-empty Page labels');
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? null
        : fail("must be an object");
    default:
      return null;
  }
}

/** Throw on an unknown key or a bad value for a declared option. */
export function validateOptions(apiName, schema, options = {}) {
  const declared = schema.options ?? {};
  for (const [key, value] of Object.entries(options)) {
    if (!(key in declared)) {
      const expected = Object.keys(declared).join(", ") || "no options";
      throw new TypeError(
        `${apiName} received unknown option: ${key}. Expected: ${expected}`,
      );
    }
    const problem = validateOptionValue(key, declared[key], value);
    if (problem) throw new TypeError(`${apiName}: ${problem}`);
  }
}

const AREA_TITLES = {
  discovery: "Discovery",
  spaces: "Task spaces",
  "space-methods": "TaskSpace methods",
  observe: "Observing",
  act: "Acting",
  wait: "Waiting",
  dialogs: "JS dialogs",
  verify: "Verifying and raw CDP",
  learn: "Learned site skills",
  utility: "Utilities",
};

/** Render the guide. Generated, never transcribed. */
export function renderHelp() {
  const lines = ["aragon-browser helpers", ""];
  const areas = [...new Set(PUBLIC_API_SCHEMA.map((entry) => entry.area))];
  for (const area of areas) {
    lines.push(`${AREA_TITLES[area] ?? area}`);
    for (const entry of PUBLIC_API_SCHEMA.filter((item) => item.area === area)) {
      lines.push(`  ${entry.signature}`);
      lines.push(`      ${entry.summary}`);
    }
    lines.push("");
  }
  lines.push("Targets: @N ref | css:<sel> | loc=role:<role>[name=...] | text=...");
  lines.push("         href:<path> | xpath=<expr> | <css> >> nth=N");
  lines.push("Refs (@N) stay stable while the document lives and go stale after navigation.");
  return lines.join("\n");
}

/** One-line signature lookup, used to keep suggestions self-consistent. */
export function signatureFor(apiName) {
  return PUBLIC_API_SCHEMA.find((entry) => entry.name === apiName)?.signature ?? null;
}
