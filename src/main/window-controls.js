/**
 * The three window buttons of the self-drawn title bar.
 *
 * The window is frameless (`frame: false`), so minimize / maximize / close are
 * the renderer's job. This lives outside main.js on purpose: the action mapping
 * is the part that can quietly be wrong (a "maximize" that cannot restore is the
 * classic one), and a plain function taking a window-like object can be tested
 * without launching Electron.
 */

/** Actions the renderer may ask for. Anything else is refused, not ignored. */
export const WINDOW_ACTIONS = new Set(["minimize", "toggle-maximize", "close", "state"]);

export function windowStateOf(window) {
  return {
    maximized: window.isMaximized(),
    fullScreen: window.isFullScreen(),
    focused: window.isFocused(),
  };
}

/**
 * Apply one action to one window and return the state afterwards.
 *
 * For "close" the state is read *before* the call: querying a window that is
 * already destroyed is how this returns a lie, or throws, depending on platform.
 * Unknown actions throw so the caller can answer with a real error instead of
 * pretending the click worked.
 */
export function applyWindowAction(window, action) {
  const name = String(action);
  if (!WINDOW_ACTIONS.has(name)) {
    throw new Error(`unknown window action ${name}`);
  }
  if (name === "close") {
    const before = windowStateOf(window);
    window.close();
    return before;
  }
  switch (name) {
    case "minimize":
      window.minimize();
      break;
    case "toggle-maximize":
      // One button, two meanings: that is what a caption bar does everywhere, and
      // asking the renderer to be right about the current state would make the
      // button wrong exactly when it matters (maximize out of a snapped state).
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      break;
    case "state":
      break;
  }
  return windowStateOf(window);
}
