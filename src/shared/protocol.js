import os from "node:os";
import path from "node:path";

/**
 * Stable error codes. The names follow the ego lite native-binding contract
 * (docs/native-bindings-api.md in the ego-lite checkout) so an agent that has
 * learned the original vocabulary keeps working against aragon-browser.
 * `ARAGON_` codes are our own extensions.
 */
export const ERROR_CODES = {
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
  NO_SUCH_METHOD: "ARAGON_NO_SUCH_METHOD",
};

export class AragonError extends Error {
  constructor(code, message, cause) {
    super(message ?? code);
    this.name = "AragonError";
    this.error_code = code;
    if (cause) this.cause = cause;
  }
}

export function invalidArgument(message) {
  return new AragonError(ERROR_CODES.INVALID_ARGUMENT, message);
}

export function operationFailed(message, cause) {
  return new AragonError(ERROR_CODES.OPERATION_FAILED, message, cause);
}

/**
 * Where the browser publishes its transport coordinates (port + token).
 * Both the Electron app and the CLI must resolve this identically, so it lives
 * in the shared layer. ARAGON_RUNTIME_FILE lets a test pin an isolated runtime.
 */
export function runtimeFilePath() {
  const override = process.env.ARAGON_RUNTIME_FILE;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(os.tmpdir(), "aragon-browser", "runtime.json");
}

export function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidArgument(`${name} must be a non-empty string`);
  }
  return value;
}

export function requireSpaceId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw invalidArgument("spaceId must be a positive integer");
  }
  return id;
}

export function optionalObject(value, name) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw invalidArgument(`${name} must be an object`);
  }
  return value;
}
