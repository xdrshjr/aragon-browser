/**
 * End-of-script tab sweep.
 *
 * The CLI opens tabs on the agent's behalf; nothing used to close them, so a space
 * accumulated one tab per run and the rail filled up with dead pages. The rule is
 * now: **a script closes what it opened**, unless the script said otherwise.
 *
 * Three things can say "keep":
 *   - `--keep-tabs` / `ARAGON_KEEP_TABS=1`: keep everything this run opened;
 *   - `page.keep()`: keep that one tab (a page the next round will act on);
 *   - `space.handOff()`: the human takes the space, so its tabs are theirs.
 *
 * A space the human owns is never swept either - the agent must not close a tab
 * someone is reading.
 *
 * Kept pure (no client, no fs) so the decision - which tab closes, which survives,
 * which is already gone - is unit-testable without a browser.
 */

/**
 * @param {object} options
 * @param {Array<{spaceId:number, tabId:number, label:string|null, kept:boolean}>} [options.tracked]
 *   Tabs this run opened.
 * @param {Array<{spaceId:number, id:number, label:string|null}>} [options.openTabs]
 *   What the browser reports as still open.
 * @param {Array<number>} [options.userOwnedSpaceIds]
 *   Spaces the human owns; nothing in them is ever closed by the agent.
 * @param {boolean} [options.keepTabs] The whole sweep is disabled.
 * @returns {{close: object[], keep: object[], gone: object[], skippedUserOwned: object[], disabled: boolean}}
 */
export function planSweep({
  tracked = [],
  openTabs = [],
  userOwnedSpaceIds = [],
  keepTabs = false,
} = {}) {
  const userOwned = new Set(userOwnedSpaceIds.map(Number));
  const openIndex = new Map(openTabs.map((tab) => [`${Number(tab.spaceId)}:${tab.id}`, tab]));
  const result = {
    close: [],
    keep: [],
    gone: [],
    skippedUserOwned: [],
    disabled: Boolean(keepTabs),
  };

  for (const entry of tracked) {
    const spaceId = Number(entry.spaceId);
    const open = openIndex.get(`${spaceId}:${entry.tabId}`) ?? null;
    const record = {
      spaceId,
      tabId: entry.tabId,
      label: entry.label ?? open?.label ?? null,
    };
    if (keepTabs) {
      result.keep.push(record);
      continue;
    }
    if (open === null) {
      // Already closed (or belonged to a space that is gone): nothing to do, and
      // nothing to warn about.
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

/** One human-readable line, or null when there is nothing worth saying. */
export function describeSweep(result, { keepTabs = false } = {}) {
  if (!result) return null;
  if (keepTabs) {
    return result.keep.length > 0
      ? `aragon-browser: kept ${result.keep.length} tab(s) opened by this script (--keep-tabs)`
      : null;
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
