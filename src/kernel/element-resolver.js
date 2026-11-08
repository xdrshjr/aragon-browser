import {
  ElementResolutionError,
  buildLocatorCountJs,
  buildLocatorFindJs,
  buildXpathCountJs,
  buildXpathFindJs,
  classifyMatchCount,
  describeLocator,
  normalizeRole,
  normalizeText,
  parseLocatorOrThrow,
  parseRefId,
} from "./locator.js";
import { ROOT_SESSION } from "./cdp-channel.js";
import { AragonError, ERROR_CODES } from "../shared/protocol.js";

/** AX name matching: exact by default, substring for `name*=`. */
function roleNameMatches(actual, expected, mode = "exact") {
  if (mode === "exact") return actual === expected;
  return normalizeText(actual)
    .toLowerCase()
    .includes(normalizeText(expected).toLowerCase());
}

function axString(entry) {
  const value = entry?.value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Session-aware element resolution.
 *
 * This is the runtime half of the locator grammar: it decides *which* CDP
 * session owns a match (the root document or one of the attached iframes), how
 * many elements a locator hits, and whether the failure deserves a retry.
 */
export class ElementResolver {
  constructor(channel) {
    this.channel = channel;
  }

  async #contexts() {
    await this.channel.attach();
    await this.channel.settleChildSessions();
    return this.channel.sessionEntries().filter((entry) => {
      if (entry.type === "page" || entry.type === "iframe") return true;
      // The root session is typed "page"; anything else unknown is skipped.
      return entry.sessionId === ROOT_SESSION;
    });
  }

  async #evaluate(sessionId, body, { returnByValue = true } = {}) {
    const expression = `(function(){\n${body}\n})()`;
    const result = await this.channel.send(
      "Runtime.evaluate",
      {
        expression,
        returnByValue,
        awaitPromise: true,
        // Escape the page's CSP the same way devtools does, otherwise injected
        // locator code is blocked on pages with a strict script-src.
        allowUnsafeEvalBlockedByCSP: true,
      },
      sessionId,
    );
    const exception = result?.exceptionDetails;
    if (exception) {
      const text =
        exception.exception?.description ?? exception.text ?? "evaluation error";
      // A DOM SyntaxError means the selector itself is wrong: never retry that.
      if (/SyntaxError|not a valid selector|Failed to execute/.test(String(text))) {
        throw new ElementResolutionError(
          `Invalid selector: ${String(text).split("\n")[0]}`,
          "permanent",
          { sessionId },
        );
      }
      throw new ElementResolutionError(
        `Locator evaluation failed: ${String(text).split("\n")[0]}`,
        "transient",
        { sessionId },
      );
    }
    return result?.result;
  }

  /**
   * Resolve any accepted target into `{sessionId, backendNodeId}` the actions can
   * use. Failures are ElementResolutionError with an honest `kind`.
   */
  async resolve(target, { registry, purpose = "target" } = {}) {
    const refId = parseRefId(target);
    if (refId !== null) return this.#resolveRef(refId, registry, purpose);

    const raw = String(target ?? "").trim();
    if (!raw) {
      throw new ElementResolutionError(`${purpose} is empty`, "permanent");
    }
    if (raw.startsWith("xpath=")) {
      return this.#resolveDomLocator(
        { kind: "xpath", selector: raw.slice(6), raw },
        purpose,
      );
    }
    const locator = parseLocatorOrThrow(raw);
    if (!locator) {
      throw new ElementResolutionError(`${purpose} is empty`, "permanent");
    }
    if (locator.kind === "role") return this.#resolveRole(locator, purpose);
    return this.#resolveDomLocator(locator, purpose);
  }

  #resolveRef(refId, registry, purpose) {
    if (!registry) {
      throw new ElementResolutionError(
        `${purpose}: this space has no snapshot registry`,
        "permanent",
      );
    }
    let entry;
    try {
      entry = registry.resolve(refId, this.channel.loaderIds());
    } catch (error) {
      // Registry codes stay intact; the kind is what wait loops consult.
      const kind = error?.error_code === ERROR_CODES.REF_STALE ? "permanent" : "transient";
      throw new ElementResolutionError(error.message, kind, { ref: refId });
    }
    if (entry.backendNodeId === undefined || entry.backendNodeId === null) {
      throw new ElementResolutionError(
        `ref @${refId} has no backend node; take a fresh snapshot`,
        "permanent",
        { ref: refId },
      );
    }
    return {
      sessionId: entry.sessionId ?? ROOT_SESSION,
      backendNodeId: entry.backendNodeId,
      ref: Number(refId),
      role: entry.role,
      name: entry.name,
    };
  }

  async #resolveDomLocator(locator, purpose) {
    const contexts = await this.#contexts();
    const isXpath = locator.kind === "xpath";
    const counter = isXpath
      ? buildXpathCountJs(locator.selector)
      : buildLocatorCountJs(locator);
    const finder = isXpath
      ? buildXpathFindJs(locator.selector)
      : buildLocatorFindJs(locator);

    const counts = [];
    for (const context of contexts) {
      const outcome = await this.#safeCount(context.sessionId, counter);
      if (outcome === null) continue;
      counts.push({ sessionId: context.sessionId, count: outcome });
    }

    const total = counts.reduce((sum, entry) => sum + entry.count, 0);
    const label = describeLocator(locator);
    if (total === 0) {
      throw new ElementResolutionError(
        `Locator ${label} matched 0 elements`,
        "transient",
      );
    }
    if (total > 1) {
      const where = counts
        .filter((entry) => entry.count > 0)
        .map((entry) => `${entry.sessionId}:${entry.count}`)
        .join(", ");
      throw new ElementResolutionError(
        `Locator ${label} matched ${total} elements (${where}). ` +
          `Add more context or a terminal >> nth=N`,
        "permanent",
      );
    }

    const owner = counts.find((entry) => entry.count === 1);
    const result = await this.#evaluate(owner.sessionId, finder, {
      returnByValue: false,
    });
    const objectId = result?.objectId;
    if (!objectId) {
      throw new ElementResolutionError(
        `Locator ${label} matched 1 element but it could not be referenced`,
        "transient",
        { sessionId: owner.sessionId },
      );
    }
    const described = await this.channel.sendOptional(
      "DOM.describeNode",
      { objectId },
      owner.sessionId,
    );
    await this.channel.sendOptional(
      "Runtime.releaseObject",
      { objectId },
      owner.sessionId,
    );
    const backendNodeId = described?.node?.backendNodeId;
    if (backendNodeId === undefined || backendNodeId === null) {
      throw new ElementResolutionError(
        `Locator ${label} matched a node that is not exposed to the DOM domain`,
        "permanent",
        { sessionId: owner.sessionId },
      );
    }
    return {
      sessionId: owner.sessionId,
      backendNodeId,
      locator: label,
    };
  }

  async #safeCount(sessionId, body) {
    try {
      const result = await this.#evaluate(sessionId, body);
      const value = result?.value;
      return Number.isInteger(value) && value >= 0 ? value : null;
    } catch (error) {
      // A session that went away mid-resolution must not fail the whole lookup;
      // a malformed selector must still surface.
      if (error?.kind === "permanent") throw error;
      return null;
    }
  }

  async #resolveRole(locator, purpose) {
    const contexts = await this.#contexts();
    const matches = [];
    for (const context of contexts) {
      await this.channel.ensureAccessibility(context.sessionId);
      const tree = await this.channel.sendOptional(
        "Accessibility.getFullAXTree",
        {},
        context.sessionId,
      );
      for (const node of tree?.nodes ?? []) {
        if (node.ignored) continue;
        if (node.backendDOMNodeId === undefined || node.backendDOMNodeId === null) {
          continue;
        }
        if (normalizeRole(axString(node.role)) !== locator.role) continue;
        if (!roleNameMatches(axString(node.name), locator.name, locator.nameMode)) {
          continue;
        }
        matches.push({
          sessionId: context.sessionId,
          backendNodeId: node.backendDOMNodeId,
          role: locator.role,
          name: axString(node.name),
        });
      }
    }

    const label = describeLocator(locator);
    if (matches.length === 0) {
      throw new ElementResolutionError(
        `Locator ${label} matched 0 elements`,
        "transient",
      );
    }
    if (matches.length > 1) {
      const candidates = matches
        .slice(0, 3)
        .map((entry, index) => `${index + 1}. ${entry.role} ${JSON.stringify(entry.name)}`)
        .join("; ");
      throw new ElementResolutionError(
        `Locator ${label} matched ${matches.length} elements: ${candidates}. ` +
          `Refine the accessible name`,
        "permanent",
      );
    }
    const match = matches[0];
    return {
      sessionId: match.sessionId,
      backendNodeId: match.backendNodeId,
      role: match.role,
      name: match.name,
      locator: label,
    };
  }

  /**
   * Poll a target until it resolves. Retries only `transient` failures, which is
   * the whole point of the kind split: an ambiguous locator should say so
   * immediately instead of burning the timeout.
   */
  async waitFor(target, { registry, timeoutMs = 10_000, intervalMs = 100 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    for (;;) {
      try {
        return await this.resolve(target, { registry, purpose: "waitFor" });
      } catch (error) {
        last = error;
        if (!(error instanceof ElementResolutionError) || error.kind === "permanent") {
          throw error;
        }
        if (Date.now() >= deadline) {
          throw new ElementResolutionError(
            `${error.message} (waited ${timeoutMs}ms)`,
            "transient",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    // eslint-disable-next-line no-unreachable
    throw last;
  }
}

/** Re-export so callers do not need two imports for the error type. */
export { ElementResolutionError, classifyMatchCount, parseRefId };
export { AragonError };
