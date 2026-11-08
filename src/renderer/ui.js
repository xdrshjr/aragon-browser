const els = {
  titlebar: document.getElementById("titlebar"),
  titleSpace: document.getElementById("tb-space"),
  winMin: document.getElementById("win-min"),
  winMax: document.getElementById("win-max"),
  winClose: document.getElementById("win-close"),
  spaceList: document.getElementById("space-list"),
  newSpace: document.getElementById("new-space"),
  tabs: document.getElementById("tabs"),
  back: document.getElementById("back"),
  forward: document.getElementById("forward"),
  reload: document.getElementById("reload"),
  address: document.getElementById("address"),
  owner: document.getElementById("owner"),
  handoff: document.getElementById("handoff"),
  status: document.getElementById("status"),
  agentState: document.getElementById("agent-state"),
  engine: document.getElementById("engine"),
  runtime: document.getElementById("runtime"),
};

let spaces = [];
// One window, many spaces: the rail switches which space the window shows. This
// id is the window's focused space, pushed by the main process - a window is no
// longer pinned to a single space at creation time.
let focusedSpaceId = null;

function currentSpace() {
  return (
    spaces.find((space) => space.id === focusedSpaceId) ??
    spaces.find((space) => space.focused) ??
    spaces[0] ??
    null
  );
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

async function rpc(method, params = {}) {
  // The main process refuses a spaceId that disagrees with the focused space, so
  // always send the one on screen - but only when there is one. Before the first
  // state push `focusedSpaceId` is null, and `spaceId: null` is not "unset" on the
  // other side: it would be read as a foreign space and refused.
  const payload =
    params.spaceId === undefined && Number.isInteger(focusedSpaceId)
      ? { spaceId: focusedSpaceId, ...params }
      : { ...params };
  const response = await window.aragon.rpc(method, payload);
  if (!response?.ok) {
    setStatus(response?.error?.message ?? "rpc failed", true);
    return null;
  }
  return response.result;
}

function renderSidebar() {
  els.spaceList.replaceChildren();
  for (const space of spaces) {
    const li = document.createElement("li");
    li.dataset.owner = space.owner;
    li.dataset.state = space.agentState;
    if (space.id === focusedSpaceId) li.classList.add("current");
    li.innerHTML = `
      <span class="dot"></span>
      <span class="name"></span>
      <span class="tabs">${space.tabs.length}</span>
      <span class="close" title="close space">✕</span>`;
    li.querySelector(".name").textContent = space.name;
    li.title = `space ${space.id} · ${space.owner} · ${space.agentState}`;
    li.addEventListener("click", (event) => {
      // The ✕ is the only destructive control in the rail, so it must not also
      // count as "switch to this space".
      if (event.target.classList.contains("close")) {
        void rpc("ui.closeSpace", { spaceId: space.id });
        return;
      }
      if (space.id === focusedSpaceId) return;
      // In-window switch. There is no sibling window to focus.
      void rpc("ui.focusSpace", { spaceId: space.id });
    });
    els.spaceList.append(li);
  }
}

function renderChrome() {
  const space = currentSpace();
  if (!space) return;
  els.owner.textContent = space.owner;
  els.owner.dataset.owner = space.owner;
  els.handoff.textContent = space.owner === "agent" ? "give to user" : "take back";
  els.agentState.textContent = `agent: ${space.agentState}`;
  // The window is frameless, so this title bar line is the only place the
  // human can see which space this window is - the OS caption is gone. It is also
  // truncated at the minimum width, so keep the full text in a tooltip.
  els.titleSpace.textContent = `space ${space.id} · ${space.name} · ${space.owner}`;
  els.titleSpace.title = els.titleSpace.textContent;

  els.tabs.replaceChildren();
  for (const tab of space.tabs) {
    const div = document.createElement("div");
    div.className = `tab${tab.active ? " active" : ""}`;
    div.innerHTML = `<span class="label"></span><span class="close">✕</span>`;
    const label = div.querySelector(".label");
    label.textContent = tab.title || tab.url || "new tab";
    div.title = tab.url;
    div.addEventListener("click", (event) => {
      if (event.target.classList.contains("close")) {
        void rpc("ui.closeTab", { spaceId: space.id, tabId: tab.id });
        return;
      }
      void rpc("ui.activateTab", { spaceId: space.id, tabId: tab.id });
    });
    els.tabs.append(div);
  }

  const active = space.tabs.find((tab) => tab.active);
  if (active && document.activeElement !== els.address) {
    els.address.value = active.url === "about:blank" ? "" : active.url;
  }
}

function applyState(next) {
  // Two shapes are accepted on purpose: the initial `aragon:state` IPC reply and
  // the pushed update both carry `{ spaces, focusedSpaceId }`, while an older
  // build only pushed the array. Reading both keeps a stale preload from blanking
  // the window.
  if (Array.isArray(next)) {
    spaces = next;
  } else if (next && typeof next === "object") {
    if (Array.isArray(next.spaces)) spaces = next.spaces;
    if (Number.isInteger(next.focusedSpaceId)) focusedSpaceId = next.focusedSpaceId;
  }
  if (focusedSpaceId === null || !spaces.some((space) => space.id === focusedSpaceId)) {
    focusedSpaceId = spaces.find((space) => space.focused)?.id ?? spaces[0]?.id ?? null;
  }
  renderSidebar();
  renderChrome();
  // Keep the "showing …" line honest as the focused space changes, but never
  // overwrite a real status message (a navigation result, an error).
  if (els.status.textContent === "" || els.status.textContent.startsWith("showing ")) {
    setStatus(describeFocused());
  }
}

function describeFocused() {
  const space = currentSpace();
  if (!space) return spaces.length === 0 ? "no space open" : "ready";
  return `showing space ${space.id} · ${space.name} · ${spaces.length} in the rail`;
}

async function navigate() {
  const raw = els.address.value.trim();
  if (!raw) return;
  const target = /^[a-z][a-z0-9+.-]*:/i.test(raw)
    ? raw
    : /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(raw)
      ? `http://${raw}`
      : raw.includes(" ") || !raw.includes(".")
        ? `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`
        : `https://${raw}`;
  const space = currentSpace();
  if (!space) return;
  if (space.tabs.length === 0) {
    await rpc("ui.newTab", { spaceId: space.id, url: target });
  } else {
    await rpc("ui.navigate", { spaceId: space.id, url: target });
  }
  setStatus(`→ ${target}`);
}

els.address.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void navigate();
  if (event.key === "Escape") els.address.blur();
});
els.address.addEventListener("focus", () => els.address.select());

els.back.addEventListener("click", async () => {
  const space = currentSpace();
  if (!space) return;
  const result = await rpc("ui.goBack", { spaceId: space.id });
  setStatus(result?.ok === false ? "no previous page" : "back");
});
els.forward.addEventListener("click", async () => {
  const space = currentSpace();
  if (!space) return;
  const result = await rpc("ui.goForward", { spaceId: space.id });
  setStatus(result?.ok === false ? "no forward page" : "forward");
});
els.reload.addEventListener("click", () => {
  const space = currentSpace();
  if (space?.tabs.length) void navigate();
});
els.handoff.addEventListener("click", async () => {
  const space = currentSpace();
  if (!space) return;
  const method = space.owner === "agent" ? "ui.handOff" : "ui.takeOver";
  await rpc(method, { spaceId: space.id });
});
els.newSpace.addEventListener("click", async () => {
  await rpc("ui.newSpace", { name: `space-${spaces.length + 1}` });
});

// --- window controls -------------------------------------------------------
// The window has no native caption, so these three buttons are the only way to
// minimize, maximize/restore and close it. Clicking the strip itself must not
// drag-stack up: the buttons are no-drag in CSS, and a double click on the drag
// region is the OS's own "maximize" gesture, which Electron handles for us.
function applyWindowState(state) {
  // Full screen also swallows the maximize button (maximize is a no-op there), so
  // it has to show as "restore" too or the button becomes a dead control that
  // claims the window is not maximized while it covers the whole screen.
  const maximized = Boolean(state?.maximized || state?.fullScreen);
  els.winMax.classList.toggle("maximized", maximized);
  els.winMax.title = maximized ? "restore" : "maximize";
  els.winMax.setAttribute("aria-label", maximized ? "restore" : "maximize");
}

for (const [button, action] of [
  [els.winMin, "minimize"],
  [els.winMax, "toggle-maximize"],
  [els.winClose, "close"],
]) {
  button.addEventListener("click", async () => {
    const response = await window.aragon.windowAction(action);
    if (!response?.ok) {
      setStatus(response?.error?.message ?? `window ${action} failed`, true);
      return;
    }
    // `toggle-maximize` reads the state immediately after asking, which on Windows
    // is before the maximize event lands - applying that reply would flip the glyph
    // back to "maximize" for a frame. The pushed state is the truth.
    if (action !== "toggle-maximize") applyWindowState(response.result);
  });
}

window.aragon.onWindowState((state) => applyWindowState(state));

window.aragon.onState((next) => applyState(next));

const initial = await window.aragon.getState();
applyState(initial);
spaceIdLabel(initial);
// A window can open already maximized (or be restored that way); ask once so the
// button does not show the wrong glyph until something resizes. A failed read must
// not be applied: `undefined` would silently claim "not maximized".
const initialWindow = await window.aragon.windowAction("state");
if (initialWindow?.ok) applyWindowState(initialWindow.result);

function spaceIdLabel(state) {
  els.engine.textContent = `nano · ${state.engine ?? ""}`;
  els.runtime.textContent = state.runtimeFile ?? "";
  setStatus(describeFocused());
}
