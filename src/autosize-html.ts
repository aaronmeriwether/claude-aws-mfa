/**
 * Page-side half of the self-sizing window contract (see `./autosize`).
 *
 * Kept free of webview-bun so the HTML builders — and their unit tests — never
 * dlopen the native GUI library, which isn't present on a headless runner.
 */

/**
 * CSS a page must carry for {@link AUTOSIZE_SCRIPT} to measure correctly.
 *
 * `#fit` is the measured element: `height: auto` shrink-wraps it to its
 * content. Page padding belongs on `#fit` rather than `body` so it counts
 * toward that measurement. Keep floated layout out of `#fit` — a float
 * contributes nothing to its parent's height.
 */
export const AUTOSIZE_CSS = /*css*/ `
  html, body { height: 100%; }
  /* always-on scrollbar: lets #fit exceed the window and still report its own height */
  body { overflow-y: scroll; }
  #fit { padding: 20px; }
`;

/** Client-side measurement. Pair with {@link AUTOSIZE_CSS} and a `<div id="fit">` wrapper. */
export const AUTOSIZE_SCRIPT = /*js*/ `
  // Wait for fonts to settle — otherwise reflow moves the height right after we snap to it.
  (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(() => {
    const box = document.getElementById("fit").getBoundingClientRect();
    const delta = Math.ceil(box.height) - innerHeight;
    if (delta) _grow(delta);
  }));
`;
