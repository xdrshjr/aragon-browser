import { contextBridge, ipcRenderer } from "electron";

/**
 * The UI bridge. Intentionally tiny and one-directional: call a `ui.*` method,
 * or listen for state pushes. No Node, no kernel internals.
 *
 * There is no per-window space id any more. One window hosts every space, so which
 * space the chrome is showing arrives with the state (`focusedSpaceId`) and changes
 * whenever the rail is clicked.
 */
contextBridge.exposeInMainWorld("aragon", {
  rpc: (method, params) => ipcRenderer.invoke("aragon:rpc", { method, params }),
  getState: () => ipcRenderer.invoke("aragon:state"),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
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
