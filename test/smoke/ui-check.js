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
// A native caption sits OUTSIDE the client area, so a framed window reports a
// getSize() tens of pixels bigger than getContentSize(). That gap being ~0 is the
// proof that the self-drawn title bar really replaced the native one - not just
// that it looks different in a screenshot. Tolerance, not equality: a maximized
// window legitimately overhangs the work area by the 8px resize border per side -
// which is why a maximized window is measured per axis instead of summed (a summed
// gap can cancel out and hide a ~31px caption).
if (layout.maximized) {
  if (Math.abs(layout.windowSize.width - layout.contentSize.width) > 20) {
    throw new Error("window is maximized and reports a horizontal native frame");
  }
} else {
  const dx = Math.abs(layout.windowSize.width - layout.contentSize.width);
  const dy = Math.abs(layout.windowSize.height - layout.contentSize.height);
  if (dx > 2 || dy > 2) {
    throw new Error(
      `the window still has a native frame: size ${layout.windowSize.width}x${layout.windowSize.height} ` +
        `vs content ${layout.contentSize.width}x${layout.contentSize.height}`,
    );
  }
}
cliLog(`PASS window is frameless (outer ${layout.windowSize.width}x${layout.windowSize.height}, no caption)`);
// The heights come from the app, not from a literal here: a hard-coded 34/78 would
// keep passing if LAYOUT changed and the CSS drifted with it.
if (layout.titleBarHeight !== 34 || layout.chromeHeight !== 78) {
  throw new Error(
    `unexpected strip heights: titleBar=${layout.titleBarHeight} chrome=${layout.chromeHeight}`,
  );
}
if (bounds.y !== layout.titleBarHeight + layout.chromeHeight) {
  throw new Error(
    `page view y=${bounds.y}, expected ${layout.titleBarHeight + layout.chromeHeight}`,
  );
}
cliLog(`PASS page view starts below the ${layout.titleBarHeight}px custom title bar`);
if (bounds.width < 400 || bounds.height < 300) {
  throw new Error(`page view is too small to show a page: ${bounds.width}x${bounds.height}`);
}
if (bounds.x < 180) throw new Error(`page view overlaps the sidebar: x=${bounds.x}`);
// The window is frameless: the self-drawn title bar (with minimize / maximize /
// close) is a fixed strip at the very top. A page view that started above
// titleBarHeight would composite over those buttons and make them unclickable.
// The equality above already implies this, but this states the intent.
if (bounds.y - layout.statusHeight < layout.titleBarHeight) {
  throw new Error(`page view covers the custom title bar: y=${bounds.y}`);
}
if (bounds.x + bounds.width > layout.contentSize.width + 1) {
  throw new Error("page view overflows the window horizontally");
}
// The bottom edge must stop above the status bar, or the last 22px of every page
// covers its controls (the bug this whole geometry exists to prevent).
if (bounds.y + bounds.height > layout.contentSize.height - layout.statusHeight + 1) {
  throw new Error(
    `page view runs into the status bar: bottom ${bounds.y + bounds.height}, ` +
      `content ${layout.contentSize.height}`,
  );
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
// The capture must be THIS window. The old code fell back to a loose /aragon/
// match, so with a packaged build open it returned a picture of that window - a
// >10KB PNG, so every size assertion below stayed green while the test proved
// nothing. The title carries the space id, and the thumbnail is requested at
// exactly 2x the window size, so both are checked.
if (!windowShot.sourceName.includes("ui-check") || !windowShot.sourceName.includes("#")) {
  throw new Error(
    `window capture grabbed the wrong window: "${windowShot.sourceName}" (expected the ui-check space)`,
  );
}
const expectedW = layout.windowSize.width * 2;
const expectedH = layout.windowSize.height * 2;
if (windowShot.size.width !== expectedW || windowShot.size.height !== expectedH) {
  throw new Error(
    `window capture has the wrong geometry: ${windowShot.size.width}x${windowShot.size.height}, ` +
      `expected ${expectedW}x${expectedH} (2x the window) - this is a different window`,
  );
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
