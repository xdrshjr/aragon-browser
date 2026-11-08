// Diagnostic: why does the out-of-process iframe not splice into the snapshot?
const space = await taskSpace("diag");
const page = await space.newPage(FIXTURE_URL);
await page.waitFor("document.readyState === 'complete'");

const targets = await page.cdp({ method: "Target.getTargets" });
const infos = targets?.result?.targetInfos ?? [];
const iframe = infos.find((info) => info.type === "iframe");
cliLog(`IFRAME ${JSON.stringify(iframe)}`);
if (!iframe) throw new Error("no iframe target at all");

await page.cdp({ method: "DOM.enable" });
try {
  const owner = await page.cdp({
    method: "DOM.getFrameOwner",
    params: { frameId: iframe.targetId },
  });
  cliLog(`OWNER ${JSON.stringify(owner)}`);
} catch (error) {
  cliLog(`OWNER-ERROR ${error.error_code} ${error.message}`);
}

// Does the child session answer AX queries through the flattened session id?
const attached = infos.find((info) => info.type === "iframe");
cliLog(`ATTACHED ${attached?.attached}`);

// And what does the parent frame tree say about child frames?
const tree = await page.cdp({ method: "Page.getFrameTree" });
cliLog(`CHILDFRAMES ${JSON.stringify(tree?.result?.frameTree?.childFrames ?? null)}`);

// Try attaching explicitly and using the returned session.
try {
  const session = await page.cdp({
    method: "Target.attachToTarget",
    params: { targetId: iframe.targetId, flatten: true },
  });
  cliLog(`SESSION ${JSON.stringify(session)}`);
  const ax = await page.cdp({
    method: "Accessibility.enable",
    params: {},
    sessionId: session?.result?.sessionId,
  });
  cliLog(`AX-ENABLE ${JSON.stringify(ax)}`);
  const tree2 = await page.cdp({
    method: "Accessibility.getFullAXTree",
    params: {},
    sessionId: session?.result?.sessionId,
  });
  const nodes = tree2?.result?.nodes ?? [];
  cliLog(`AX-NODES ${nodes.length} ${nodes.map((n) => `${n.role?.value}:${n.name?.value}`).slice(0, 12).join(" | ")}`);
} catch (error) {
  cliLog(`SESSION-ERROR ${error.error_code} ${error.message}`);
}
cliLog("DIAG DONE");
