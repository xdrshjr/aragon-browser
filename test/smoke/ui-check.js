// Proves the browser's own window paints: layout geometry is checked, then the
// whole window is captured at the OS level, which is the only capture that
// composites the page view together with the chrome.
const space = await taskSpace("ui-check");
const page = await space.newPage(FIXTURE_URL);
await page.waitForLoad({ timeoutMs: 15000 });

// --- layout: the page view must sit under the chrome and have real area -----
const layout = await space.layout();
cliLog(`LAYOUT ${JSON.stringify(layout)}`);
const bounds = layout.viewBounds;
if (!bounds) throw new Error("the page view has no bounds");
if (bounds.width < 400 || bounds.height < 300) {
  throw new Error(`page view is too small to show a page: ${bounds.width}x${bounds.height}`);
}
if (bounds.x < 180) throw new Error(`page view overlaps the sidebar: x=${bounds.x}`);
if (bounds.y < 70) throw new Error(`page view overlaps the toolbar: y=${bounds.y}`);
if (bounds.x + bounds.width > layout.contentSize.width + 1) {
  throw new Error("page view overflows the window horizontally");
}
cliLog(`PASS page view is laid out at ${bounds.width}x${bounds.height} @ (${bounds.x},${bounds.y})`);

// --- chrome pixels ---------------------------------------------------------
const chrome = await space.captureChrome();
const chromeBytes = Buffer.from(chrome.base64, "base64");
if (chromeBytes.subarray(1, 4).toString("ascii") !== "PNG") {
  throw new Error("chrome capture is not a PNG");
}
cliLog(`PASS chrome rendered (${chromeBytes.length} bytes)`);

// --- whole-window pixels (page included) ----------------------------------
const windowShot = await space.captureWindow();
const windowBytes = Buffer.from(windowShot.base64, "base64");
if (windowBytes.length < 10_000) {
  throw new Error(`window capture is suspiciously small: ${windowBytes.length}`);
}
cliLog(
  `PASS window captured via "${windowShot.sourceName}" ` +
    `(${windowShot.size.width}x${windowShot.size.height}, ${windowBytes.length} bytes)`,
);

const fs = await import("node:fs");
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync("artifacts/ui-check-window.png", windowBytes);
await page.screenshot({ save: "artifacts/ui-check-page.png" });
cliLog("PASS wrote artifacts/ui-check-window.png and artifacts/ui-check-page.png");

// --- history wiring the UI buttons depend on ------------------------------
await page.goto(`${FIXTURE_URL}submit`);
const afterNav = await page.info();
if (!afterNav.canGoBack) throw new Error("history did not record the navigation");
await page.goBack();
const backInfo = await page.info();
if (!backInfo.canGoForward) throw new Error("back did not leave a forward entry");
// Full-page screenshot: proves the capture options travel end to end.
const full = await page.screenshot({ format: "jpeg", fullPage: true });
if (full.format !== "jpeg" || full.bytes < 1000) {
  throw new Error(`full-page jpeg capture failed: ${JSON.stringify(full)}`);
}
cliLog("PASS history and screenshot options work through the UI-facing surface");

cliLog("DONE ui-check");
