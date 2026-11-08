const els = {
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

const spaceId = window.aragon?.spaceId ?? null;
let spaces = [];

function currentSpace() {
  return spaces.find((space) => space.id === spaceId) ?? null;
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

async function rpc(method, params = {}) {
  const response = await window.aragon.rpc(method, { spaceId, ...params });
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
    if (space.id === spaceId) li.classList.add("current");
    li.innerHTML = `
      <span class="dot"></span>
      <span class="name"></span>
      <span class="tabs">${space.tabs.length}</span>`;
    li.querySelector(".name").textContent = space.name;
    li.title = `space ${space.id} · ${space.owner} · ${space.agentState}`;
    li.addEventListener("click", () => {
      if (space.id === spaceId) return;
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

function applyState(nextSpaces) {
  if (Array.isArray(nextSpaces)) spaces = nextSpaces;
  renderSidebar();
  renderChrome();
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

window.aragon.onState((next) => applyState(next));

const initial = await window.aragon.getState();
spaceIdLabel(initial);
applyState(initial.spaces);

function spaceIdLabel(state) {
  els.engine.textContent = `nano · ${state.engine ?? ""}`;
  els.runtime.textContent = state.runtimeFile ?? "";
  setStatus(`space ${spaceId ?? "?"} ready · window ${window.aragon.spaceId}`);
}
