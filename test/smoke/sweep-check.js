// Phase 2 of the smoke run: proves the end-of-run sweep really happened.
//
// Phase 1 (agent-script.js) opened tabs in several spaces and never closed most of
// them. The CLI is supposed to close exactly those when it exits, so this run
// starts from whatever it left behind - and then opens one tab it keeps and one it
// does not, for phase 3 (sweep-verify.js) to check.
const spaces = await listTaskSpaces();
const leftovers = [];
for (const space of spaces) {
  for (const tab of space.tabs ?? []) {
    if (tab.origin === "agent") leftovers.push(`${space.name}/${tab.label}`);
  }
}
if (leftovers.length > 0) {
  throw new Error(
    `the previous run left ${leftovers.length} agent tab(s) open: ${leftovers.join(", ")}`,
  );
}
cliLog(`PASS the previous run's agent tabs were swept (${spaces.length} spaces, 0 leftovers)`);

// Windows are still one, even after all those spaces/churn.
const version = await browserVersion();
if (version.windows !== 1) {
  throw new Error(`spaces multiplied into ${version.windows} windows`);
}
cliLog(`PASS still ${version.spaces} spaces in ${version.windows} window`);

// page.close(): the explicit half of the contract.
const space = await taskSpace("sweep");
const page = await space.newPage(FIXTURE_URL);
const closed = await page.close();
if (!closed.closed) throw new Error(`page.close() did nothing: ${JSON.stringify(closed)}`);
const afterClose = await space.tabs();
if (afterClose.some((tab) => tab.id === page.tabId)) {
  throw new Error("page.close() left the tab in the space");
}
cliLog(`PASS page.close() removed ${closed.label ?? "the tab"} from the space`);

// One kept tab (the next round will act on it) and one to be swept by the CLI.
// The fragment is the marker sweep-verify.js looks for - it never reaches the
// fixture server, but it is part of the URL the browser reports.
const kept = await space.newPage(FIXTURE_URL);
kept.keep();
const swept = await space.newPage(`${FIXTURE_URL}#swept-this-run`);
cliLog(`KEEP ${kept.label} SWEEP ${swept.label}`);
cliLog("DONE sweep-check");
