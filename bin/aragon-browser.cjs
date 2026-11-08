#!/usr/bin/env node
// aragon-browser CLI - bundled from src/cli/index.js. Do not edit; rebuild with `npm run build:cli`.
const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/shared/paths.js
function existing(candidates, marker) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const target = marker ? import_node_path3.default.join(candidate, marker) : candidate;
      if (import_node_fs3.default.existsSync(target)) return candidate;
    } catch {
    }
  }
  return null;
}
function skillBodyDir() {
  const found = existing(
    [
      process.env.ARAGON_SKILL_DIR,
      import_node_path3.default.join(here, "skill-body"),
      import_node_path3.default.join(here, "..", "src", "cli", "skill-body"),
      process.env.ARAGON_RESOURCES_DIR ? import_node_path3.default.join(process.env.ARAGON_RESOURCES_DIR, "skill-body") : null,
      import_node_path3.default.join(here, "..", "..", "src", "cli", "skill-body")
    ],
    "SKILL.md"
  );
  if (!found) {
    throw new Error(
      "aragon-browser: could not find skill-body/SKILL.md; reinstall or set ARAGON_SKILL_DIR"
    );
  }
  return found;
}
function workspaceRoot() {
  if (process.env.ARAGON_AGENT_WORKSPACE) {
    return import_node_path3.default.resolve(process.env.ARAGON_AGENT_WORKSPACE);
  }
  const skillDirName = import_node_path3.default.join("skills", "aragon-browser");
  const found = existing(
    [
      import_node_path3.default.join(here, "..", "..", skillDirName),
      import_node_path3.default.join(here, "..", skillDirName),
      process.resourcesPath ? import_node_path3.default.join(process.resourcesPath, skillDirName) : null,
      import_node_path3.default.join(here, "..", ".."),
      import_node_path3.default.join(here, "..", "..", "..")
    ],
    import_node_path3.default.join("learnings")
  );
  return found ?? import_node_path3.default.join(here, "..", "..");
}
var import_node_fs3, import_node_path3, import_node_url, __dirname, here;
var init_paths = __esm({
  "src/shared/paths.js"() {
    import_node_fs3 = __toESM(require("node:fs"), 1);
    import_node_path3 = __toESM(require("node:path"), 1);
    import_node_url = require("node:url");
    __dirname = import_node_path3.default.dirname((0, import_node_url.fileURLToPath)(__importMetaUrl));
    here = (() => {
      try {
        return __dirname;
      } catch {
        return ".";
      }
    })();
  }
});

// src/kernel/learning/manifest.js
function learningsRoot(workspace = agentWorkspace()) {
  return import_node_path4.default.join(workspace, "learnings");
}
function agentWorkspace() {
  const override = process.env.ARAGON_AGENT_WORKSPACE;
  if (override && override.trim()) return import_node_path4.default.resolve(override.trim());
  return workspaceRoot();
}
async function pathExists(target) {
  try {
    await import_node_fs4.default.promises.stat(target);
    return true;
  } catch {
    return false;
  }
}
async function iterLearningDirs(root) {
  let entries;
  try {
    entries = await import_node_fs4.default.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("_")).map((entry) => import_node_path4.default.join(root, entry.name)).sort();
}
var import_node_fs4, import_node_path4;
var init_manifest = __esm({
  "src/kernel/learning/manifest.js"() {
    import_node_fs4 = __toESM(require("node:fs"), 1);
    import_node_path4 = __toESM(require("node:path"), 1);
    init_paths();
  }
});

// src/kernel/learning/validate.js
var validate_exports = {};
__export(validate_exports, {
  isBrowserToolPath: () => isBrowserToolPath,
  isNodeToolPath: () => isNodeToolPath,
  isNotePath: () => isNotePath,
  isSafeRelativePath: () => isSafeRelativePath,
  isSafeToolName: () => isSafeToolName,
  isValidDomain: () => isValidDomain,
  validateLearning: () => validateLearning,
  validateLearnings: () => validateLearnings,
  validateSiteSkills: () => validateSiteSkills
});
function isValidDomain(pattern) {
  if (typeof pattern !== "string" || !pattern) return false;
  if (pattern.includes("://") || pattern.includes("/") || pattern.startsWith(".") || pattern.endsWith(".")) {
    return false;
  }
  if (pattern.includes("*")) {
    return pattern.startsWith("*.") && pattern.indexOf("*") === pattern.lastIndexOf("*") && pattern.length > 2;
  }
  return true;
}
function isSafeToolName(name) {
  return typeof name === "string" && Boolean(name) && !name.includes("/") && !name.includes("\\") && name !== "." && name !== ".." && !name.includes("..");
}
function isSafeRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || import_node_path5.default.isAbsolute(value)) {
    return false;
  }
  return value.split("/").every((part) => part && part !== "." && part !== "..");
}
function isNotePath(value) {
  const parts = isSafeRelativePath(value) ? value.split("/") : [];
  return parts.length === 2 && parts[0] === "notes" && parts[1].endsWith(".md");
}
function isNodeToolPath(value) {
  const parts = isSafeRelativePath(value) ? value.split("/") : [];
  return parts.length === 2 && parts[0] === "tools" && parts[1].endsWith(".js");
}
function isBrowserToolPath(value) {
  const parts = isSafeRelativePath(value) ? value.split("/") : [];
  return parts.length === 2 && parts[0] === "browser-tools" && parts[1].endsWith(".js");
}
function asStringList(manifest, key, errors, siteId) {
  const value = manifest[key] || [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    errors.push(`${siteId}: ${key} must be a list of non-empty strings`);
    return [];
  }
  return value;
}
function validateValueSchema(prefix, schema, errors, requireRequired, typeLabel) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    errors.push(`${prefix}: schema must be an object`);
    return;
  }
  if (!TOOL_VALUE_TYPES.has(schema.type)) {
    errors.push(`${prefix}: invalid ${typeLabel} type ${JSON.stringify(schema.type)}`);
  }
  if (requireRequired && typeof schema.required !== "boolean") {
    errors.push(`${prefix}: required must be a boolean`);
  }
  if (typeof schema.description !== "string" || !schema.description.trim()) {
    errors.push(`${prefix}: description must be a non-empty string`);
  }
}
function validateToolSchema(siteId, key, toolName, schema, errors) {
  const prefix = `${siteId}: ${key}.${toolName}`;
  if (!isSafeToolName(toolName)) {
    errors.push(
      `${siteId}: ${key} contains invalid tool name ${JSON.stringify(toolName)}`
    );
    return;
  }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    errors.push(`${prefix}: schema must be an object`);
    return;
  }
  if (typeof schema.description !== "string" || !schema.description.trim()) {
    errors.push(`${prefix}: description must be a non-empty string`);
  }
  if (key === "nodeTools") {
    if (!isNodeToolPath(schema.path)) {
      errors.push(`${prefix}: path must be a relative tools/*.js path`);
    }
    if (typeof schema.callable !== "string" || !schema.callable.trim()) {
      errors.push(`${prefix}: callable must be a non-empty string`);
    }
  } else if (!isBrowserToolPath(schema.path)) {
    errors.push(`${prefix}: path must be a relative browser-tools/*.js path`);
  }
  if (!schema.args || typeof schema.args !== "object" || Array.isArray(schema.args)) {
    errors.push(`${prefix}: args must be an object`);
  } else {
    for (const [argName, argSchema] of Object.entries(schema.args)) {
      if (typeof argName !== "string" || !argName.trim()) {
        errors.push(
          `${prefix}: args contains invalid argument name ${JSON.stringify(argName)}`
        );
        continue;
      }
      validateValueSchema(`${prefix}.args.${argName}`, argSchema, errors, true, "arg");
    }
  }
  if (!schema.returns || typeof schema.returns !== "object" || Array.isArray(schema.returns)) {
    errors.push(`${prefix}: returns must be an object`);
  } else {
    validateValueSchema(`${prefix}.returns`, schema.returns, errors, false, "return");
  }
}
function validateToolMap(manifest, key, errors, siteId) {
  const value = manifest[key] || {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${siteId}: ${key} must be an object keyed by tool name`);
    return {};
  }
  for (const [toolName, schema] of Object.entries(value)) {
    validateToolSchema(siteId, key, toolName, schema, errors);
  }
  return value;
}
async function rejectTemporaryRefs(siteDir, relativePath, prefix, errors) {
  let text;
  try {
    text = await import_node_fs5.default.promises.readFile(import_node_path5.default.join(siteDir, relativePath), "utf8");
  } catch {
    return;
  }
  if (TEMP_REF_RE.test(text)) {
    errors.push(
      `${prefix}: contains temporary snapshot ref; use stable locators instead`
    );
  }
}
async function validateLearning(siteDir) {
  const errors = [];
  const siteId = siteDir.split(/[\\/]/).at(-1);
  let manifest;
  try {
    manifest = JSON.parse(
      await import_node_fs5.default.promises.readFile(import_node_path5.default.join(siteDir, "manifest.json"), "utf8")
    );
  } catch (error) {
    return [`${siteId}: invalid or missing manifest.json: ${error.message}`];
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [`${siteId}: manifest.json must contain a JSON object`];
  }
  if (manifest.id !== siteId) {
    errors.push(`${siteId}: manifest id must match directory name`);
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    errors.push(`${siteId}: name must be a non-empty string`);
  }
  const domains = asStringList(manifest, "domains", errors, siteId);
  if (domains.length === 0) errors.push(`${siteId}: domains must not be empty`);
  for (const domain of domains) {
    if (!isValidDomain(domain)) {
      errors.push(`${siteId}: invalid domain ${JSON.stringify(domain)}`);
    }
  }
  for (const note of asStringList(manifest, "notes", errors, siteId)) {
    if (!isNotePath(note)) {
      errors.push(
        `${siteId}: notes must point to notes/*.md: ${JSON.stringify(note)}`
      );
      continue;
    }
    if (!await pathExists(import_node_path5.default.join(siteDir, note))) {
      errors.push(`${siteId}: missing note ${JSON.stringify(note)}`);
    }
    await rejectTemporaryRefs(siteDir, note, `${siteId}: note ${JSON.stringify(note)}`, errors);
  }
  const nodeTools = validateToolMap(manifest, "nodeTools", errors, siteId);
  for (const [toolName, schema] of Object.entries(nodeTools)) {
    if (!schema || typeof schema !== "object" || !isNodeToolPath(schema.path)) continue;
    if (!await pathExists(import_node_path5.default.join(siteDir, schema.path))) {
      errors.push(
        `${siteId}: missing Node tool file ${JSON.stringify(schema.path)} for tool ${JSON.stringify(toolName)}`
      );
      continue;
    }
    await rejectTemporaryRefs(
      siteDir,
      schema.path,
      `${siteId}: Node tool ${JSON.stringify(toolName)}`,
      errors
    );
    try {
      const module2 = await import(`${(0, import_node_url2.pathToFileURL)(import_node_path5.default.join(siteDir, schema.path)).href}?validate=${Date.now()}`);
      if (typeof schema.callable === "string" && typeof module2[schema.callable] !== "function") {
        errors.push(
          `${siteId}: missing Node callable ${JSON.stringify(schema.callable)} for tool ${JSON.stringify(toolName)}`
        );
      }
    } catch (error) {
      errors.push(
        `${siteId}: cannot import Node tool ${JSON.stringify(schema.path)}: ${error.message}`
      );
    }
  }
  const browserTools = validateToolMap(manifest, "browserTools", errors, siteId);
  for (const [toolName, schema] of Object.entries(browserTools)) {
    if (!schema || typeof schema !== "object" || !isBrowserToolPath(schema.path)) {
      continue;
    }
    if (!await pathExists(import_node_path5.default.join(siteDir, schema.path))) {
      errors.push(
        `${siteId}: missing browser tool file ${JSON.stringify(schema.path)} for tool ${JSON.stringify(toolName)}`
      );
    }
    await rejectTemporaryRefs(
      siteDir,
      schema.path,
      `${siteId}: browser tool ${JSON.stringify(toolName)}`,
      errors
    );
  }
  return errors;
}
async function validateLearnings(root = learningsRoot()) {
  const errors = [];
  for (const siteDir of await iterLearningDirs(root)) {
    errors.push(...await validateLearning(siteDir));
  }
  return errors;
}
var import_node_path5, import_node_url2, import_node_fs5, TOOL_VALUE_TYPES, TEMP_REF_RE, validateSiteSkills;
var init_validate = __esm({
  "src/kernel/learning/validate.js"() {
    import_node_path5 = __toESM(require("node:path"), 1);
    import_node_url2 = require("node:url");
    import_node_fs5 = __toESM(require("node:fs"), 1);
    init_manifest();
    TOOL_VALUE_TYPES = /* @__PURE__ */ new Set([
      "string",
      "number",
      "integer",
      "boolean",
      "array",
      "object"
    ]);
    TEMP_REF_RE = /(?:@\d+\b|\bref=\d+\b)/;
    validateSiteSkills = validateLearnings;
  }
});

// src/cli/index.js
var import_node_fs6 = __toESM(require("node:fs"), 1);
var import_node_path6 = __toESM(require("node:path"), 1);
var import_node_process = __toESM(require("node:process"), 1);
var import_node_url3 = require("node:url");

// src/shared/protocol.js
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var ERROR_CODES = {
  BROWSER_UNAVAILABLE: "EGO_BROWSER_UNAVAILABLE",
  CDP_CHANNEL_UNAVAILABLE: "EGO_CDP_CHANNEL_UNAVAILABLE",
  CDP_SEND_FAILED: "EGO_CDP_SEND_FAILED",
  INVALID_ARGUMENT: "EGO_INVALID_ARGUMENT",
  OPERATION_FAILED: "EGO_OPERATION_FAILED",
  SNAPSHOT_FAILED: "EGO_SNAPSHOT_FAILED",
  TASK_SPACE_INACTIVE: "EGO_TASK_SPACE_INACTIVE",
  TASK_SPACE_NOT_FOUND: "EGO_TASK_SPACE_NOT_FOUND",
  TASK_SPACE_NOT_SELECTED: "EGO_TASK_SPACE_NOT_SELECTED",
  TASK_SPACE_USER_IN_CONTROL: "EGO_TASK_SPACE_USER_IN_CONTROL",
  WEB_CONTENTS_UNAVAILABLE: "EGO_WEB_CONTENTS_UNAVAILABLE",
  REF_STALE: "ARAGON_REF_STALE",
  REF_NOT_FOUND: "ARAGON_REF_NOT_FOUND",
  RUNTIME_NOT_RUNNING: "ARAGON_RUNTIME_NOT_RUNNING",
  RUNTIME_STALE: "ARAGON_RUNTIME_STALE",
  UNAUTHORIZED: "ARAGON_UNAUTHORIZED",
  NO_SUCH_METHOD: "ARAGON_NO_SUCH_METHOD"
};
var AragonError = class extends Error {
  constructor(code, message, cause) {
    super(message ?? code);
    this.name = "AragonError";
    this.error_code = code;
    if (cause) this.cause = cause;
  }
};
function runtimeFilePath() {
  const override = process.env.ARAGON_RUNTIME_FILE;
  if (override && override.trim()) return import_node_path.default.resolve(override.trim());
  return import_node_path.default.join(import_node_os.default.tmpdir(), "aragon-browser", "runtime.json");
}

// src/cli/transport-client.js
var import_node_net = __toESM(require("node:net"), 1);

// src/kernel/runtime-transport.js
var import_node_fs = __toESM(require("node:fs"), 1);
var MAX_LINE_BYTES = 32 * 1024 * 1024;
function readRuntimeCoordinates(runtimeFile) {
  let raw;
  try {
    raw = import_node_fs.default.readFileSync(runtimeFile, "utf8");
  } catch {
    throw new AragonError(
      ERROR_CODES.RUNTIME_NOT_RUNNING,
      "aragon-browser is not running: start it with `npm start` (or the packaged app), then retry"
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AragonError(
      ERROR_CODES.RUNTIME_STALE,
      "runtime coordinates are unreadable; restart aragon-browser"
    );
  }
  if (!parsed?.port || !parsed?.token) {
    throw new AragonError(
      ERROR_CODES.RUNTIME_STALE,
      "runtime coordinates are incomplete; restart aragon-browser"
    );
  }
  return parsed;
}
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

// src/cli/transport-client.js
var DEFAULT_TIMEOUT_MS = 3e4;
var RuntimeClient = class {
  constructor({ runtimeFile = runtimeFilePath(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.runtimeFile = runtimeFile;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.pending = /* @__PURE__ */ new Map();
    this.nextId = 1;
    this.buffer = "";
    this.onEvent = null;
    this.info = null;
  }
  async connect() {
    const coordinates = readRuntimeCoordinates(this.runtimeFile);
    if (!isProcessAlive(coordinates.pid)) {
      throw new AragonError(
        ERROR_CODES.RUNTIME_STALE,
        `aragon-browser (pid ${coordinates.pid}) is gone but left coordinates behind; start it again`
      );
    }
    this.info = coordinates;
    const handshake = this.handshake;
    await new Promise((resolve, reject) => {
      const socket = import_node_net.default.createConnection({
        port: coordinates.port,
        host: "127.0.0.1"
      });
      this.socket = socket;
      socket.setEncoding("utf8");
      socket.once("connect", () => {
        socket.write(
          `${JSON.stringify({ type: "hello", token: coordinates.token })}
`
        );
        resolve();
      });
      socket.on("error", (error) => {
        this.#failAll(error);
        this.handshakeReject?.(error);
        reject(error);
      });
      socket.on("close", () => {
        this.#failAll(
          new AragonError(ERROR_CODES.RUNTIME_STALE, "runtime connection closed")
        );
      });
      socket.on("data", (chunk) => this.#onData(chunk));
    });
    const hello = await handshake;
    this.info = { ...coordinates, ...hello };
    return this.info;
  }
  get handshake() {
    if (!this.handshakePromise) {
      this.handshakePromise = new Promise((resolve, reject) => {
        this.handshakeResolve = resolve;
        this.handshakeReject = reject;
        setTimeout(
          () => reject(new AragonError(ERROR_CODES.RUNTIME_STALE, "handshake timed out")),
          this.timeoutMs
        ).unref?.();
      });
    }
    return this.handshakePromise;
  }
  #onData(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length > 0) this.#onMessage(line);
      index = this.buffer.indexOf("\n");
    }
  }
  #onMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message?.type === "hello") {
      if (message.ok) this.handshakeResolve?.(message);
      else {
        this.handshakeReject?.(
          new AragonError(
            message.error?.error_code ?? ERROR_CODES.UNAUTHORIZED,
            message.error?.message ?? "handshake rejected"
          )
        );
      }
      return;
    }
    if (message?.event && !("id" in message)) {
      this.onEvent?.(message);
      return;
    }
    const entry = this.pending.get(message?.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else {
      entry.reject(
        new AragonError(
          message.error?.error_code ?? ERROR_CODES.OPERATION_FAILED,
          message.error?.message ?? "request failed"
        )
      );
    }
  }
  #failAll(error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
  request(method, params = {}, { timeoutMs } = {}) {
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(
        new AragonError(ERROR_CODES.RUNTIME_STALE, "runtime socket is not open")
      );
    }
    const patience = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.timeoutMs;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new AragonError(
            ERROR_CODES.OPERATION_FAILED,
            `${method} timed out after ${patience}ms`
          )
        );
      }, patience);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ id, method, params })}
`);
    });
  }
  close() {
    this.#failAll(new AragonError(ERROR_CODES.RUNTIME_STALE, "runtime client closed"));
    if (this.socket && !this.socket.destroyed) this.socket.end();
    this.socket = null;
  }
};

// src/cli/helpers.js
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);

// src/shared/public-api-schema.js
var PUBLIC_API_SCHEMA = [
  // --- discovery -----------------------------------------------------------
  {
    name: "browserVersion",
    signature: "await browserVersion()",
    area: "discovery",
    summary: "Browser version, engine, platform and live space count."
  },
  {
    name: "listProfiles",
    signature: "await listProfiles()",
    area: "discovery",
    summary: 'Available profiles: [{ id, name, kind }]. "ephemeral" never writes to disk.'
  },
  {
    name: "listTaskSpaces",
    signature: "await listTaskSpaces()",
    area: "discovery",
    summary: "Every space with id, name, owner, agentState, profile and tabs."
  },
  {
    name: "listLearnedSites",
    signature: "await listLearnedSites()",
    area: "discovery",
    summary: "Installed site skills: id, name, domains, tool names."
  },
  // --- spaces --------------------------------------------------------------
  {
    name: "taskSpace",
    signature: "await taskSpace(nameOrId)",
    area: "spaces",
    summary: "Select an existing space by name or id, creating it when the name is new. Reuses an agent-owned space of that name."
  },
  {
    name: "createTaskSpace",
    signature: "await createTaskSpace(name, profileId?)",
    area: "spaces",
    summary: "Create a space. It appears in the window's sidebar (spaces share one window). profileId comes from listProfiles()."
  },
  {
    name: "claimTaskSpace",
    signature: "await claimTaskSpace(id)",
    area: "spaces",
    summary: "Take an agent-owned space by numeric id and make it current."
  },
  {
    name: "useTaskSpace",
    signature: "useTaskSpace(id)",
    area: "spaces",
    summary: "Select a space for the bare helpers (snapshot, listTabs, sendCDPMessage)."
  },
  {
    name: "takeOverTaskSpace",
    signature: "await takeOverTaskSpace(id?)",
    area: "spaces",
    summary: "Resume driving after the user had control."
  },
  {
    name: "closeTaskSpace",
    signature: "await closeTaskSpace(id?)",
    area: "spaces",
    summary: "Close a space and its tabs. The window stays open: every space shares it."
  },
  // --- TaskSpace methods ---------------------------------------------------
  {
    name: "TaskSpace.pages",
    signature: "await space.pages()",
    area: "space-methods",
    summary: "Page handles for every tab in the space."
  },
  {
    name: "TaskSpace.tabs",
    signature: "await space.tabs()",
    area: "space-methods",
    summary: "Tab inventory: { id, label, origin, url, title, active }."
  },
  {
    name: "TaskSpace.newPage",
    signature: "await space.newPage(url?)",
    area: "space-methods",
    summary: "Open a tab (default about:blank) and return its Page."
  },
  {
    name: "TaskSpace.page",
    signature: "space.page(label)",
    area: "space-methods",
    summary: "A Page handle for a durable label such as p1."
  },
  {
    name: "TaskSpace.handOff",
    signature: "await space.handOff()",
    area: "space-methods",
    summary: "Give control to the user. Every mutating call fails with EGO_TASK_SPACE_USER_IN_CONTROL until takeOver."
  },
  {
    name: "TaskSpace.finish",
    signature: "await space.finish({ keep })",
    area: "space-methods",
    summary: 'keep is required: "all" or an array of Page labels. Closes agent tabs, never a tab the user opened. The space stays in the sidebar unless it is empty.',
    options: { keep: "keep" }
  },
  {
    name: "TaskSpace.close",
    signature: "await space.close()",
    area: "space-methods",
    summary: "Close the space and its tabs. Spaces share one window, so the window stays open for the others."
  },
  {
    name: "TaskSpace.waitForControl",
    signature: "await space.waitForControl({ interval?, timeout? })",
    area: "space-methods",
    summary: "Poll until the user hands the space back, without taking control.",
    options: {
      interval: "positiveMilliseconds",
      timeout: "positiveMilliseconds"
    }
  },
  {
    name: "TaskSpace.setAgentState",
    signature: "await space.setAgentState(state)",
    area: "space-methods",
    summary: "idle | running | paused | error, shown in the UI."
  },
  {
    name: "TaskSpace.learn",
    signature: "await space.learn({ url? })",
    area: "space-methods",
    summary: "Learned notes and tool signatures that apply to this page."
  },
  // --- Page observation ----------------------------------------------------
  {
    name: "Page.snapshot",
    signature: "await page.snapshot({ interactiveOnly?, maxDepth?, debug? })",
    area: "observe",
    summary: "Accessibility snapshot: text plus refs[]. Cross-site iframes are flattened at their <iframe> element.",
    options: {
      interactiveOnly: "boolean",
      maxDepth: "positiveInteger",
      debug: "boolean"
    }
  },
  {
    name: "Page.info",
    signature: "await page.info()",
    area: "observe",
    summary: "url, title, tab count, history availability, loading flag."
  },
  {
    name: "Page.frames",
    signature: "await page.frames()",
    area: "observe",
    summary: "CDP session topology: sessionId, frameId, parentSessionId per frame."
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
      save: "nonEmptyString"
    }
  },
  {
    name: "Page.events",
    signature: "await page.events({ method?, sinceSeq?, limit? })",
    area: "observe",
    summary: "Recent CDP events (bounded 10k ring). method accepts a `*` suffix.",
    options: {
      method: "string",
      sinceSeq: "nonNegativeNumber",
      limit: "positiveInteger"
    }
  },
  {
    name: "Page.dialogs",
    signature: "await page.dialogs()",
    area: "observe",
    summary: "JS dialogs seen so far and the current auto-handling policy."
  },
  // --- acting --------------------------------------------------------------
  {
    name: "Page.goto",
    signature: "await page.goto(url)",
    area: "act",
    summary: "Navigate the current tab. Invalidates every ref from the old document."
  },
  {
    name: "Page.click",
    signature: "await page.click(target, { button?, clickCount? })",
    area: "act",
    summary: "Trusted pointer click at the element's measured position.",
    options: { button: "mouseButton", clickCount: "positiveInteger" }
  },
  {
    name: "Page.doubleClick",
    signature: "await page.doubleClick(target)",
    area: "act",
    summary: "Two real clicks with the native double-click interval."
  },
  {
    name: "Page.rightClick",
    signature: "await page.rightClick(target)",
    area: "act",
    summary: "Right button click (context menu)."
  },
  {
    name: "Page.fill",
    signature: "await page.fill(target, text, { submit?, delayMs? })",
    area: "act",
    summary: "Focus, select-all, then insertText so framework-controlled inputs see a real input event.",
    options: { submit: "boolean", delayMs: "nonNegativeNumber" }
  },
  {
    name: "Page.type",
    signature: "await page.type(text, { delayMs? })",
    area: "act",
    summary: "Type into whatever currently has focus.",
    options: { delayMs: "nonNegativeNumber" }
  },
  {
    name: "Page.press",
    signature: "await page.press(key)",
    area: "act",
    summary: "Enter | Tab | Escape | Backspace | Delete | Arrow* | space | a single character."
  },
  {
    name: "Page.hover",
    signature: "await page.hover(target)",
    area: "act",
    summary: "Move the pointer over an element."
  },
  {
    name: "Page.scroll",
    signature: "await page.scroll({ dx?, dy?, target? })",
    area: "act",
    summary: "Wheel scroll, optionally aimed at an element.",
    // `target` is in the signature and forwarded by `Page.scroll`; declaring it
    // here is what makes scrolling at an element possible at all.
    options: { dx: "finiteNumber", dy: "finiteNumber", target: "string" }
  },
  {
    name: "Page.drag",
    signature: "await page.drag(from, to, { steps? })",
    area: "act",
    summary: "Pointer drag with intermediate moves, which drag implementations require.",
    options: { steps: "positiveInteger" }
  },
  {
    name: "Page.upload",
    signature: "await page.upload(target, files)",
    area: "act",
    summary: 'Attach files to an <input type="file">. Paths are existence-checked first.'
  },
  {
    name: "Page.clipboard",
    signature: "await page.clipboard(text) / await page.readClipboard()",
    area: "act",
    summary: "Write to and read from the real system clipboard."
  },
  {
    name: "Page.goBack",
    signature: "await page.goBack()",
    area: "act",
    summary: "Browser back."
  },
  {
    name: "Page.goForward",
    signature: "await page.goForward()",
    area: "act",
    summary: "Browser forward."
  },
  {
    name: "Page.reload",
    signature: "await page.reload()",
    area: "act",
    summary: "Reload the current document."
  },
  {
    name: "Page.close",
    signature: "await page.close()",
    area: "act",
    summary: "Close this page's tab. Call it when the task is done with a page: an unclosed tab stays in the space (and in the sidebar) forever."
  },
  {
    name: "Page.keep",
    signature: "page.keep()",
    area: "act",
    summary: "Keep this page when the script ends. The CLI closes tabs the script opened; call keep() on a page the next round will act on."
  },
  // --- waiting -------------------------------------------------------------
  {
    name: "Page.waitFor",
    signature: "await page.waitFor(target, { timeoutMs?, intervalMs? })",
    area: "wait",
    summary: "Wait for a target to resolve. Retries only transient failures.",
    options: { timeoutMs: "positiveMilliseconds", intervalMs: "positiveMilliseconds" }
  },
  {
    name: "Page.waitForText",
    signature: "await page.waitForText(text, { timeoutMs? })",
    area: "wait",
    summary: "Wait until the page text contains this substring (case-insensitive).",
    options: { timeoutMs: "positiveMilliseconds" }
  },
  {
    name: "Page.waitForExpression",
    signature: "await page.waitForExpression(js, { timeoutMs? })",
    area: "wait",
    summary: "Wait until a JS expression is truthy.",
    options: { timeoutMs: "positiveMilliseconds" }
  },
  {
    name: "Page.waitForLoad",
    signature: "await page.waitForLoad({ timeoutMs? })",
    area: "wait",
    summary: "Wait for document.readyState === 'complete'.",
    options: { timeoutMs: "positiveMilliseconds" }
  },
  {
    name: "Page.waitForNavigation",
    signature: "await page.waitForNavigation({ timeoutMs? })",
    area: "wait",
    summary: "Wait for a real navigation (loaderId change, then load). Needed after a click: waitForLoad returns instantly on the old document.",
    options: { timeoutMs: "positiveMilliseconds" }
  },
  {
    name: "Page.waitForNetworkIdle",
    signature: "await page.waitForNetworkIdle({ idleMs?, timeoutMs? })",
    area: "wait",
    summary: "Wait until no request has been in flight for idleMs.",
    options: { idleMs: "positiveMilliseconds", timeoutMs: "positiveMilliseconds" }
  },
  {
    name: "Page.waitForDialog",
    signature: "await page.waitForDialog({ timeoutMs? })",
    area: "wait",
    summary: "Wait for a JS dialog to open.",
    options: { timeoutMs: "positiveMilliseconds" }
  },
  // --- dialogs -------------------------------------------------------------
  {
    name: "Page.answerDialog",
    signature: "await page.answerDialog({ accept?, promptText? })",
    area: "dialogs",
    summary: "Answer the oldest open dialog explicitly.",
    options: { accept: "boolean", promptText: "string" }
  },
  {
    name: "Page.setDialogPolicy",
    signature: "await page.setDialogPolicy(policy)",
    area: "dialogs",
    summary: "accept | dismiss | manual. Default is dismiss: an unanswered dialog hangs the page."
  },
  // --- verification --------------------------------------------------------
  {
    name: "Page.evaluate",
    signature: "await page.evaluate(js, { sessionId? })",
    area: "verify",
    summary: "Run JS in the page (or a frame, given its sessionId) and return the value.",
    options: { sessionId: "string" }
  },
  {
    name: "Page.cdp",
    signature: "await page.cdp({ method, params?, sessionId? })",
    area: "verify",
    summary: "Raw CDP escape hatch, including per-frame sessions.",
    options: { sessionId: "string" }
  },
  {
    name: "sendCDPMessage",
    signature: "await sendCDPMessage({ method, params?, sessionId? })",
    area: "verify",
    summary: "Same as Page.cdp for the selected space."
  },
  // --- learned site skills -------------------------------------------------
  {
    name: "runSiteTool",
    signature: "await runSiteTool(siteId, toolName, args?)",
    area: "learn",
    summary: "Run a learned node-side site tool. It receives the live browser context."
  },
  {
    name: "runSiteBrowserTool",
    signature: "await runSiteBrowserTool(siteId, toolName, args?)",
    area: "learn",
    summary: "Run a learned page-side site tool (evaluated inside the page)."
  },
  {
    name: "learnContext",
    signature: "await learnContext({ url? })",
    area: "learn",
    summary: "Notes and tool signatures for a URL."
  },
  {
    name: "validateSiteSkills",
    signature: "await validateSiteSkills()",
    area: "learn",
    summary: "Check every installed site skill; returns { ok, errors }."
  },
  // --- utilities -----------------------------------------------------------
  {
    name: "cliLog",
    signature: "cliLog(...values)",
    area: "utility",
    summary: "Print a line to the agent's output."
  },
  {
    name: "help",
    signature: "help()",
    area: "utility",
    summary: "Print this guide."
  }
];
function validateOptionValue(name, kind, value) {
  if (value === void 0) return null;
  const fail = (expectation) => `option ${name} ${expectation}, got ${JSON.stringify(value)}`;
  switch (kind) {
    case "boolean":
      return typeof value === "boolean" ? null : fail("must be a boolean");
    case "string":
      return typeof value === "string" ? null : fail("must be a string");
    case "nonEmptyString":
      return typeof value === "string" && value.trim() ? null : fail("must be a non-empty string");
    case "finiteNumber":
      return typeof value === "number" && Number.isFinite(value) ? null : fail("must be a finite number");
    case "nonNegativeNumber":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? null : fail("must be a number >= 0");
    case "positiveInteger":
      return Number.isInteger(value) && value > 0 ? null : fail("must be a positive integer");
    case "positiveMilliseconds":
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? null : fail("must be a positive number of milliseconds");
    case "mouseButton":
      return ["left", "right", "middle"].includes(value) ? null : fail("must be one of left, right, middle");
    case "screenshotFormat":
      return ["png", "jpeg"].includes(value) ? null : fail("must be png or jpeg");
    case "keep":
      if (value === "all") return null;
      if (Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim()) && new Set(value).size === value.length) {
        return null;
      }
      return fail('must be "all" or an array of unique non-empty Page labels');
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value) ? null : fail("must be an object");
    default:
      return null;
  }
}
function validateOptions(apiName, schema, options = {}) {
  const declared = schema.options ?? {};
  for (const [key, value] of Object.entries(options)) {
    if (!(key in declared)) {
      const expected = Object.keys(declared).join(", ") || "no options";
      throw new TypeError(
        `${apiName} received unknown option: ${key}. Expected: ${expected}`
      );
    }
    const problem = validateOptionValue(key, declared[key], value);
    if (problem) throw new TypeError(`${apiName}: ${problem}`);
  }
}
var AREA_TITLES = {
  discovery: "Discovery",
  spaces: "Task spaces",
  "space-methods": "TaskSpace methods",
  observe: "Observing",
  act: "Acting",
  wait: "Waiting",
  dialogs: "JS dialogs",
  verify: "Verifying and raw CDP",
  learn: "Learned site skills",
  utility: "Utilities"
};
function renderHelp() {
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

// src/cli/tab-cleanup.js
function planSweep({
  tracked = [],
  openTabs = [],
  userOwnedSpaceIds = [],
  keepTabs = false
} = {}) {
  const userOwned = new Set(userOwnedSpaceIds.map(Number));
  const openIndex = new Map(openTabs.map((tab) => [`${Number(tab.spaceId)}:${tab.id}`, tab]));
  const result = {
    close: [],
    keep: [],
    gone: [],
    skippedUserOwned: [],
    disabled: Boolean(keepTabs)
  };
  for (const entry of tracked) {
    const spaceId = Number(entry.spaceId);
    const open = openIndex.get(`${spaceId}:${entry.tabId}`) ?? null;
    const record = {
      spaceId,
      tabId: entry.tabId,
      label: entry.label ?? open?.label ?? null
    };
    if (keepTabs) {
      result.keep.push(record);
      continue;
    }
    if (open === null) {
      result.gone.push(record);
      continue;
    }
    if (entry.kept === true) {
      result.keep.push(record);
      continue;
    }
    if (userOwned.has(spaceId)) {
      result.skippedUserOwned.push(record);
      continue;
    }
    result.close.push(record);
  }
  return result;
}
function describeSweep(result, { keepTabs = false } = {}) {
  if (!result) return null;
  if (keepTabs) {
    return result.keep.length > 0 ? `aragon-browser: kept ${result.keep.length} tab(s) opened by this script (--keep-tabs)` : null;
  }
  if (result.close.length > 0) {
    const labels = result.close.map((entry) => entry.label ?? `tab-${entry.tabId}`).join(", ");
    return `aragon-browser: closed ${result.close.length} tab(s) this script left open (${labels}); use page.close() when done, or --keep-tabs / page.keep() to keep them`;
  }
  if (result.skippedUserOwned.length > 0) {
    return `aragon-browser: left ${result.skippedUserOwned.length} tab(s) alone because the space belongs to the user`;
  }
  return null;
}

// src/cli/helpers.js
var SCHEMA_BY_NAME = new Map(PUBLIC_API_SCHEMA.map((entry) => [entry.name, entry]));
function checkOptions(apiName, options) {
  const schema = SCHEMA_BY_NAME.get(apiName);
  if (schema) validateOptions(apiName, schema, options);
}
function createHelpers(client, { log = console.log } = {}) {
  let selectedSpaceId = null;
  const KERNEL_TIMEOUT_MS = /* @__PURE__ */ new Map([
    ["spaces.waitForControl", 6e5],
    ["wait.target", 1e4],
    ["wait.text", 1e4],
    ["wait.expression", 1e4],
    ["wait.load", 1e4],
    ["wait.navigation", 3e4],
    ["wait.networkIdle", 1e4],
    ["wait.dialog", 1e4]
  ]);
  const DEFAULT_TIMEOUT_MS2 = 3e4;
  const TIMEOUT_SLACK_MS = 1e4;
  function timeoutFor(method, params) {
    const kernelDefault = KERNEL_TIMEOUT_MS.get(method);
    if (kernelDefault === void 0) return void 0;
    const requested = Number.isInteger(params.timeout) ? params.timeout : Number.isInteger(params.timeoutMs) ? params.timeoutMs : kernelDefault;
    return Math.max(DEFAULT_TIMEOUT_MS2, requested) + TIMEOUT_SLACK_MS;
  }
  const call = (method, params = {}) => client.request(method, params, { timeoutMs: timeoutFor(method, params) });
  const runTabs = /* @__PURE__ */ new Map();
  function trackTab(spaceId, tabId, label, { kept = false } = {}) {
    if (!Number.isInteger(tabId)) return;
    runTabs.set(`${spaceId}:${tabId}`, { spaceId: Number(spaceId), tabId, label, kept });
  }
  function untrackTab(spaceId, tabId) {
    if (!Number.isInteger(tabId)) return;
    runTabs.delete(`${Number(spaceId)}:${tabId}`);
  }
  const withSpace = (params = {}) => {
    if (selectedSpaceId === null) {
      throw new AragonError(
        ERROR_CODES.TASK_SPACE_NOT_SELECTED,
        "no task space selected; call taskSpace(name) (creates one if needed) or useTaskSpace(id)"
      );
    }
    return { ...params, spaceId: selectedSpaceId };
  };
  async function resolveSpace(nameOrId) {
    if (nameOrId === void 0 || nameOrId === null) {
      const { spaces: spaces2 } = await call("spaces.list");
      const agentSpace = spaces2.find((space) => space.owner === "agent") ?? null;
      if (agentSpace) {
        selectedSpaceId = agentSpace.id;
        return agentSpace;
      }
      const created2 = await call("spaces.create", {});
      selectedSpaceId = created2.id;
      return created2;
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
      this.kept = false;
    }
    async #ensureTab() {
      const { tabs } = await call("tabs.list", { spaceId: this.spaceId });
      if (tabs.length === 0) {
        const created = await call("tabs.create", { spaceId: this.spaceId, url: "about:blank" });
        this.tabId = created.id;
        this.label = created.label ?? this.label;
        trackTab(this.spaceId, created.id, this.label, { kept: this.kept });
        return;
      }
      const target = this.tabId ? tabs.find((tab) => tab.id === this.tabId) : tabs.at(-1);
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
    /**
     * Close THIS page's tab.
     *
     * The counterpart of `space.newPage()`: an agent that opens a page and is done
     * with it should close it, or the tab stays in the space (and in the rail) for
     * the rest of the browser's life. Never creates a tab as a side effect - a
     * handle for a label that is already gone just reports `closed: false`.
     */
    async close() {
      const { tabs } = await call("tabs.list", { spaceId: this.spaceId });
      const target = (this.tabId !== null ? tabs.find((tab) => tab.id === this.tabId) : null) ?? (this.label !== null ? tabs.find((tab) => tab.label === this.label) : null) ?? null;
      if (!target) {
        untrackTab(this.spaceId, this.tabId);
        return { closed: false, label: this.label ?? null };
      }
      await call("tabs.close", { spaceId: this.spaceId, tabId: target.id });
      untrackTab(this.spaceId, target.id);
      this.tabId = null;
      this.label = target.label ?? this.label;
      return { closed: true, label: this.label ?? null };
    }
    /**
     * Keep this page when the script ends.
     *
     * Use it when the NEXT round will act on the same tab (`space.page('p2')`), so
     * the end-of-run sweep does not close the state you are about to reuse.
     */
    keep() {
      this.kept = true;
      for (const entry of runTabs.values()) {
        const sameTab = this.tabId !== null && entry.tabId === this.tabId;
        const sameLabel = this.label !== null && entry.label === this.label;
        if (entry.spaceId === Number(this.spaceId) && (sameTab || sameLabel)) {
          entry.kept = true;
        }
      }
      return { kept: true, label: this.label ?? null };
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
        fullPage: options.fullPage
      });
      if (!options.save) {
        return { ...shot, bytes: Buffer.from(shot.base64, "base64").length };
      }
      const target = import_node_path2.default.resolve(options.save);
      import_node_fs2.default.mkdirSync(import_node_path2.default.dirname(target), { recursive: true });
      import_node_fs2.default.writeFileSync(target, Buffer.from(shot.base64, "base64"));
      return { path: target, format: shot.format, bytes: import_node_fs2.default.statSync(target).size };
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
      trackTab(this.id, tab.id, tab.label ?? null);
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
      if (options.keep === void 0) {
        throw new TypeError(
          'finish() requires keep: "all" or an array of Page labels - closing tabs is destructive'
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
          "no task space selected yet"
        );
      }
      return new TaskSpace(await call("spaces.claim", { spaceId: selectedSpaceId }));
    },
    async takeOverTaskSpace(id = selectedSpaceId) {
      const spaceId = id === null || id === void 0 ? selectedSpaceId : Number(id);
      if (!spaceId) {
        throw new AragonError(
          ERROR_CODES.TASK_SPACE_NOT_SELECTED,
          "takeOverTaskSpace() needs an id when no space is selected"
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
        message
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
      log(args.map((arg) => typeof arg === "string" ? arg : safeJson(arg)).join(" "));
    },
    /**
     * Internal: what `index.js` runs after the script finishes.
     *
     * Not part of the documented surface (hence the `__` prefix), but it lives here
     * because the tracking does. It never throws: a sweep failure must not turn a
     * successful run into a failed one.
     */
    async __sweepTabs({ keepTabs = false } = {}) {
      const empty = {
        close: [],
        keep: [],
        gone: [],
        skippedUserOwned: [],
        disabled: Boolean(keepTabs)
      };
      if (runTabs.size === 0) return empty;
      let spacesList = [];
      try {
        spacesList = (await call("spaces.list")).spaces ?? [];
      } catch {
        return empty;
      }
      const openTabs = [];
      const userOwnedSpaceIds = [];
      for (const space of spacesList) {
        if (space.owner === "user") userOwnedSpaceIds.push(space.id);
        for (const tab of space.tabs ?? []) {
          openTabs.push({ spaceId: space.id, id: tab.id, label: tab.label ?? null });
        }
      }
      const plan = planSweep({
        tracked: [...runTabs.values()],
        openTabs,
        userOwnedSpaceIds,
        keepTabs
      });
      for (const entry of plan.close) {
        try {
          await call("tabs.close", { spaceId: entry.spaceId, tabId: entry.tabId });
        } catch {
        }
      }
      return plan;
    },
    /**
     * Internal: which space the human is looking at before this run starts.
     *
     * Acting on a page requires it to be on screen (Chromium drops input for a
     * hidden one), so a run on an agent space replaces the view. Remembering the
     * baseline lets `__restoreFocus` hand the view back afterwards.
     */
    async __focusBaseline() {
      try {
        const { spaces } = await call("spaces.list");
        const focused = spaces.find((space) => space.focused) ?? null;
        return focused ? { id: focused.id, owner: focused.owner } : null;
      } catch {
        return null;
      }
    },
    /**
     * Internal: give the view back if this run took it from the human.
     *
     * Only when the baseline space belonged to the human, and only when the agent is
     * still the one holding the view - if the human clicked somewhere else during
     * the run, that choice stands.
     */
    async __restoreFocus(baseline) {
      if (!baseline || baseline.owner !== "user") return null;
      try {
        const { spaces } = await call("spaces.list");
        const focused = spaces.find((space) => space.focused) ?? null;
        if (!focused || focused.id === baseline.id) return null;
        if (focused.owner !== "agent") return null;
        const target = spaces.find((space) => space.id === baseline.id) ?? null;
        if (!target || target.owner !== "user") return null;
        await call("spaces.focus", { spaceId: baseline.id });
        return baseline.id;
      } catch {
        return null;
      }
    },
    help() {
      log(renderHelp());
    }
  };
  Object.defineProperty(helpers, "__selectedSpaceId", {
    get: () => selectedSpaceId
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
function skillSummary() {
  return renderHelp();
}

// src/cli/run.js
async function runScript(code, helpers, { log = console.log } = {}) {
  const names = Object.keys(helpers);
  const values = names.map((name) => helpers[name]);
  const wrapped = `return (async () => {
${code}
})();`;
  let fn;
  try {
    fn = new Function(...names, wrapped);
  } catch (error) {
    throw new Error(`script did not compile: ${error.message}`);
  }
  const previousArgon = globalThis.aragon;
  globalThis.aragon = { ...helpers, helpers: skillSummary() };
  try {
    const result = await fn(...values);
    if (result !== void 0) {
      log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    }
    return result;
  } finally {
    globalThis.aragon = previousArgon;
  }
}

// src/cli/index.js
init_paths();
var __dirname2 = import_node_path6.default.dirname((0, import_node_url3.fileURLToPath)(__importMetaUrl));
var USAGE = `aragon-browser - drive the aragon nano browser from a script

Usage:
  aragon-browser [nodejs] [options]        read JavaScript from stdin and run it
  aragon-browser nodejs -e "<code>"        run inline code
  aragon-browser status                    runtime version and live spaces
  aragon-browser spaces                    list task spaces
  aragon-browser skill                     agent guide (helpers rendered from the schema)
  aragon-browser help-api                  the API surface only
  aragon-browser learn                     validate every installed site skill
  aragon-browser -h | --help               this text

Options:
  -e, --eval <code>      script source instead of stdin
  -s, --space <id|name>  select a task space before the script runs
      --keep-tabs        keep the tabs this script opened (default: close them)
      --runtime-file <p> coordinates file (default: %TEMP%\\aragon-browser\\runtime.json)
      --json             print the raw result object as JSON
`;
function parseArgs(argv) {
  const options = {
    command: null,
    evalCode: null,
    space: null,
    json: false,
    // Default: a script closes the tabs it opened. `--keep-tabs` (or the env var,
    // for a host that cannot pass flags) turns that off.
    keepTabs: import_node_process.default.env.ARAGON_KEEP_TABS === "1",
    runtimeFile: runtimeFilePath()
  };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.command = "help";
      continue;
    }
    if (arg === "-e" || arg === "--eval") {
      options.evalCode = argv[++index] ?? "";
      continue;
    }
    if (arg === "-s" || arg === "--space") {
      options.space = argv[++index] ?? null;
      continue;
    }
    if (arg === "--keep-tabs") {
      options.keepTabs = true;
      continue;
    }
    if (arg === "--runtime-file") {
      options.runtimeFile = import_node_path6.default.resolve(argv[++index] ?? "");
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--sdk-path") {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new AragonError(ERROR_CODES.INVALID_ARGUMENT, `unknown option ${arg}`);
    }
    rest.push(arg);
  }
  options.command = options.command ?? rest[0] ?? "nodejs";
  return options;
}
async function readStdin() {
  if (import_node_process.default.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of import_node_process.default.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
async function main() {
  const options = parseArgs(import_node_process.default.argv.slice(2));
  if (options.command === "help") {
    import_node_process.default.stdout.write(USAGE);
    return 0;
  }
  if (options.command === "skill") {
    import_node_process.default.stdout.write(import_node_fs6.default.readFileSync(import_node_path6.default.join(skillBodyDir(), "SKILL.md"), "utf8").replace(
      "<!-- HELP -->",
      renderHelp()
    ));
    return 0;
  }
  if (options.command === "help-api") {
    import_node_process.default.stdout.write(`${renderHelp()}
`);
    return 0;
  }
  if (options.command === "learn") {
    const { validateLearnings: validateLearnings2 } = await Promise.resolve().then(() => (init_validate(), validate_exports));
    const errors = await validateLearnings2();
    if (errors.length === 0) {
      import_node_process.default.stdout.write("all site skills valid\n");
      return 0;
    }
    import_node_process.default.stderr.write(`${errors.join("\n")}
`);
    return 1;
  }
  const client = new RuntimeClient({ runtimeFile: options.runtimeFile });
  const info = await client.connect();
  try {
    if (options.command === "status") {
      const version = await client.request("runtime.version");
      const { spaces } = await client.request("spaces.list");
      import_node_process.default.stdout.write(
        `${JSON.stringify({ runtime: { ...info, token: "\xABredacted\xBB" }, version, spaces }, null, 2)}
`
      );
      return 0;
    }
    if (options.command === "spaces") {
      const { spaces } = await client.request("spaces.list");
      import_node_process.default.stdout.write(`${JSON.stringify(spaces, null, 2)}
`);
      return 0;
    }
    if (options.command !== "nodejs") {
      throw new AragonError(
        ERROR_CODES.INVALID_ARGUMENT,
        `unknown command "${options.command}"; try --help`
      );
    }
    const source = options.evalCode ?? await readStdin();
    if (!source.trim()) {
      import_node_process.default.stderr.write("aragon-browser: no script on stdin (use -e for inline code)\n");
      return 2;
    }
    const helpers = createHelpers(client, {
      log: (line) => import_node_process.default.stdout.write(`${line}
`),
      logError: (line) => import_node_process.default.stderr.write(`${line}
`)
    });
    if (options.space !== null) {
      const space = await helpers.taskSpace(options.space);
      helpers.useTaskSpace(space.id);
    }
    const focusBaseline = await helpers.__focusBaseline();
    try {
      await runScript(source, helpers, {
        log: (line) => import_node_process.default.stdout.write(`${line}
`)
      });
    } finally {
      let swept = null;
      try {
        swept = await helpers.__sweepTabs({ keepTabs: options.keepTabs });
      } catch {
        swept = null;
      }
      const note = describeSweep(swept, { keepTabs: options.keepTabs });
      if (note) import_node_process.default.stderr.write(`${note}
`);
      await helpers.__restoreFocus(focusBaseline);
    }
    return 0;
  } finally {
    client.close();
  }
}
main().then((code) => import_node_process.default.exit(code ?? 0)).catch((error) => {
  const code = error?.error_code ?? "ARAGON_ERROR";
  import_node_process.default.stderr.write(`aragon-browser: ${code}: ${error?.message ?? error}
`);
  import_node_process.default.exit(1);
});
if (import_node_process.default.platform === "win32" && import_node_process.default.stdout.isTTY) {
  import_node_process.default.stderr.write(
    "[aragon-browser] note: if non-ASCII page text looks garbled, run `chcp 65001` first; the data itself is valid UTF-8.\n"
  );
}
