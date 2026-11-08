// Phase 3 of the smoke run: what survives the sweep.
//
// sweep-check.js opened two tabs and kept exactly one with page.keep(). If the
// sweep works, the space now holds the kept tab and nothing else - which is the
// whole fix, proven across two separate CLI processes.
const space = await taskSpace("sweep");
const tabs = await space.tabs();
const agentTabs = tabs.filter((tab) => tab.origin === "agent");

const sweptStillThere = agentTabs.filter((tab) => String(tab.url).includes("#swept-this-run"));
if (sweptStillThere.length > 0) {
  throw new Error(
    `the unkept tab survived the sweep: ${sweptStillThere.map((tab) => `${tab.label} ${tab.url}`).join(", ")}`,
  );
}
if (agentTabs.length !== 1) {
  throw new Error(
    `expected exactly the kept tab to survive, found ${agentTabs.length}: ` +
      agentTabs.map((tab) => `${tab.label} ${tab.url}`).join(", "),
  );
}
cliLog(`PASS page.keep() survived the sweep (${agentTabs[0].label} ${agentTabs[0].url})`);
cliLog("PASS the unkept tab was closed by the CLI, in a later process");

// Leave the browser as we found it: close the tab we asked to keep.
const keptPage = space.page(agentTabs[0].label);
await keptPage.close();
const remaining = (await space.tabs()).filter((tab) => tab.origin === "agent");
if (remaining.length !== 0) {
  throw new Error(`page.close() left ${remaining.length} tab(s) behind`);
}
cliLog("PASS space is clean again");
cliLog("DONE sweep-verify");
