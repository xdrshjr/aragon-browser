import { contextBridge, ipcRenderer } from "electron";

/**
 * The UI bridge. Intentionally tiny and one-directional: call a `ui.*` method,
 * or listen for state pushes. No Node, no kernel internals.
 */
const spaceIdArg = process.argv.find((arg) => arg.startsWith("--aragon-space-id="));
const spaceId = spaceIdArg ? Number(spaceIdArg.split("=")[1]) : null;

contextBridge.exposeInMainWorld("aragon", {
  spaceId,
  rpc: (method, params) => ipcRenderer.invoke("aragon:rpc", { method, params }),
  getState: () => ipcRenderer.invoke("aragon:state"),
  onState: (listener) => {
    const handler = (_event, spaces) => listener(spaces);
    ipcRenderer.on("aragon:state", handler);
    return () => ipcRenderer.removeListener("aragon:state", handler);
  },
  // The window has no native title bar, so minimize / maximize / close are the
  // renderer's buttons. Only the actions below exist; nothing else is reachable.
  windowAction: (action) => ipcRenderer.invoke("aragon:window", action),
  onWindowState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("aragon:window-state", handler);
    return () => ipcRenderer.removeListener("aragon:window-state", handler);
  },
});
