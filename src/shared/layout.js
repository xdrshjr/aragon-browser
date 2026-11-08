/** Shared geometry, so the UI and the page views never disagree. */
export const LAYOUT = {
  sidebarWidth: 188,
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
  return {
    x: LAYOUT.sidebarWidth,
    y: LAYOUT.chromeHeight,
    width: Math.max(1, width - LAYOUT.sidebarWidth),
    height: Math.max(1, height - LAYOUT.chromeHeight - LAYOUT.statusHeight),
  };
}
