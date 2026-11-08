/**
 * Full-surface smoke script, executed by the real CLI against the real browser.
 *
 * Every assertion here is a claim the README makes. If one fails, the claim is
 * false - that is the point of running them instead of describing them.
 */
const space = await taskSpace("smoke");
const page = await space.newPage(FIXTURE_URL);
await page.waitForLoad({ timeoutMs: 15000 });

// ===========================================================================
// 1. snapshot: refs, cross-site iframe flattening
// ===========================================================================
const first = await page.snapshot();
cliLog(first.text);

const emailRef = first.refs.find((r) => r.role === "textbox" && /email/i.test(r.name));
const buttonRef = first.refs.find((r) => r.role === "button" && /continue/i.test(r.name));
const frameFieldRef = first.refs.find(
  (r) => r.role === "textbox" && /code/i.test(r.name) && r.sessionId !== "root",
);
if (!emailRef) throw new Error("no Email textbox ref");
if (!buttonRef) throw new Error("no Continue button ref");
if (!frameFieldRef) throw new Error("cross-site iframe was not flattened into the snapshot");
cliLog(`PASS snapshot refs: email=@${emailRef.ref} button=@${buttonRef.ref} frame=@${frameFieldRef.ref}`);

// ===========================================================================
// 2. refs: real click and fill change the DOM
// ===========================================================================
const before = await page.evaluate("document.getElementById('result').textContent");
if (before !== "") throw new Error(`result was not empty before the click: ${before}`);

await page.fill(`@${emailRef.ref}`, "agent@example.com");
const typed = await page.evaluate("document.getElementById('email').value");
if (typed !== "agent@example.com") throw new Error(`fill did not take: ${typed}`);
cliLog("PASS fill wrote a real value into the input");

await page.click(`@${buttonRef.ref}`);
const after = await page.evaluate("document.getElementById('result').textContent");
if (after !== "clicked:agent@example.com") {
  throw new Error(`click did not fire the page handler: ${after}`);
}
cliLog("PASS click dispatched a trusted pointer event and the page reacted");

const second = await page.snapshot();
const emailAgain = second.refs.find((r) => r.role === "textbox" && /email/i.test(r.name));
if (!emailAgain || emailAgain.ref !== emailRef.ref) {
  throw new Error("refs are not stable across snapshots in the same document");
}
cliLog("PASS refs stayed stable across two snapshots");

// ===========================================================================
// 3. locators: css, role, text, nth, shadow DOM, xpath
// ===========================================================================
await page.fill("css:#email", "locator@example.com");
if ((await page.evaluate("document.getElementById('email').value")) !== "locator@example.com") {
  throw new Error("css locator fill failed");
}
cliLog("PASS css:#email locator works");

await page.click('loc=role:button[name="Continue"]');
if ((await page.evaluate("document.getElementById('result').textContent")) !== "clicked:locator@example.com") {
  throw new Error("role locator click failed");
}
cliLog("PASS loc=role:button[name=\"Continue\"] locator works");

await page.click("text=Continue");
cliLog("PASS text= substring locator works");

// Two identical buttons: nth picks one deterministically, and the same selector
// without nth must refuse to guess.
await page.click("css:.dup >> nth=1");
cliLog("PASS terminal >> nth=1 selected a duplicate button");

let ambiguous = null;
try {
  await page.click("css:.dup");
} catch (error) {
  ambiguous = error;
}
if (!ambiguous) throw new Error("an ambiguous selector silently clicked something");
if (!/matched 2 elements/.test(ambiguous.message)) {
  throw new Error(`ambiguity message was unhelpful: ${ambiguous.message}`);
}
if (ambiguous.error_code !== "ARAGON_ELEMENT_PERMANENT") {
  throw new Error(`ambiguity must be permanent (a wait must not retry it), got ${ambiguous.error_code}`);
}
cliLog("PASS ambiguous selector is a permanent error, not a retry loop");

// Shadow DOM: the shadow button is invisible to document.querySelectorAll.
await page.click("css:button:has-text('Shadow action')");
if ((await page.evaluate("document.getElementById('result').textContent")) !== "shadow-clicked") {
  throw new Error("shadow-DOM click failed: locator did not pierce the shadow root");
}
cliLog("PASS :has-text locator pierced a shadow root");

await page.click("xpath=//button[@id='go']");
cliLog("PASS xpath= locator works");

// A missing element is transient: waitFor retries it, a plain click does not.
let missing = null;
try {
  await page.click("css:#definitely-not-here");
} catch (error) {
  missing = error;
}
if (missing?.error_code !== "ARAGON_ELEMENT_TRANSIENT") {
  throw new Error(`a missing element must be transient, got ${missing?.error_code}`);
}
cliLog("PASS missing element is transient (retryable), not permanent");

// ===========================================================================
// 4. cross-frame work
// ===========================================================================
const frames = await page.frames();
const frameSession = frameFieldRef.sessionId;
if (!frames.frames.some((entry) => entry.sessionId === frameSession)) {
  throw new Error("the frame session is not in the frame inventory");
}
const readInFrame = async (expression) => {
  const response = await page.cdp({
    method: "Runtime.evaluate",
    params: { expression, returnByValue: true },
    sessionId: frameSession,
  });
  return response?.result?.result?.value;
};

await page.fill(`@${frameFieldRef.ref}`, "9 9 9");
if ((await readInFrame("document.getElementById('code').value")) !== "9 9 9") {
  throw new Error("cross-frame fill failed");
}
cliLog("PASS cross-frame fill reached the OOPIF input");

const payButton = second.refs.find(
  (r) => r.role === "button" && /pay now/i.test(r.name) && r.sessionId !== "root",
);
if (!payButton) throw new Error("frame button ref missing");
await page.click(`@${payButton.ref}`);
if ((await readInFrame("document.getElementById('frame-note').textContent")) !== "frame-clicked:9 9 9") {
  throw new Error("cross-frame click landed wrong");
}
cliLog("PASS cross-frame click landed on the button inside the OOPIF");

// Locators must also reach into frames, not just refs.
await page.click('css:#paybtn');
cliLog("PASS css locator resolved inside the cross-site frame");

// ===========================================================================
// 5. dialogs
// ===========================================================================
await page.click("css:#ask");
const dialogReport = await page.dialogs();
if (dialogReport.dialogs.length === 0) throw new Error("the confirm() was never seen");
const dialog = dialogReport.dialogs.at(-1);
if (dialog.type !== "confirm" || !/Delete everything/.test(dialog.message)) {
  throw new Error(`dialog was misrecorded: ${JSON.stringify(dialog)}`);
}
const askResult = await page.evaluate("document.getElementById('ask-result').textContent");
if (!/^answer:(true|false)$/.test(String(askResult))) {
  throw new Error(`the page never resumed after the dialog: ${askResult}`);
}
cliLog(`PASS confirm() tracked and answered (${dialog.handled}), page resumed with ${askResult}`);

// ===========================================================================
// 6. file upload
// ===========================================================================
await page.upload("css:#file", [UPLOAD_FILE]);
const fileResult = await page.evaluate("document.getElementById('file-result').textContent");
if (!/^file:upload me\.txt:\d+$/.test(String(fileResult))) {
  throw new Error(`upload did not reach the page: ${fileResult}`);
}
cliLog(`PASS file upload reached the page (${fileResult})`);

// A bad path must fail loudly instead of uploading nothing.
let badUpload = null;
try {
  await page.upload("css:#file", ["Z:/definitely/not/here.txt"]);
} catch (error) {
  badUpload = error;
}
if (!badUpload || !/does not exist/.test(badUpload.message)) {
  throw new Error("a missing upload path was not reported");
}
cliLog("PASS a missing upload path is rejected with a clear message");

// ===========================================================================
// 7. drag
// ===========================================================================
await page.drag("css:#dragsource", "css:#dropzone");
const dragResult = await page.evaluate("document.getElementById('drag-result').textContent");
if (dragResult !== "drag:entered") {
  throw new Error(`drag did not reach the drop zone: ${dragResult}`);
}
cliLog("PASS drag moved from source to drop zone with real pointer events");

// ===========================================================================
// 8. clipboard
// ===========================================================================
const marker = `aragon-${Date.now()}`;
await page.clipboard(marker);
const readBack = await page.readClipboard();
if (readBack.text !== marker) {
  throw new Error(`clipboard round-trip failed: ${readBack.text}`);
}
cliLog("PASS clipboard write/read round-trip");

// ===========================================================================
// 9. waits
// ===========================================================================
await page.waitFor("css:#email");
cliLog("PASS waitFor(target) resolved an existing element");

let waitFailed = false;
try {
  await page.waitFor("css:#never-appears", { timeoutMs: 600 });
} catch {
  waitFailed = true;
}
if (!waitFailed) throw new Error("waitFor returned success for an element that never exists");
cliLog("PASS waitFor(target) times out honestly");

// A permanent failure must not be retried: it should come back fast.
const ambiguousStart = Date.now();
try {
  await page.waitFor("css:.dup", { timeoutMs: 8000 });
  throw new Error("waitFor accepted an ambiguous locator");
} catch (error) {
  if (error.error_code !== "ARAGON_ELEMENT_PERMANENT") {
    throw new Error(`waitFor should surface the permanent error, got ${error.error_code}`);
  }
  const elapsed = Date.now() - ambiguousStart;
  if (elapsed > 2000) {
    throw new Error(`waitFor retried a permanent failure for ${elapsed}ms`);
  }
  cliLog(`PASS waitFor refuses to retry an ambiguous locator (${elapsed}ms)`);
}

await page.waitForText("Sign in");
cliLog("PASS waitForText found page text");
await page.waitForNetworkIdle({ idleMs: 300, timeoutMs: 8000 });
cliLog("PASS waitForNetworkIdle settled");

// Regression: waitForLoad returns instantly on an already-complete document, so
// a navigation wait has to look at the loaderId instead. This is the bug that
// made a link click look like it did nothing.
const navSpace = await taskSpace("nav-wait");
const navPage = await navSpace.newPage(FIXTURE_URL);
await navPage.waitForLoad();
// A page created straight at /submit has no history entry to go back to, so
// reach it by navigating from the fixture page.
await navPage.goto(`${FIXTURE_URL}submit`);
await navPage.waitForLoad();
const navBefore = await navPage.info();
const navigation = navPage.waitForNavigation({ timeoutMs: 15000 });
await navPage.goBack();
await navigation;
const navAfter = await navPage.info();
if (navAfter.url === navBefore.url) {
  throw new Error(`waitForNavigation returned on the same URL: ${navAfter.url}`);
}
cliLog(`PASS waitForNavigation detected a real document change (${navBefore.url} -> ${navAfter.url})`);

let noNav = null;
try {
  await navPage.waitForNavigation({ timeoutMs: 500 });
} catch (error) {
  noNav = error;
}
if (!noNav || !/no navigation started/.test(noNav.message)) {
  throw new Error(`an idle page must not report a navigation: ${noNav?.message}`);
}
cliLog("PASS waitForNavigation reports honestly when nothing navigates");

// taskSpace() switches the selected space, so anything that relies on the bare
// helpers afterwards has to re-select. Documented in SKILL.md, asserted here.
await taskSpace("smoke");
cliLog("PASS re-selecting a space by name restored the smoke space");

// ===========================================================================
// 10. learned site skills
// ===========================================================================
const learned = await page.learn();
if (!learned.exists) throw new Error("the fixture site skill was not discovered");
if (learned.knowledge.length === 0) throw new Error("learned notes were not loaded");
cliLog(`PASS learned site skill "${learned.siteId}" loaded ${learned.knowledge.length} note(s), ${learned.tools.length} tool(s)`);

const readEmail = await runSiteTool("aragon-fixture", "read_email_field", {});
if (readEmail.result !== "locator@example.com") {
  throw new Error(`node site tool read the wrong value: ${JSON.stringify(readEmail)}`);
}
cliLog("PASS learned node tool ran with the live page context");

const submitted = await runSiteTool("aragon-fixture", "submit_email", { email: "tool@example.com" });
if (submitted.result.result !== "clicked:tool@example.com") {
  throw new Error(`node site tool did not drive the page: ${JSON.stringify(submitted)}`);
}
cliLog("PASS learned node tool drove a multi-step interaction on its own");

const browserTool = await runSiteBrowserTool("aragon-fixture", "form_state", {});
if (browserTool.result.email !== "tool@example.com") {
  throw new Error(`browser tool read the wrong state: ${JSON.stringify(browserTool)}`);
}
cliLog("PASS learned browser tool ran inside the page");

const validation = await validateSiteSkills();
if (!validation.ok) throw new Error(`site skills failed validation: ${validation.errors.join("; ")}`);
cliLog("PASS every installed site skill validates");

// ===========================================================================
// 11. navigation invalidates refs
// ===========================================================================
await page.goto(`${FIXTURE_URL}submit`);
let staleCode = null;
try {
  await page.click(`@${buttonRef.ref}`);
} catch (error) {
  staleCode = error.error_code ?? String(error);
}
if (!/TRANSIENT|PERMANENT|REF_STALE|REF_NOT_FOUND/.test(String(staleCode))) {
  throw new Error(`expected a stale-ref error after navigation, got ${staleCode}`);
}
cliLog(`PASS navigation invalidated old refs (${staleCode})`);

// ===========================================================================
// 12. history
// ===========================================================================
await page.goBack();
if (!String(await page.evaluate("location.pathname")).match(/\/$/)) {
  throw new Error("goBack did not return to the fixture page");
}
cliLog("PASS goBack works");
const info = await page.info();
if (!info.canGoForward) throw new Error("history lost the forward entry");
cliLog("PASS history reports forward availability");

// ===========================================================================
// 13. space isolation
// ===========================================================================
const spaceA = await taskSpace("iso-a");
const pageA = await spaceA.newPage(FIXTURE_URL);
await pageA.waitForLoad();
await pageA.evaluate("document.cookie = 'probe=a; path=/'");
const spaceB = await taskSpace("iso-b");
const pageB = await spaceB.newPage(FIXTURE_URL);
await pageB.waitForLoad();
const cookieB = await pageB.evaluate("document.cookie");
if (String(cookieB).includes("probe=a")) {
  throw new Error(`spaces share cookies: ${cookieB}`);
}
cliLog("PASS spaces are cookie-isolated (separate session partitions)");

// ===========================================================================
// 14. control handoff
// ===========================================================================
await space.handOff();
let gateCode = null;
try {
  await page.click("css:#go");
} catch (error) {
  gateCode = error.error_code ?? String(error);
}
if (gateCode !== "EGO_TASK_SPACE_USER_IN_CONTROL") {
  throw new Error(`handoff did not block the agent, got ${gateCode}`);
}
cliLog("PASS handoff blocks agent mutations with EGO_TASK_SPACE_USER_IN_CONTROL");

await takeOverTaskSpace(space.id);
const reclaimed = await page.snapshot();
cliLog(`PASS takeOverTaskSpace returned control (${reclaimed.refCount} refs)`);

// ===========================================================================
// 15. finish(): keep is mandatory
// ===========================================================================
let finishError = null;
try {
  await spaceA.finish();
} catch (error) {
  finishError = error;
}
if (!finishError) throw new Error("finish() without keep was allowed");
cliLog("PASS finish() without keep is rejected");

const receipt = await spaceA.finish({ keep: "all" });
// Labels are globally unique across spaces, so assert on the page's own label
// rather than a hard-coded p1.
if (!receipt.keptManagedLabels.includes(pageA.label)) {
  throw new Error(
    `finish(keep:"all") did not keep ${pageA.label}: ${JSON.stringify(receipt)}`,
  );
}
cliLog(`PASS finish({keep:"all"}) kept ${receipt.keptManagedLabels.join(",")}`);

// keep: [] must close the agent's tab but must never close a space the user owns.
const receipt2 = await spaceA.finish({ keep: [] });
if (receipt2.closedManagedLabels.length !== 1) {
  throw new Error(`finish({keep:[]}) closed the wrong number of tabs: ${JSON.stringify(receipt2)}`);
}
cliLog(`PASS finish({keep:[]}) closed ${receipt2.closedManagedLabels.join(",")}`);

await page.screenshot({ save: "artifacts/smoke.png" });
cliLog("PASS screenshot written to artifacts/smoke.png");
cliLog(`DONE space=${space.id}`);
