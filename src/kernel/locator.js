import { AragonError } from "../shared/protocol.js";

/**
 * Locator grammar, ported from ego-lite's element-resolver so an agent that has
 * learned those handles keeps working. Everything here is pure: parsing, and
 * building the JS snippets that do the actual matching. No CDP, no Electron, so
 * the whole grammar is unit-testable.
 *
 * Accepted target forms, in dispatch order:
 *   @12 | ref=12 | 12          ref into the snapshot registry
 *   loc=<core>                 prefix, stripped once, then parsed as core
 *   css:<sel> | css=<sel>      CSS selector (Playwright aliases)
 *   href:<path>                <a href> whose path+search+hash matches exactly
 *   text=<body>                unquoted: substring, case-insensitive
 *                              quoted  : exact, case-sensitive
 *   role:<role>[name="…"]      AX role + exact accessible name
 *   role:<role>[name*="…"]     AX role + name substring
 *   <css> >> nth=N             terminal index, N = -1 means last
 *   <css>:has-text("…")        terminal text pseudo, substring
 *   <css>:text-is("…")         terminal text pseudo, exact
 *   xpath=<expr>               XPath (handled before the locator grammar)
 */

/** Failure kinds: a wait loop retries `transient` and gives up on `permanent`. */
export class ElementResolutionError extends AragonError {
  constructor(message, kind, extra = {}) {
    super(
      kind === "transient"
        ? "ARAGON_ELEMENT_TRANSIENT"
        : "ARAGON_ELEMENT_PERMANENT",
      message,
    );
    this.name = "ElementResolutionError";
    this.kind = kind;
    if (extra.sessionId !== undefined) this.sessionId = extra.sessionId;
    if (extra.ref !== undefined) this.ref = extra.ref;
  }
}

export const ROLE_ALIASES = { listboxoption: "option", textfield: "textbox" };

export function normalizeRole(value) {
  const role = String(value || "").toLowerCase();
  // Own properties only: `ROLE_ALIASES[role]` would walk the prototype chain, so
  // `loc=role:constructor` produced the `Object` function as a role and then
  // matched nothing (and `describeLocator` printed native code).
  return Object.hasOwn(ROLE_ALIASES, role) ? ROLE_ALIASES[role] : role;
}

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** `@12`, `ref=12` and bare `12` are all refs; nothing else is. */
export function parseRefId(input) {
  const trimmed = String(input ?? "").trim();
  const candidates = [
    trimmed.startsWith("@") ? trimmed.slice(1) : null,
    trimmed.startsWith("ref=") ? trimmed.slice(4) : null,
    trimmed,
  ];
  for (const candidate of candidates) {
    // Refs start at 1, so "0" is not a ref: treating it as one produced a
    // "not found" that the resolver classifies as transient, which made waits and
    // action retries spin for the whole timeout on an impossible handle.
    if (candidate && /^[1-9]\d*$/.test(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// token scanning: a `>>` or a pseudo only counts when it is at top level
// ---------------------------------------------------------------------------

function scanTopLevel(value, token) {
  const positions = [];
  let quote;
  let escaped = false;
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === "(") parenDepth += 1;
    else if (character === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (
      bracketDepth === 0 &&
      parenDepth === 0 &&
      value.startsWith(token, index)
    ) {
      positions.push(index);
      index += token.length - 1;
    }
  }
  return positions;
}

function isTopLevelAt(value, position) {
  let quote;
  let escaped = false;
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let index = 0; index < position; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === "(") parenDepth += 1;
    else if (character === ")") parenDepth = Math.max(0, parenDepth - 1);
  }
  return !quote && bracketDepth === 0 && parenDepth === 0;
}

function matchingParen(value, open) {
  let quote;
  let escaped = false;
  let depth = 0;
  for (let index = open; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")" && --depth === 0) return index;
  }
  return -1;
}

/** Decode a CSS string literal, including hex escapes. */
function parseCssString(value) {
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value.length < 2) return { valid: false };
  let decoded = "";
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (character === quote) {
      return index === value.length - 1
        ? { valid: true, value: decoded }
        : { valid: false };
    }
    if (character === "\n" || character === "\r" || character === "\f") {
      return { valid: false };
    }
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    index += 1;
    if (index >= value.length) return { valid: false };
    if (value[index] === "\r" && value[index + 1] === "\n") index += 1;
    if (
      value[index] === "\n" ||
      value[index] === "\r" ||
      value[index] === "\f"
    ) {
      continue;
    }
    const hex = value.slice(index).match(/^[0-9a-fA-F]{1,6}/)?.[0];
    if (!hex) {
      decoded += value[index];
      continue;
    }
    index += hex.length - 1;
    const terminator = value[index + 1];
    if (terminator === "\r") index += value[index + 2] === "\n" ? 2 : 1;
    else if ("\n\f\t ".includes(terminator ?? "")) index += 1;
    const codePoint = Number.parseInt(hex, 16);
    decoded +=
      codePoint === 0 || codePoint > 0x10ffff
        ? "\uFFFD"
        : String.fromCodePoint(codePoint);
  }
  return { valid: false };
}

/** Quoted name values: `"…"` via JSON, `'…'` naively, otherwise verbatim. */
function parseLocatorName(raw) {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      const decoded = JSON.parse(trimmed);
      if (typeof decoded === "string") return decoded;
    } catch {
      // Fall through to the literal body.
    }
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// the grammar
// ---------------------------------------------------------------------------

function parseTerminalNth(value) {
  const separators = scanTopLevel(value, ">>");
  if (separators.length === 0) return undefined;
  if (separators.length !== 1) return { valid: false };
  const position = separators[0];
  const base = value.slice(0, position).trim();
  const tail = value.slice(position + 2).trim();
  const match = /^nth=(-?\d+)$/.exec(tail);
  if (!match) return { valid: false };
  const index = Number(match[1]);
  if (!Number.isSafeInteger(index) || index < -1) return { valid: false };
  if (!base) return { valid: false };
  return { valid: true, base, index };
}

function parseTerminalCssText(selector) {
  const pseudos = [
    { token: ":has-text(", mode: "substring" },
    { token: ":text-is(", mode: "exact" },
  ];
  for (let index = 0; index < selector.length; index += 1) {
    if (!isTopLevelAt(selector, index)) continue;
    const pseudo = pseudos.find(({ token }) => selector.startsWith(token, index));
    if (!pseudo) continue;
    const open = index + pseudo.token.length - 1;
    const close = matchingParen(selector, open);
    if (close === -1 || selector.slice(close + 1).trim()) continue;
    const base = selector.slice(0, index).trim();
    const argument = selector.slice(open + 1, close).trim();
    const string = parseCssString(argument);
    if (!string.valid) continue;
    if (!base || scanTopLevel(base, ",").length > 0) continue;
    return { selector: base, text: string.value, mode: pseudo.mode };
  }
  return null;
}

function isInvalidLocatorLike(value) {
  if (scanTopLevel(value, ">>").length > 0) return true;
  let quote;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (value.startsWith(":has-text(", index)) return true;
    if (value.startsWith(":text-is(", index)) return true;
  }
  return false;
}

function hasTopLevelTextPseudo(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (!isTopLevelAt(value, index)) continue;
    if (value.startsWith(":has-text(", index)) return true;
    if (value.startsWith(":text-is(", index)) return true;
  }
  return false;
}

function parseLocatorCore(value, raw, fromNth = false) {
  if (value.startsWith("css:") || value.startsWith("css=")) {
    const selector = value.slice(4);
    if (!selector) return null;
    // The css aliases accept the same terminal text pseudos as bare selectors.
    const cssText = parseTerminalCssText(selector.trim());
    if (cssText) {
      return {
        kind: "cssText",
        selector: cssText.selector,
        text: cssText.text,
        mode: cssText.mode,
        raw,
      };
    }
    if (hasTopLevelTextPseudo(selector)) return { valid: false };
    return { kind: "css", selector, raw };
  }
  if (value.startsWith("href:")) {
    const href = value.slice(5);
    return href ? { kind: "href", href, raw } : null;
  }
  if (value.startsWith("text=")) {
    const body = value.slice(5).trim();
    const quoted =
      (body.startsWith('"') && body.endsWith('"')) ||
      (body.startsWith("'") && body.endsWith("'"));
    const text = quoted ? parseLocatorName(body) : body;
    if (!text) return null;
    return {
      kind: "text",
      mode: quoted ? "exact" : "substring",
      text,
      raw,
    };
  }
  const roleMatch = /^role:([A-Za-z0-9_-]+)\[name(\*=|=)(.+)\]$/.exec(value);
  if (roleMatch) {
    return {
      kind: "role",
      role: normalizeRole(roleMatch[1]),
      name: parseLocatorName(roleMatch[3]),
      nameMode: roleMatch[2] === "*=" ? "substring" : "exact",
      raw,
    };
  }
  // A `role:` prefix that did not produce a valid role locator must not be
  // reinterpreted as CSS: `role:button` would then fail much later with a
  // confusing "invalid CSS selector" from the page.
  if (value.startsWith("role:")) return { valid: false };
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!fromNth) {
    const textPseudo = parseTerminalCssText(trimmed);
    if (textPseudo) {
      return {
        kind: "cssText",
        selector: textPseudo.selector,
        text: textPseudo.text,
        mode: textPseudo.mode,
        raw,
      };
    }
    // A text pseudo that is not terminal (or has a comma-separated base) is
    // malformed locator syntax, not a CSS selector the page would understand.
    if (hasTopLevelTextPseudo(trimmed)) return { valid: false };
  } else if (hasTopLevelTextPseudo(trimmed)) {
    return { valid: false };
  }
  return { kind: "css", selector: trimmed, raw };
}

/**
 * Parse a locator. Returns `null` when the input is a plain CSS selector (or
 * xpath=, which is handled earlier), `{valid:false}` when it looks like a
 * locator but is malformed, and a locator object otherwise.
 */
export function parseLocator(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  let value = raw;
  if (value.startsWith("loc=")) value = value.slice(4);

  const nth = parseTerminalNth(value);
  if (nth) {
    if (!nth.valid) return { valid: false };
    const locator = parseLocatorCore(nth.base, raw, true);
    if (!locator || locator.kind === "role" || locator.kind === "nth") {
      return { valid: false };
    }
    return { kind: "nth", locator, index: nth.index, raw };
  }
  return parseLocatorCore(value, raw, false);
}

const INVALID_LOCATOR_MESSAGE =
  'Expected loc=role:<role>[name="<exact name>"], ' +
  'loc=role:<role>[name*="<name part>"], loc=css:<selector>, loc=href:<path>, ' +
  "text=..., css=..., a terminal :has-text(...) or :text-is(...), or a terminal >> nth=N";

export function parseLocatorOrThrow(input) {
  const locator = parseLocator(input);
  if (locator && typeof locator.valid === "boolean") {
    throw new ElementResolutionError(
      `Invalid locator: ${String(input ?? "").trim()}. ${INVALID_LOCATOR_MESSAGE}`,
      "permanent",
    );
  }
  const value = String(input ?? "").trim();
  const looksLikeLocator =
    value.startsWith("loc=") ||
    value.startsWith("role:") ||
    value.startsWith("text=") ||
    value.startsWith("css=") ||
    value.startsWith("css:") ||
    value.startsWith("href:") ||
    // A `>>`, or a text pseudo that never closed properly: these are locator
    // syntax, so a failure to parse them is a caller mistake, not plain CSS.
    isInvalidLocatorLike(value.startsWith("loc=") ? value.slice(4) : value);
  if (!locator && looksLikeLocator) {
    throw new ElementResolutionError(
      `Invalid locator: ${value}. ${INVALID_LOCATOR_MESSAGE}`,
      "permanent",
    );
  }
  return locator;
}

/**
 * True for a plain CSS selector: not a ref, not xpath, and not a `loc=` / role /
 * href / text / nth form. An explicit `css:`/`css=` alias still counts as plain
 * CSS because that is exactly what it resolves to.
 */
export function isPlainCssSelector(input) {
  if (typeof input !== "string" || input.trim().length === 0) return false;
  if (parseRefId(input) !== null) return false;
  if (input.trim().startsWith("xpath=")) return false;
  let locator;
  try {
    locator = parseLocatorOrThrow(input);
  } catch {
    return false;
  }
  return locator === null || locator.kind === "css";
}

export function describeLocator(locator) {
  switch (locator?.kind) {
    case "css":
      return `css:${locator.selector}`;
    case "cssText":
      return `css:${locator.selector} ${locator.mode === "exact" ? ":text-is" : ":has-text"}(${JSON.stringify(locator.text)})`;
    case "text":
      return `text=${JSON.stringify(locator.text)}(${locator.mode})`;
    case "href":
      return `href:${locator.href}`;
    case "role":
      return `role:${locator.role}[name${locator.nameMode === "substring" ? "*" : ""}=${JSON.stringify(locator.name)}]`;
    case "nth":
      return `${describeLocator(locator.locator)} >> nth=${locator.index}`;
    case "xpath":
      return `xpath:${locator.selector}`;
    default:
      return "<unknown locator>";
  }
}

// ---------------------------------------------------------------------------
// page-side matchers, emitted as self-contained JS
// ---------------------------------------------------------------------------

/**
 * Shadow-piercing querySelectorAll. The page cannot interfere with this because
 * it is a local closure, not a global it could monkey-patch - but it does use
 * the page's own DOM prototypes, so a hostile page could still hook those. That
 * residual risk is documented in the README rather than papered over.
 */
export const SHADOW_QUERY_ALL = `
function __aragonQueryAll(root, selector) {
  const out = [];
  const visit = (node) => {
    let matches;
    try { matches = node.querySelectorAll(selector); } catch (error) { throw error; }
    for (let i = 0; i < matches.length; i += 1) out.push(matches[i]);
    const all = node.querySelectorAll('*');
    for (let i = 0; i < all.length; i += 1) if (all[i].shadowRoot) visit(all[i].shadowRoot);
  };
  visit(root);
  return out;
}`;

const TEXT_OF = `
function __aragonText(element) {
  const text = typeof element.innerText === 'string' ? element.innerText : (element.textContent || '');
  return String(text).replace(/[\\u200b\\u00ad]/g, '').replace(/\\s+/g, ' ').trim();
}`;

const IMMEDIATE_TEXT = `
function __aragonImmediateText(element) {
  const parts = new Set();
  for (const node of element.childNodes || []) {
    if (node.nodeType === 3) {
      const text = String(node.nodeValue || '').replace(/\\s+/g, ' ').trim();
      if (text) parts.add(text);
    }
  }
  const own = element.getAttribute && element.getAttribute('aria-label');
  if (own) parts.add(String(own).replace(/\\s+/g, ' ').trim());
  return [...parts];
}`;

const ACTIONABLE = `
function __aragonActionable(element) {
  if (!element || !element.isConnected) return { ok: false, blocker: 'element is detached from the DOM' };
  if (element.closest && element.closest('[hidden], [inert]')) {
    return { ok: false, blocker: 'element is hidden or inert' };
  }
  const view = element.ownerDocument && element.ownerDocument.defaultView;
  if (!view) return { ok: false, blocker: 'element has no browsing context' };
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return { ok: false, blocker: 'element has a zero-sized bounding box' };
  }
  const style = view.getComputedStyle(element);
  if (style.display === 'none') return { ok: false, blocker: 'element has display: none' };
  if (style.visibility === 'hidden') return { ok: false, blocker: 'element has visibility: hidden' };
  if (style.pointerEvents === 'none') return { ok: false, blocker: 'element has pointer-events: none' };
  if (element.disabled === true) return { ok: false, blocker: 'element is disabled' };
  return { ok: true };
}`;

function elementsExpression(locator) {
  switch (locator.kind) {
    case "css":
      return `__aragonQueryAll(document, ${JSON.stringify(locator.selector)})`;
    case "cssText": {
      const expected = JSON.stringify(locator.text);
      const compare =
        locator.mode === "exact"
          ? `__aragonImmediateText(element).some((value) => value === ${expected}) || (${expected} === '' && __aragonImmediateText(element).length === 0)`
          : `__aragonText(element).toLowerCase().includes(String(${expected}).toLowerCase())`;
      return `__aragonQueryAll(document, ${JSON.stringify(locator.selector)}).filter((element) => {
        if (!__aragonActionable(element).ok) return false;
        const tag = element.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return false;
        return ${compare};
      })`;
    }
    case "text": {
      const expected = JSON.stringify(normalizeText(locator.text));
      const compare =
        locator.mode === "exact"
          ? `__aragonImmediateText(element).some((value) => value === expected)`
          : `__aragonText(element).toLowerCase().includes(expected.toLowerCase())`;
      return `(() => {
        const expected = ${expected};
        const excluded = new Set(['HEAD','NOSCRIPT','SCRIPT','STYLE','TEMPLATE','TITLE']);
        const candidates = __aragonQueryAll(document, '*').filter((element) => {
          if (excluded.has(element.tagName)) return false;
          if (element.tagName === 'INPUT') {
            const type = String(element.getAttribute('type') || '').toLowerCase();
            return type === 'button' || type === 'submit' || type === 'text' || type === 'search';
          }
          return true;
        });
        const matches = candidates.filter((element) => {
          if (element.tagName === 'INPUT') {
            return String(element.value || '').replace(/\\s+/g, ' ').trim() === expected;
          }
          return ${compare};
        });
        const isDescendant = (node, ancestor) => {
          let current = node;
          while (current) {
            if (current === ancestor) return true;
            if (current.parentElement) { current = current.parentElement; continue; }
            const root = current.getRootNode && current.getRootNode();
            current = root && root.host ? root.host : null;
          }
          return false;
        };
        return matches.filter((element) => !matches.some((other) => other !== element && isDescendant(element, other)));
      })()`;
    }
    case "href": {
      const href = JSON.stringify(locator.href);
      return `__aragonQueryAll(document, 'a[href]').filter((element) => {
        try {
          const url = new URL(element.href, location.href);
          const path = url.pathname + url.search + url.hash;
          return path === ${href} || url.href === ${href};
        } catch (error) { return false; }
      })`;
    }
    case "nth":
      return `(() => {
        const values = Array.from(${elementsExpression(locator.locator)} || []);
        const index = ${locator.index} === -1 ? values.length - 1 : ${locator.index};
        return index >= 0 && index < values.length ? [values[index]] : [];
      })()`;
    case "role":
      // role locators are answered from the AX tree, not from the DOM.
      throw new Error("role locators are resolved through the accessibility tree");
    default:
      throw new Error(`unsupported locator kind: ${locator.kind}`);
  }
}

export function buildLocatorElementsJs(locator) {
  return `${SHADOW_QUERY_ALL}${TEXT_OF}${IMMEDIATE_TEXT}${ACTIONABLE}\nreturn (${elementsExpression(locator)});`;
}

export function buildLocatorCountJs(locator) {
  return `${SHADOW_QUERY_ALL}${TEXT_OF}${IMMEDIATE_TEXT}${ACTIONABLE}\nreturn (${elementsExpression(locator)} || []).length;`;
}

export function buildLocatorFindJs(locator) {
  return `${SHADOW_QUERY_ALL}${TEXT_OF}${IMMEDIATE_TEXT}${ACTIONABLE}\nreturn (${elementsExpression(locator)} || [])[0] || null;`;
}

export function buildLocatorRectJs(locator) {
  return `${SHADOW_QUERY_ALL}${TEXT_OF}${IMMEDIATE_TEXT}${ACTIONABLE}
const matches = ${elementsExpression(locator)} || [];
if (matches.length !== 1) return { error: 'Locator matched ' + matches.length + ' elements' };
const element = matches[0];
const rect = element.getBoundingClientRect();
return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };`;
}

export function buildXpathElementsJs(selector) {
  return `
const result = document.evaluate(${JSON.stringify(selector)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
return Array.from({ length: result.snapshotLength }, (_, index) => result.snapshotItem(index));`;
}

/** XPath needs three shapes: count (number), find (element) and all (array). */
export function buildXpathCountJs(selector) {
  return `
const result = document.evaluate(${JSON.stringify(selector)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
return result.snapshotLength;`;
}

export function buildXpathFindJs(selector) {
  return `
const result = document.evaluate(${JSON.stringify(selector)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
return result.snapshotLength > 0 ? result.snapshotItem(0) : null;`;
}

/**
 * Ambiguity is permanent, "not there yet" is transient. A wait loop retries
 * transient failures, so getting this pair backwards either makes waits hang
 * forever (a missing element classified permanent) or makes them spin on a
 * genuinely ambiguous selector.
 */
export function classifyMatchCount(message) {
  const match = /matched (\d+)/.exec(String(message ?? ""));
  const count = match ? Number(match[1]) : 0;
  return count > 1 ? "permanent" : "transient";
}
