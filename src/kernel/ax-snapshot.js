/**
 * AX snapshot builder.
 *
 * This is the part of aragon-browser that stands in for ego lite's
 * "customization inside the browser engine". It is a pure function over raw
 * CDP `Accessibility.getFullAXTree` payloads, so it is unit-testable without a
 * browser, and it is where the engine-level tricks live:
 *
 *   1. frame flattening - cross-origin/out-of-process iframes are spliced into
 *      the parent tree at the exact `<iframe>` element, using
 *      `DOM.getFrameOwner` backend ids instead of guessing by URL or title.
 *   2. ref stamping    - one stable `@N` per actionable node, keyed by
 *      (session, backendNodeId) inside a document loader epoch.
 *   3. pruning         - presentation-only nodes collapse, static text merges
 *      into its parent, so a page costs tokens proportional to what it does,
 *      not to how many divs it has.
 */

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "disclosure triangle",
  "gridcell",
  "link",
  "listbox",
  "listbox option",
  "menu",
  "menu item",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "text area",
  "treeitem",
]);

// Roles that carry no information of their own; their children are hoisted.
const TRANSPARENT_ROLES = new Set([
  "none",
  "presentation",
  "generic",
  "InlineTextBox",
  "LineBreak",
  "StaticTextGroup",
]);

// High-volume text roles: kept (they are how an agent reads) but merged.
const TEXT_ROLES = new Set(["StaticText", "text", "paragraph"]);

const STRUCTURAL_ROLES = new Set([
  "RootWebArea",
  "WebArea",
  "document",
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "search",
  "form",
  "region",
  "article",
  "list",
  "listitem",
  "table",
  "row",
  "columnheader",
  "rowheader",
  "heading",
  "dialog",
  "alertdialog",
  "alert",
  "status",
  "toolbar",
  "tablist",
  "menu",
  "tree",
  "grid",
  "figure",
  "blockquote",
  "separator",
]);

// Containers that are never independently actionable: giving them a ref would
// hand the agent a handle it cannot use.
const NO_REF_ROLES = new Set([
  'RootWebArea',
  'WebArea',
  'document',
  'Iframe',
  'form',
  'region',
  'group',
]);

const MAX_NAME_LENGTH = 160;
const MAX_TEXT_LENGTH = 200;
const DEFAULT_MAX_DEPTH = 40;

function value(node, field) {
  const entry = node?.[field];
  if (!entry || typeof entry !== "object") return undefined;
  return entry.value;
}

function propertyMap(node) {
  const map = new Map();
  const list = Array.isArray(node?.properties) ? node.properties : [];
  for (const entry of list) {
    if (!entry || typeof entry.name !== "string") continue;
    // Only the *value*. Substituting `entry.value.type` when a property has no
    // value printed a schema type name as if it were state, e.g.
    // `[focused=booleanOrUndefined]`.
    map.set(entry.name, entry.value?.value);
  }
  return map;
}

/**
 * Quote page-controlled text for the snapshot line.
 *
 * The snapshot text *is* the agent's interface, so a page must never be able to
 * forge its structure: quotes and newlines are escaped, and a ref-shaped token
 * inside a name (`@12`) is escaped too, so the only `@N` on a line is the real one.
 */
function quoted(text) {
  return JSON.stringify(String(text)).replace(/@(?=\d)/g, "\\@");
}

function clip(text, max) {
  if (typeof text !== "string") return "";
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

export function normalizeRole(node) {
  const role = value(node, "role");
  if (typeof role !== "string" || role.length === 0) return "";
  return role;
}

function isIgnoredButUseful(node) {
  // CDP marks nodes `ignored` when they are not exposed. Focused/editable
  // nodes are sometimes ignored in the AX tree yet still clickable, so we
  // rescue nodes that carry a backend id and an actionable role.
  if (!node.ignored) return false;
  const role = normalizeRole(node);
  return INTERACTIVE_ROLES.has(role);
}

function isInteractive(node, props) {
  const role = normalizeRole(node);
  if (INTERACTIVE_ROLES.has(role)) return true;
  if (props.get("focusable") === true || props.get("focused") === true) return true;
  if (props.get("editable") === "richtext" || props.get("editable") === "plaintext") {
    return true;
  }
  return false;
}

function stateSuffix(props) {
  const bits = [];
  const push = (label, key, expected) => {
    const raw = props.get(key);
    if (raw === undefined || raw === null) return;
    if (expected !== undefined) {
      if (raw === expected) bits.push(label);
      return;
    }
    if (raw === true) bits.push(label);
    else if (raw !== false) bits.push(`${label}=${raw}`);
  };
  push("disabled", "disabled");
  push("required", "required");
  push("checked", "checked");
  push("mixed", "mixed");
  push("selected", "selected");
  push("expanded", "expanded");
  push("readonly", "readonly");
  push("invalid", "invalid");
  push("multiline", "multiline");
  push("level", "level");
  push("focused", "focused");
  return bits.length ? ` [${bits.join(" ")}]` : "";
}

/**
 * @param {object} input
 * @param {Array<{sessionId:string, frameId:string, parentSessionId:string|null,
 *   ownerBackendNodeId:number|null, loaderId:string|null,
 *   axNodes:Array<object>, url?:string}>} input.frames
 * @param {{maxDepth?:number, interactiveOnly?:boolean}} [input.options]
 */
export function buildSnapshot(input, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth)
    ? options.maxDepth
    : DEFAULT_MAX_DEPTH;
  const interactiveOnly = options.interactiveOnly === true;

  const frames = Array.isArray(input?.frames) ? input.frames.filter(Boolean) : [];
  if (frames.length === 0) {
    return { text: "(empty snapshot)", nodes: [], frameCount: 0 };
  }

  const bySession = new Map();
  for (const frame of frames) {
    const nodes = Array.isArray(frame.axNodes) ? frame.axNodes : [];
    const map = new Map();
    for (const node of nodes) {
      if (node && typeof node.nodeId === "string") map.set(node.nodeId, node);
    }
    bySession.set(frame.sessionId, {
      frame,
      nodes: map,
      roots: nodes.filter((node) => node && !node.parentId),
    });
  }

  // frame spliced at (parentSessionId, ownerBackendNodeId)
  const childByOwner = new Map();
  for (const frame of frames) {
    if (!hasParentFrame(frame)) continue;
    if (frame.ownerBackendNodeId === null || frame.ownerBackendNodeId === undefined) continue;
    childByOwner.set(
      `${frame.parentSessionId}:${frame.ownerBackendNodeId}`,
      frame.sessionId,
    );
  }

  const rootSessionId = pickRootSession(frames);
  const body = bySession.get(rootSessionId);
  if (!body) return { text: "(empty snapshot)", nodes: [], frameCount: frames.length };

  const nodes = [];
  const lines = [];
  const emitted = new Set();
  const refCounter = { next: 1 };

  const emitRoots = (sessionId, depth) => {
    const session = bySession.get(sessionId);
    if (!session) return;
    const roots = session.roots.length
      ? session.roots
      : [...session.nodes.values()].filter((node) => !node.parentId);
    for (const root of roots) {
      walk(sessionId, root, depth);
    }
  };

  /**
   * A child frame's own RootWebArea would only repeat the `frame "..."` line we
   * already printed, so hoist its children instead and save the tokens.
   */
  const emitChildFrameContent = (sessionId, depth) => {
    const session = bySession.get(sessionId);
    if (!session) return;
    const roots = session.roots.length
      ? session.roots
      : [...session.nodes.values()].filter((node) => !node.parentId);
    for (const rootNode of roots) {
      const childIds = Array.isArray(rootNode.childIds) ? rootNode.childIds : [];
      for (const childId of childIds) {
        const child = session.nodes.get(childId);
        if (child) walk(sessionId, child, depth);
      }
    }
  };

  const walk = (sessionId, node, depth, parentName = '', insideInteractive = false) => {
    if (!node || depth > maxDepth) return;
    const session = bySession.get(sessionId);
    if (!session) return;
    const role = normalizeRole(node);
    const props = propertyMap(node);
    const name = clip(value(node, "name"), MAX_NAME_LENGTH);
    const description = clip(value(node, "description"), MAX_NAME_LENGTH);
    const nodeValue = clip(value(node, "value"), MAX_TEXT_LENGTH);
    const backendId = node.backendDOMNodeId;

    // Splice a nested frame in at its <iframe> element.
    if (backendId !== undefined && backendId !== null) {
      const childSessionId = childByOwner.get(`${sessionId}:${backendId}`);
      if (childSessionId && !emitted.has(`frame:${childSessionId}`)) {
        emitted.add(`frame:${childSessionId}`);
        const child = bySession.get(childSessionId);
        lines.push(
          `${indent(depth)}${name ? `frame "${name}"` : "frame"}${child?.frame?.url ? ` url=${child.frame.url}` : ""}`,
        );
        emitChildFrameContent(childSessionId, depth + 1);
        return;
      }
    }

    const interactive = isInteractive(node, props);
    // A focusable element with a transparent role (generic) is still a control;
    // collapsing it would delete the only handle an agent has on it.
    const transparent = !interactive && (TRANSPARENT_ROLES.has(role) || role === "");
    const isText = TEXT_ROLES.has(role);
    const structural = STRUCTURAL_ROLES.has(role) || isText;
    const ignored = node.ignored === true && !isIgnoredButUseful(node);

    // A StaticText child that just repeats its parent's accessible name is a
    // token tax with no information in it ("heading 'Sign in'" + "Sign in").
    const repeatsParent = isText && parentName.length > 0 && name === parentName;
    // A generic wrapper inside an already-ref'd control is not separately
    // actionable; keeping it would hand the agent two refs for one thing.
    const wrapperInsideControl =
      insideInteractive && (role === "generic" || role === "InlineTextBox");

    const shouldEmit =
      !transparent &&
      !ignored &&
      !repeatsParent &&
      !wrapperInsideControl &&
      (interactive || structural || (!interactiveOnly && name.length > 0));

    if (shouldEmit) {
      let ref = null;
      const refEligible =
        interactive &&
        !NO_REF_ROLES.has(role) &&
        backendId !== undefined &&
        backendId !== null;
      if (refEligible) {
        const descriptor = {
          sessionId,
          backendNodeId: backendId,
          frameId: session.frameId,
          loaderId: session.frame.loaderId ?? null,
          role,
          name,
        };
        ref =
          typeof options.assignRef === "function"
            ? options.assignRef(descriptor)
            : refCounter.next++;
        nodes.push({ ...descriptor, ref });
      }
      const parts = [];
      parts.push(role ? role : "node");
      if (name) parts.push(quoted(name));
      if (nodeValue) parts.push(`value=${quoted(nodeValue)}`);
      if (description) parts.push(`desc=${quoted(description)}`);
      const states = stateSuffix(props);
      const url = props.get("url");
      let line = `${indent(depth)}${parts.join(" ")}${states}`;
      if (typeof url === "string" && url.length > 0 && url.length < 200) {
        // Keep the readable `url=https://...` form, but never let a hostile URL
        // inject whitespace or quotes into the line.
        line += ` url=${/["\s]/.test(url) ? quoted(url) : url}`;
      }
      if (ref !== null) {
        line += ` @${ref}`;
      }
      lines.push(line);
      emitted.add(String(node.nodeId));
    }

    const childIds = Array.isArray(node.childIds) ? node.childIds : [];
    const nextDepth =
      shouldEmit || transparent ? depth + (shouldEmit ? 1 : 0) : depth;
    const nextParentName = shouldEmit ? name : parentName;
    const nextInsideInteractive = insideInteractive || (shouldEmit && interactive);
    for (const childId of childIds) {
      const child = session.nodes.get(childId);
      if (!child) continue;
      walk(sessionId, child, nextDepth, nextParentName, nextInsideInteractive);
    }
  };

  emitRoots(rootSessionId, 0);

  // A frame whose <iframe> owner could not be resolved must still reach the
  // agent: dropping it silently is how an agent "sees" a login form that is not
  // there. Append it, and report it as unresolved.
  const unresolvedFrames = [];
  for (const frame of frames) {
    if (frame.sessionId === rootSessionId || !hasParentFrame(frame)) continue;
    if (emitted.has(`frame:${frame.sessionId}`)) continue;
    unresolvedFrames.push(frame.sessionId);
    lines.push(`frame url=${frame.url ?? "(unknown)"}`);
    emitChildFrameContent(frame.sessionId, 1);
  }

  return {
    text: lines.join("\n") || "(empty snapshot)",
    nodes,
    frameCount: frames.length,
    unresolvedFrames,
  };
}

function hasParentFrame(frame) {
  // "" is a real value that shows up when a session key is mangled; treat it as
  // absent so a child frame can never disappear without being reported.
  const parent = frame?.parentSessionId;
  return parent !== null && parent !== undefined && parent !== "";
}

function indent(depth) {
  return "  ".repeat(Math.max(0, depth));
}

/**
 * The root frame is the one nobody else declares as their child. Sessions
 * without a parent link are candidates; a page that fails to click together
 * still produces a snapshot from whichever session looks most like a document.
 */
function pickRootSession(frames) {
  const childSessions = new Set();
  for (const frame of frames) {
    if (frame.parentSessionId) childSessions.add(frame.sessionId);
  }
  const roots = frames.filter((frame) => !childSessions.has(frame.sessionId));
  const candidate = roots.find((frame) => frame.parentSessionId === null) ?? roots[0];
  return (candidate ?? frames[0]).sessionId;
}
