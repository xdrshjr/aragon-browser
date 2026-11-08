import { setTimeout as delay } from "node:timers/promises";
import { AragonError, ERROR_CODES } from "../shared/protocol.js";
import { ROOT_SESSION } from "./cdp-channel.js";

const RECT_SCRIPT = `function () {
  const r = this.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}`;

/**
 * Real-pointer actions.
 *
 * This is the second half of the "engine boundary" work: an agent that clicks by
 * dispatching a synthetic DOM event is detected by most modern sites, and a
 * click on a node inside a cross-process iframe lands in the wrong place if you
 * forget the frame offsets. So every action here:
 *
 *   1. resolves the ref in the session that owns the node,
 *   2. scrolls the node into view in that same session,
 *   3. measures it with `getBoundingClientRect` (viewport space, which is what
 *      `Input.dispatchMouseEvent` expects),
 *   4. adds the accumulated frame offsets up to the root viewport,
 *   5. dispatches a trusted mouse/key sequence on the ROOT session.
 */
export async function measureRect(channel, sessionId, backendNodeId) {
  const resolved = await channel.sendOptional(
    "DOM.resolveNode",
    { backendNodeId },
    sessionId,
  );
  if (resolved?.object?.objectId) {
    const measured = await channel.sendOptional(
      "Runtime.callFunctionOn",
      {
        objectId: resolved.object.objectId,
        functionDeclaration: RECT_SCRIPT,
        returnByValue: true,
      },
      sessionId,
    );
    const rect = measured?.result?.value;
    if (rect && Number.isFinite(rect.x)) return rect;
  }
  // Fall back to the box model; content quad origin is the node's top-left.
  await channel.ensureDom(sessionId);
  const box = await channel.sendOptional(
    "DOM.getBoxModel",
    { backendNodeId },
    sessionId,
  );
  const content = box?.model?.content;
  if (!Array.isArray(content) || content.length < 8) return null;
  const xs = [content[0], content[2], content[4], content[6]];
  const ys = [content[1], content[3], content[5], content[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Accumulated origin of a session's viewport inside the root viewport. */
export async function sessionOffset(channel, sessionId) {
  if (sessionId === ROOT_SESSION) return { x: 0, y: 0 };
  const entry = channel.sessions.get(sessionId);
  if (!entry || !entry.parent) return { x: 0, y: 0 };
  const ownerId = await channel.frameOwnerBackendId(sessionId);
  let local = null;
  if (ownerId !== null) local = await measureRect(channel, entry.parent, ownerId);
  const parentOffset = await sessionOffset(channel, entry.parent);
  if (!local) return parentOffset;
  return { x: parentOffset.x + local.x, y: parentOffset.y + local.y };
}

export async function pointFor(channel, entry, { scroll = true } = {}) {
  const sessionId = entry.sessionId ?? ROOT_SESSION;
  if (scroll) {
    await channel.sendOptional(
      "DOM.scrollIntoViewIfNeeded",
      { backendNodeId: entry.backendNodeId },
      sessionId,
    );
  }
  let rect = await measureRect(channel, sessionId, entry.backendNodeId);
  if (!rect) {
    throw staleRef(entry);
  }
  if (rect.width === 0 || rect.height === 0) {
    // Zero-size nodes still accept clicks at their origin, but scrolling once
    // more is a cheap way to recover from a collapse animation.
    await channel.sendOptional(
      "DOM.scrollIntoViewIfNeeded",
      { backendNodeId: entry.backendNodeId },
      sessionId,
    );
    rect = await measureRect(channel, sessionId, entry.backendNodeId) ?? rect;
  }
  const offset = await sessionOffset(channel, sessionId);
  return {
    x: Math.round(offset.x + rect.x + Math.max(rect.width, 1) / 2),
    y: Math.round(offset.y + rect.y + Math.max(rect.height, 1) / 2),
    rect,
  };
}

export async function clickAt(channel, { x, y }, options = {}) {
  const button = options.button ?? "left";
  const clickCount = Number.isInteger(options.clickCount) ? options.clickCount : 1;
  const buttons = button === "left" ? 1 : button === "right" ? 2 : 4;
  await channel.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    buttons: 0,
  });
  await delay(8);
  await channel.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button,
    buttons,
    clickCount,
  });
  await delay(options.holdMs ?? 12);
  await channel.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button,
    buttons: 0,
    clickCount,
  });
  return { x, y, button, clickCount };
}

export async function clickRef(channel, entry, options = {}) {
  const point = await pointFor(channel, entry, options);
  return clickAt(channel, point, options);
}

export async function hoverRef(channel, entry) {
  const point = await pointFor(channel, entry);
  await channel.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
    buttons: 0,
  });
  return point;
}

const KEY_TABLE = {
  Enter: { code: "Enter", key: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", key: "Tab", keyCode: 9 },
  Escape: { code: "Escape", key: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", key: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", key: "Delete", keyCode: 46 },
  ArrowUp: { code: "ArrowUp", key: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", key: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", key: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", key: "ArrowRight", keyCode: 39 },
  " ": { code: "Space", key: " ", keyCode: 32, text: " " },
};

export async function pressKey(channel, key, { sessionId = ROOT_SESSION } = {}) {
  const spec = KEY_TABLE[key] ?? KEY_TABLE[key?.length === 1 ? key : ""];
  const printable = typeof key === "string" && [...key].length === 1 && !spec;
  const resolved = spec ?? {
    code: `Key${String(key).toUpperCase()}`,
    key,
    keyCode: String(key).toUpperCase().charCodeAt(0),
    // A single character must carry `text`, otherwise Chromium dispatches a raw
    // keydown and inserts nothing: `press("a")` reported success and typed air.
    ...(printable ? { text: key } : {}),
  };
  const base = {
    key: resolved.key,
    code: resolved.code,
    windowsVirtualKeyCode: resolved.keyCode,
    nativeVirtualKeyCode: resolved.keyCode,
  };
  await channel.send(
    "Input.dispatchKeyEvent",
    { type: resolved.text ? "keyDown" : "rawKeyDown", ...base, ...(resolved.text ? { text: resolved.text, unmodifiedText: resolved.text } : {}) },
    sessionId,
  );
  await channel.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sessionId);
  return { key: resolved.key };
}

export async function selectAll(channel, sessionId = ROOT_SESSION) {
  const base = {
    key: "a",
    code: "KeyA",
    modifiers: 2,
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
  };
  await channel.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base }, sessionId);
  await channel.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sessionId);
}

export async function fillRef(channel, entry, text, options = {}) {
  const sessionId = entry.sessionId ?? ROOT_SESSION;
  await channel.sendOptional(
    "DOM.scrollIntoViewIfNeeded",
    { backendNodeId: entry.backendNodeId },
    sessionId,
  );
  const focused = await channel.sendOptional(
    "DOM.focus",
    { backendNodeId: entry.backendNodeId },
    sessionId,
  );
  if (focused === null && options.allowJsFocus === false) {
    throw new AragonError(
      ERROR_CODES.OPERATION_FAILED,
      "the node could not take focus, so typing would go to the wrong place",
    );
  }
  const value = String(text ?? "");
  // Replace instead of append: real users select-all before retyping, and this
  // keeps React/Vue controlled inputs happy because insertText fires
  // beforeinput/input like a keyboard would.
  await selectAll(channel);
  if (value.length === 0) {
    await pressKey(channel, "Backspace");
    return { mode: "clear" };
  }
  if (options.delayMs) {
    for (const char of value) {
      await channel.send("Input.insertText", { text: char });
      await delay(options.delayMs);
    }
  } else {
    await channel.send("Input.insertText", { text: value });
  }
  if (options.submit) await pressKey(channel, "Enter");
  return { mode: "insertText", length: value.length };
}

export async function typeText(channel, text, options = {}) {
  const delayMs = Number.isInteger(options.delayMs) ? options.delayMs : 12;
  for (const char of String(text ?? "")) {
    await channel.send("Input.insertText", { text: char });
    await delay(delayMs);
  }
}

export async function scrollPage(channel, { dx = 0, dy = 600, x, y } = {}) {
  const point = { x: x ?? 200, y: y ?? 200 };
  await channel.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: point.x,
    y: point.y,
    deltaX: dx,
    deltaY: dy,
    button: "none",
    buttons: 0,
  });
}

function staleRef(entry) {
  return new AragonError(
    ERROR_CODES.REF_STALE,
    `ref @${entry.ref} no longer resolves to a visible node; take a fresh snapshot`,
  );
}
