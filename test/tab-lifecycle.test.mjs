import assert from "node:assert/strict";
import test from "node:test";
import { createHelpers } from "../src/cli/helpers.js";
import { describeSweep, planSweep } from "../src/cli/tab-cleanup.js";

/**
 * Tab lifecycle.
 *
 * The bug these tests exist for: an agent opens a page per run and nothing ever
 * closes it, so the space (and the rail) grows one dead tab per run. The fix is a
 * capability (`page.close()`), a default (the CLI sweeps what the script opened)
 * and two opt-outs (`page.keep()`, `--keep-tabs`).
 *
 * The decision is a pure function so all of that is testable without a browser;
 * the helpers get a stub client, the same way review-fixes.test.mjs drives them.
 */

function stubClient({ tabs = [], spaces = null } = {}) {
  const calls = [];
  let nextTabId = 100;
  // Ownership is live state, not a fixture: handOff()/takeOver() change it, and the
  // sweep must read it at the moment it runs.
  const owners = new Map();
  for (const space of spaces ?? []) owners.set(space.id, space.owner ?? "agent");
  const state = () =>
    (spaces ?? [{ id: 7, name: "demo", owner: "agent", tabs }]).map((space) => ({
      ...space,
      owner: owners.get(space.id) ?? space.owner ?? "agent",
    }));
  const client = {
    calls,
    async request(method, params = {}, options = {}) {
      calls.push({ method, params, options });
      if (method === "tabs.list") return { tabs };
      if (method === "tabs.create") {
        nextTabId += 1;
        return { id: nextTabId, label: `p${nextTabId}`, origin: "agent", active: true };
      }
      if (method === "spaces.list") return { spaces: state() };
      if (method === "spaces.handOff") {
        owners.set(Number(params.spaceId), "user");
        return { id: Number(params.spaceId), owner: "user" };
      }
      if (method === "spaces.takeOver") {
        owners.set(Number(params.spaceId), "agent");
        return { id: Number(params.spaceId), owner: "agent" };
      }
      return { ok: true };
    },
  };
  return client;
}

// ---------------------------------------------------------------------------
// planSweep: the decision itself
// ---------------------------------------------------------------------------

test("a tab this run opened and left open is closed", () => {
  const plan = planSweep({
    tracked: [{ spaceId: 7, tabId: 1, label: "p1", kept: false }],
    openTabs: [{ spaceId: 7, id: 1, label: "p1" }],
  });
  assert.deepEqual(plan.close, [{ spaceId: 7, tabId: 1, label: "p1" }]);
  assert.deepEqual(plan.keep, []);
});

test("page.keep() and handOff keep their tabs", () => {
  const tracked = [
    { spaceId: 7, tabId: 1, label: "p1", kept: true },
    { spaceId: 7, tabId: 2, label: "p2", kept: false },
  ];
  const openTabs = [
    { spaceId: 7, id: 1, label: "p1" },
    { spaceId: 7, id: 2, label: "p2" },
  ];
  const plan = planSweep({ tracked, openTabs });
  assert.deepEqual(plan.keep.map((entry) => entry.tabId), [1]);
  assert.deepEqual(plan.close.map((entry) => entry.tabId), [2]);
});

test("--keep-tabs closes nothing at all", () => {
  const plan = planSweep({
    tracked: [{ spaceId: 7, tabId: 1, label: "p1", kept: false }],
    openTabs: [{ spaceId: 7, id: 1, label: "p1" }],
    keepTabs: true,
  });
  assert.equal(plan.disabled, true);
  assert.deepEqual(plan.close, []);
  assert.equal(plan.keep.length, 1);
});

test("a tab that is already gone is not an error and not a close", () => {
  const plan = planSweep({
    tracked: [{ spaceId: 7, tabId: 42, label: "p42", kept: false }],
    openTabs: [],
  });
  assert.deepEqual(plan.close, []);
  assert.deepEqual(plan.gone.map((entry) => entry.tabId), [42]);
});

test("a space the user owns is never touched", () => {
  const plan = planSweep({
    tracked: [{ spaceId: 9, tabId: 5, label: "p5", kept: false }],
    openTabs: [{ spaceId: 9, id: 5, label: "p5" }],
    userOwnedSpaceIds: [9],
  });
  assert.deepEqual(plan.close, []);
  assert.deepEqual(plan.skippedUserOwned.map((entry) => entry.tabId), [5]);
});

test("the sweep always says what it did", () => {
  const plan = planSweep({
    tracked: [{ spaceId: 7, tabId: 1, label: "p1", kept: false }],
    openTabs: [{ spaceId: 7, id: 1, label: "p1" }],
  });
  const line = describeSweep(plan);
  assert.match(line, /closed 1 tab\(s\)/);
  assert.match(line, /page\.close\(\)/, "the message has to teach the fix, not just report");
  assert.equal(describeSweep(planSweep({ tracked: [], openTabs: [] })), null);
});

// ---------------------------------------------------------------------------
// helpers: close / keep / sweep
// ---------------------------------------------------------------------------

test("page.close() closes its own tab and never creates one", async () => {
  const client = stubClient({ tabs: [{ id: 1, label: "p1", active: true }] });
  const helpers = createHelpers(client, { log: () => {} });
  const space = await helpers.taskSpace("demo");
  const page = space.page("p1");

  const result = await page.close();
  assert.equal(result.closed, true);
  assert.equal(result.label, "p1");
  const methods = client.calls.map((entry) => entry.method);
  assert.ok(methods.includes("tabs.close"), "it must actually close the tab");
  assert.ok(!methods.includes("tabs.create"), "closing must never open a tab");
  const close = client.calls.find((entry) => entry.method === "tabs.close");
  assert.equal(close.params.tabId, 1);
  assert.equal(close.params.spaceId, 7);
});

test("closing a page whose label is already gone reports closed: false", async () => {
  const client = stubClient({ tabs: [] });
  const helpers = createHelpers(client, { log: () => {} });
  const space = await helpers.taskSpace("demo");
  const page = space.page("p9");

  const result = await page.close();
  assert.equal(result.closed, false);
  const methods = client.calls.map((entry) => entry.method);
  assert.ok(!methods.includes("tabs.create"), "a stale handle must not materialise a tab");
  assert.ok(!methods.includes("tabs.close"), "there is nothing to close");
});

test("the end-of-run sweep closes only what this run opened", async () => {
  // p1 already existed before the run; p101 is opened by this script.
  const tabs = [{ id: 1, label: "p1", active: true }];
  const client = stubClient({ tabs });
  const helpers = createHelpers(client, { log: () => {} });
  const space = await helpers.taskSpace("demo");
  const page = await space.newPage("https://example.com");
  assert.ok(page.label, "newPage returns a handle with a label");
  // The browser now reports both tabs.
  tabs.push({ id: page.tabId, label: page.label, active: true, origin: "agent" });

  const plan = await helpers.__sweepTabs();
  assert.deepEqual(
    plan.close.map((entry) => entry.tabId),
    [page.tabId],
    "only the tab this run opened may be swept",
  );
  const closed = client.calls.filter((entry) => entry.method === "tabs.close");
  assert.equal(closed.length, 1);
  assert.equal(closed[0].params.tabId, page.tabId);
});

test("handOff keeps a space's tabs, and takeOver lets the sweep close them again", async () => {
  const tabs = [];
  const client = stubClient({ tabs });
  const helpers = createHelpers(client, { log: () => {} });
  const space = await helpers.taskSpace("demo");
  const first = await space.newPage("https://example.com/first");
  tabs.push({ id: first.tabId, label: first.label, active: true, origin: "agent" });

  // Handed to the human: the sweep must not close a tab someone is reading.
  await space.handOff();
  const handedOff = await helpers.__sweepTabs();
  assert.deepEqual(handedOff.close, [], "a handed-off space's tabs stay");
  assert.deepEqual(handedOff.skippedUserOwned.map((entry) => entry.tabId), [first.tabId]);

  // Taken back: it is the agent's tab again, so it is swept. (A sticky "kept" flag
  // set at handOff time got this wrong and leaked the tab forever.)
  await helpers.takeOverTaskSpace(space.id);
  const reclaimed = await helpers.__sweepTabs();
  assert.deepEqual(
    reclaimed.close.map((entry) => entry.tabId),
    [first.tabId],
    "after takeOver the agent's tabs are swept again",
  );
});

test("--keep-tabs disables the sweep even for a tracked tab", async () => {
  const tabs = [];
  const client = stubClient({ tabs });
  const helpers = createHelpers(client, { log: () => {} });
  const space = await helpers.taskSpace("demo");
  const page = await space.newPage("https://example.com");
  tabs.push({ id: page.tabId, label: page.label, active: true, origin: "agent" });

  const plan = await helpers.__sweepTabs({ keepTabs: true });
  assert.equal(plan.disabled, true);
  assert.deepEqual(plan.close, []);
  assert.equal(client.calls.filter((entry) => entry.method === "tabs.close").length, 0);
});

test("the sweep is silent when the script closed its own tabs", async () => {
  const tabs = [];
  const client = stubClient({ tabs });
  const helpers = createHelpers(client, { log: () => {} });
  const space = await helpers.taskSpace("demo");
  const page = await space.newPage("https://example.com");
  tabs.push({ id: page.tabId, label: page.label, active: true, origin: "agent" });
  await page.close();

  const plan = await helpers.__sweepTabs();
  assert.deepEqual(plan.close, []);
  assert.equal(describeSweep(plan), null, "nothing left behind, nothing to report");
});
