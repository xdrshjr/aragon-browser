/** Shared geometry, so the UI and the page views never disagree. */
export const LAYOUT = {
  sidebarWidth: 188,
  // The window has no native title bar (`frame: false`), so the renderer draws
  // its own 34px strip at the very top: brand, space name, and the minimize /
  // maximize / close buttons. Keep in sync with `--titlebar-height` in
  // styles.css - if these drift, the page view covers the buttons.
  titleBarHeight: 34,
  chromeHeight: 78,
  // The renderer draws a fixed 22px status bar at the bottom (`--status-height`
  // in styles.css). A page view is a child WebContentsView and composites OVER
  // the window's own web contents, so its bounds must stop above that bar or the
  // last 22px of every page covers it and its controls become unclickable.
  statusHeight: 22,
  minWidth: 720,
  minHeight: 480,
};

export function pageBounds({ width, height }) {
  // Every fixed strip the renderer paints above the page: custom title bar plus
  // the tab strip and toolbar.
  const top = LAYOUT.titleBarHeight + LAYOUT.chromeHeight;
  return {
    x: LAYOUT.sidebarWidth,
    y: top,
    width: Math.max(1, width - LAYOUT.sidebarWidth),
    height: Math.max(1, height - top - LAYOUT.statusHeight),
  };
}
