import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AragonError, ERROR_CODES } from "../shared/protocol.js";
import { pointFor } from "./actions.js";

/**
 * File upload, clipboard and drag: the three "not a click" interactions an agent
 * still needs, each of which fails in a confusing way if done the obvious way.
 */

/**
 * Attach files to a file input.
 *
 * `input.click()` on a file input does nothing useful for an agent (there is no
 * native picker to answer), so this uses the DOM domain to set the files
 * directly. Paths are resolved and checked first: silently uploading nothing
 * because the path was wrong is worse than failing.
 */
export async function setFiles(channel, entry, files) {
  const list = Array.isArray(files) ? files : [files];
  if (list.length === 0) {
    throw new AragonError(ERROR_CODES.INVALID_ARGUMENT, "setFiles needs at least one path");
  }
  const resolved = [];
  for (const candidate of list) {
    const absolute = path.resolve(String(candidate));
    let stats;
    try {
      stats = fs.statSync(absolute);
    } catch {
      throw new AragonError(
        ERROR_CODES.INVALID_ARGUMENT,
        `file does not exist: ${absolute}`,
      );
    }
    if (!stats.isFile()) {
      throw new AragonError(ERROR_CODES.INVALID_ARGUMENT, `not a file: ${absolute}`);
    }
    resolved.push(absolute);
  }
  await channel.ensureDom(entry.sessionId);
  try {
    await channel.send(
      "DOM.setFileInputFiles",
      { files: resolved, backendNodeId: entry.backendNodeId },
      entry.sessionId,
    );
  } catch (error) {
    throw new AragonError(
      ERROR_CODES.OPERATION_FAILED,
      `could not attach files (is the target an <input type="file">?): ${error?.message ?? error}`,
    );
  }
  // Give the page's change handler a turn before the caller asserts on it.
  await delay(50);
  return { attached: resolved, sessionId: entry.sessionId };
}

/**
 * Clipboard access.
 *
 * Writing goes through the page's own Clipboard API so the content lands in the
 * real system clipboard (that is what a paste in another app will see). Reading
 * needs the clipboard-read permission, which the space grants on demand.
 */
export async function writeClipboard(channel, text, sessionId) {
  const value = String(text ?? "");
  const result = await channel.sendOptional(
    "Runtime.evaluate",
    {
      expression: `navigator.clipboard.writeText(${JSON.stringify(value)}).then(() => true).catch((error) => String(error))`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
    sessionId,
  );
  const outcome = result?.result?.value;
  if (outcome !== true) {
    throw new AragonError(
      ERROR_CODES.OPERATION_FAILED,
      `clipboard write failed: ${outcome ?? "no result"}`,
    );
  }
  return { written: value.length };
}

export async function readClipboard(channel, sessionId) {
  const result = await channel.sendOptional(
    "Runtime.evaluate",
    {
      expression: `navigator.clipboard.readText().then((text) => text).catch((error) => 'ERROR:' + String(error))`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
    sessionId,
  );
  const value = result?.result?.value;
  if (typeof value !== "string" || value.startsWith("ERROR:")) {
    throw new AragonError(
      ERROR_CODES.OPERATION_FAILED,
      `clipboard read failed: ${value ?? "no result"}`,
    );
  }
  return { text: value };
}

/**
 * Drag from one resolved target to another with real pointer events.
 *
 * A single mouseMoved would be treated as a teleport: most drag implementations
 * need intermediate moves to arm the drag, so this walks the line in steps.
 */
export async function dragBetween(channel, fromEntry, toEntry, options = {}) {
  const steps = Number.isInteger(options.steps) ? options.steps : 8;
  const start = await pointFor(channel, fromEntry);
  const end = await pointFor(channel, toEntry);
  await channel.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: start.x,
    y: start.y,
    button: "none",
    buttons: 0,
  });
  await delay(10);
  await channel.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start.x,
    y: start.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  // The browser's pointer state is global: if a step throws (frame torn down by a
  // drag-triggered navigation, channel gone) the release must still be attempted,
  // or every later click lands with a button still held down.
  const release = () =>
    channel
      .send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: end.x,
        y: end.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      })
      .catch(() => {});
  try {
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      await channel.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.round(start.x + (end.x - start.x) * ratio),
        y: Math.round(start.y + (end.y - start.y) * ratio),
        button: "left",
        buttons: 1,
      });
      await delay(options.stepDelayMs ?? 12);
    }
  } finally {
    await release();
  }
  return { from: start, to: end, steps };
}

/** Double click, select-all and right click, expressed on top of the same path. */
export async function doubleClickAt(channel, point) {
  const { clickAt } = await import("./actions.js");
  await clickAt(channel, point, { clickCount: 1 });
  await delay(40);
  return clickAt(channel, point, { clickCount: 2 });
}

export async function rightClickAt(channel, point) {
  const { clickAt } = await import("./actions.js");
  return clickAt(channel, point, { button: "right" });
}
