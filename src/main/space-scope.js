/**
 * Space scoping for renderer RPCs.
 *
 * The chrome renderer sends `{ method, params }` over IPC, and `params` carries a
 * `spaceId`. Without scoping that id is a capability: the visible space's chrome
 * could navigate, hand off or close a *background* space.
 *
 * There is one shell window and many spaces, so "which window sent this" no longer
 * identifies a single space - the window's *focused* space is the only identity
 * worth trusting. `main.js` asks the kernel for it (`focusedSpaceIdForContents`)
 * and the payload id must agree with it.
 *
 * Kept pure (no Electron) so the policy - which methods may name another space,
 * and what happens to a missing or foreign id - is testable without a window.
 */

/**
 * Methods ALLOWED to name a space other than the sender's focused one.
 *
 * `ui.focusSpace` is the sidebar's entire purpose: clicking space 3 in the rail
 * shows space 3 in the window. It is also not destructive.
 * `ui.newSpace` creates a space and targets none, so requiring a match would make
 * creating a space from the chrome impossible.
 * `ui.closeSpace` is the sidebar's ✕ on a row that need not be the focused one.
 */
export const CROSS_SPACE_UI_METHODS = new Set([
  "ui.focusSpace",
  "ui.newSpace",
  "ui.closeSpace",
]);

/**
 * Decide the params a renderer RPC is actually dispatched with.
 *
 * @returns {{ ok: true, params: object } | { ok: false, error: string }}
 */
export function scopeRendererParams({ method, params, senderSpaceId }) {
  const scoped = { ...(params ?? {}) };
  // No known sender (not the shell window, e.g. the API window): nothing to pin to.
  if (senderSpaceId === null || senderSpaceId === undefined) {
    return { ok: true, params: scoped };
  }
  if (CROSS_SPACE_UI_METHODS.has(method)) {
    return { ok: true, params: scoped };
  }
  if (scoped.spaceId === undefined || scoped.spaceId === null) {
    // Fill it in rather than relying on the kernel's "current space" default,
    // which is global state and can point at a background space. A `null` counts
    // as unset: the chrome sends `spaceId: null` before the first state push, and
    // reading that as "some other space" would refuse an honest request.
    return { ok: true, params: { ...scoped, spaceId: senderSpaceId } };
  }
  if (Number(scoped.spaceId) !== Number(senderSpaceId)) {
    return {
      ok: false,
      error: `refused ${method} for space ${scoped.spaceId}: the window is showing space ${senderSpaceId}`,
    };
  }
  return { ok: true, params: scoped };
}
