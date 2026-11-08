import { setTimeout as delay } from "node:timers/promises";
import { AragonError, ERROR_CODES } from "../shared/protocol.js";
import { ElementResolutionError, normalizeText } from "./locator.js";
import { ROOT_SESSION } from "./cdp-channel.js";

/**
 * Waiting primitives.
 *
 * The rule that makes these useful: every wait retries only failures that can
 * plausibly resolve themselves. A missing element is transient; an ambiguous
 * selector is not, and retrying it just burns the timeout and hides the bug.
 */

async function evaluate(channel, sessionId, body) {
  const result = await channel.send(
    "Runtime.evaluate",
    {
      expression: `(function(){\n${body}\n})()`,
      returnByValue: true,
      awaitPromise: true,
      allowUnsafeEvalBlockedByCSP: true,
    },
    sessionId,
  );
  if (result?.exceptionDetails) {
    const text =
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new AragonError(
      ERROR_CODES.OPERATION_FAILED,
      `page threw: ${String(text).split("\n")[0]}`,
    );
  }
  return result?.result?.value;
}

const POLL_DEFAULTS = { intervalMs: 100, timeoutMs: 10_000 };

function withDeadline(options, extra = {}) {
  return {
    intervalMs: Number.isInteger(options.intervalMs) ? options.intervalMs : POLL_DEFAULTS.intervalMs,
    timeoutMs: Number.isInteger(options.timeoutMs) ? options.timeoutMs : POLL_DEFAULTS.timeoutMs,
    ...extra,
  };
}

/** Poll any predicate until it reports done, or fail with a real message. */
async function poll(description, check, { timeoutMs, intervalMs, isDone }) {
  const done = isDone ?? ((value) => value === true);
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let lastValue;
  for (;;) {
    try {
      const value = await check();
      lastValue = value;
      if (done(value)) {
        return { ok: true, value, waitedMs: timeoutMs - (deadline - Date.now()) };
      }
    } catch (error) {
      lastError = error;
      if (error instanceof ElementResolutionError && error.kind === "permanent") {
        throw error;
      }
      if (error instanceof AragonError && error.error_code === ERROR_CODES.OPERATION_FAILED) {
        throw error;
      }
    }
    if (Date.now() >= deadline) {
      const detail = lastError
        ? `: ${lastError.message}`
        : ` (last value ${JSON.stringify(lastValue)})`;
      throw new AragonError(
        ERROR_CODES.OPERATION_FAILED,
        `${description} did not become true within ${timeoutMs}ms${detail}`,
      );
    }
    await delay(intervalMs);
  }
}

export async function waitForTarget(resolver, target, { registry, ...options } = {}) {
  const settings = withDeadline(options || {});
  const result = await poll(
    `waitForTarget(${JSON.stringify(target)})`,
    async () => resolver.resolve(target, { registry, purpose: "waitForTarget" }),
    // Resolution success is "we got a node", so any object counts as done.
    { ...settings, isDone: (value) => Boolean(value && value.backendNodeId !== undefined) },
  );
  return { ...result, entry: result.value };
}

export async function waitForExpression(channel, expression, options = {}) {
  const settings = withDeadline(options);
  return poll(
    `waitForExpression(${JSON.stringify(expression)})`,
    async () => {
      const value = await evaluate(channel, ROOT_SESSION, `return (${expression});`);
      // "Truthy", as documented: `3` from querySelectorAll().length and `1` from
      // a flag both mean the condition is satisfied.
      return Boolean(value);
    },
    settings,
  );
}

export async function waitForText(channel, text, options = {}) {
  const settings = withDeadline(options);
  const expected = normalizeText(text);
  if (!expected) {
    throw new AragonError(ERROR_CODES.INVALID_ARGUMENT, "waitForText needs text");
  }
  return poll(
    `waitForText(${JSON.stringify(expected)})`,
    async () => {
      const found = await evaluate(
        channel,
        ROOT_SESSION,
        `const body = document.body;
         const text = body ? (body.innerText || body.textContent || '') : '';
         return String(text).replace(/\\s+/g, ' ').toLowerCase().includes(${JSON.stringify(expected.toLowerCase())});`,
      );
      return found === true;
    },
    settings,
  );
}

/** Wait until the document has finished loading at least once. */
export async function waitForLoad(channel, options = {}) {
  const settings = withDeadline(options);
  return poll(
    "waitForLoad()",
    async () =>
      (await evaluate(channel, ROOT_SESSION, "return document.readyState === 'complete';")) ===
      true,
    settings,
  );
}

/**
 * Wait for an actual navigation.
 *
 * `waitForLoad` alone is not enough after a click: the OLD document is already
 * `complete`, so it returns instantly and the caller reads the page it was
 * trying to leave.
 *
 * The baseline comes from the channel's event-driven `navigationSeq`, not from a
 * CDP round trip. A round trip takes long enough that a fast navigation can
 * commit before the baseline is read, and then "wait for the next navigation"
 * waits for an event that already happened.
 */
export async function waitForNavigation(channel, options = {}) {
  const settings = withDeadline(options, { timeoutMs: options.timeoutMs ?? 30_000 });
  const baselineSeq = channel.navigationSeq ?? 0;
  const baselineLoader = channel.mainLoaderId ?? null;
  const deadline = Date.now() + settings.timeoutMs;
  let navigated = false;

  for (;;) {
    const seq = channel.navigationSeq ?? 0;
    const loader = channel.mainLoaderId ?? null;
    if (!navigated && (seq > baselineSeq || (loader && baselineLoader && loader !== baselineLoader))) {
      navigated = true;
    }
    if (!navigated && loader && !baselineLoader) navigated = true;

    if (navigated) {
      const ready = await evaluate(
        channel,
        ROOT_SESSION,
        "return document.readyState === 'complete';",
      ).catch(() => false);
      if (ready === true) {
        return {
          ok: true,
          from: baselineLoader,
          to: loader,
          navigations: seq - baselineSeq,
          waitedMs: settings.timeoutMs - (deadline - Date.now()),
        };
      }
    }
    if (Date.now() >= deadline) {
      throw new AragonError(
        ERROR_CODES.OPERATION_FAILED,
        navigated
          ? `navigation started but did not finish loading within ${settings.timeoutMs}ms`
          : `no navigation started within ${settings.timeoutMs}ms`,
      );
    }
    await delay(settings.intervalMs);
  }
}

/**
 * Network idle: no in-flight requests for `idleMs`. Network must have been
 * enabled *before* the navigation that starts the traffic, otherwise the counter
 * never sees the requests and "idle" is trivially true.
 */
export async function waitForNetworkIdle(channel, options = {}) {
  const settings = withDeadline(options);
  const idleMs = Number.isInteger(options.idleMs) ? options.idleMs : 500;
  await channel.enableNetwork();
  const deadline = Date.now() + settings.timeoutMs;
  let quietSince = Date.now();
  for (;;) {
    if (channel.inflightRequests === 0) {
      if (Date.now() - quietSince >= idleMs) {
        return { ok: true, inflight: 0 };
      }
    } else {
      quietSince = Date.now();
    }
    if (Date.now() >= deadline) {
      throw new AragonError(
        ERROR_CODES.OPERATION_FAILED,
        `network did not go idle for ${idleMs}ms within ${settings.timeoutMs}ms (${channel.inflightRequests} requests in flight)`,
      );
    }
    await delay(settings.intervalMs);
  }
}

export async function waitForDialog(channel, options = {}) {
  const settings = withDeadline(options);
  await channel.enableDialogs();
  const baseline = channel.dialogs.length;
  return poll(
    "waitForDialog()",
    async () => {
      // Either a dialog that appeared since the wait started (even one the policy
      // auto-answered - the caller still wants to know it happened), or one that is
      // still open. Both use the newest entry.
      const fresh = channel.dialogs.slice(baseline).at(-1);
      if (fresh) return fresh;
      return [...channel.dialogs].reverse().find((entry) => entry.handled === null) ?? false;
    },
    // The check returns a dialog object, not `true`; without this the default
    // `value === true` predicate made every call run to its deadline and fail.
    { ...settings, isDone: (value) => Boolean(value) },
  );
}

/** Retry an action on transient element failures only. */
export async function retryOnTransient(fn, { attempts = 20, intervalMs = 100 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof ElementResolutionError && error.kind === "transient";
      if (!retryable || attempt === attempts) break;
      await delay(intervalMs);
    }
  }
  throw lastError;
}
