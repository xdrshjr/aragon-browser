/**
 * Space scoping for renderer RPCs.
 *
 * The chrome renderer sends `{ method, params }` over IPC, and `params` carries a
 * `spaceId`. Without scoping that id is a capability: a window could navigate,
 * hand off or close a *sibling* space. The window a renderer lives in is the only
 * identity worth trusting, so the payload id must agree with it.
 *
 * Kept pure (no Electron) so the policy - which methods may name another space,
 * and what happens to a missing or foreign id - is testable without a window.
 */

/**
 * Methods ALLOWED to name a space other than the sender's.
 *
 * `ui.focusSpace` is the sidebar's entire purpose: clicking space 3 in space 1's
 * sidebar focuses space 3's window. It is also not destructive.
 * `ui.newSpace` creates a space and targets none, so requiring a match would make
 * creating a space from the chrome impossible.
 */
export const CROSS_SPACE_UI_METHODS = new Set(["ui.focusSpace", "ui.newSpace"]);

/**
 * Decide the params a renderer RPC is actually dispatched with.
 *
 * @returns {{ ok: true, params: object } | { ok: false, error: string }}
 */
export function scopeRendererParams({ method, params, senderSpaceId }) {
  const scoped = { ...(params ?? {}) };
  // No known sender (not a space window, e.g. the API window): nothing to pin to.
  if (senderSpaceId === null || senderSpaceId === undefined) {
    return { ok: true, params: scoped };
  }
  if (CROSS_SPACE_UI_METHODS.has(method)) {
    return { ok: true, params: scoped };
  }
  if (scoped.spaceId === undefined) {
    // Fill it in rather than relying on the kernel's "current space" default,
    // which is global state and can point at a sibling.
    return { ok: true, params: { ...scoped, spaceId: senderSpaceId } };
  }
  if (Number(scoped.spaceId) !== Number(senderSpaceId)) {
    return {
      ok: false,
      error: `refused ${method} for space ${scoped.spaceId} from the window of space ${senderSpaceId}`,
    };
  }
  return { ok: true, params: scoped };
}
