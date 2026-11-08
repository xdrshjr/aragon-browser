// Runs against a REAL installed aragon-browser, driven through the PATH shim.
// Asserts the installed build can do the things the README claims.
const version = await browserVersion();
cliLog(`engine=${version.engine}`);
if (version.packaged !== true) throw new Error("not the installed build");

const space = await taskSpace("installed-check");
const page = await space.newPage("https://example.com");
await page.waitForLoad({ timeoutMs: 25000 });

const info = await page.info();
if (info.title !== "Example Domain") {
  throw new Error(`the installed app did not load the page: ${JSON.stringify(info)}`);
}
cliLog("PASS the installed app loaded a real HTTPS page");

const shot = await page.snapshot();
if (!shot.text.includes("Example Domain")) {
  throw new Error(`snapshot missing the page: ${shot.text.slice(0, 300)}`);
}
cliLog(`PASS snapshot rendered (${shot.refCount} ref, ${shot.frameCount} frame(s))`);

// Non-ASCII must survive the whole pipeline: CDP -> kernel -> socket -> CLI.
const accent = await page.evaluate("'中文 accents: é à ü 汉字'");
if (accent !== "中文 accents: é à ü 汉字") {
  throw new Error(`non-ASCII round-trip failed: ${JSON.stringify(accent)}`);
}
cliLog("PASS non-ASCII text survived the full pipeline intact");

const link = shot.refs.find((ref) => ref.role === "link");
if (!link) throw new Error("no link ref on the example page");
// waitForNavigation, not waitForLoad: the old document is already "complete".
const navigation = page.waitForNavigation({ timeoutMs: 25000 });
await page.click(`@${link.ref}`);
await navigation;
const after = await page.info();
if (!after.url.includes("iana.org")) {
  throw new Error(`clicking the link did not navigate: ${after.url}`);
}
cliLog(`PASS clicked @${link.ref} and navigated to ${after.title}`);

await page.screenshot({ save: "artifacts/installed.png" });
cliLog("PASS screenshot written by the installed app");

const learned = await listLearnedSites();
if (learned.sites.length === 0) throw new Error("installed app found no learned sites");
cliLog(`PASS installed app loaded ${learned.sites.length} site skill(s) from resources`);
cliLog("DONE installed");
