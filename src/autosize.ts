import { SizeHint, Webview } from "webview-bun";

/**
 * Self-sizing webview windows.
 *
 * A webview can't be asked how tall its content is from the Bun side, so the
 * page measures itself and reports back. Three things make that measurement
 * trustworthy, and all three are load-bearing:
 *
 *  - The window opens at {@link START_HEIGHT}, comfortably above any OS
 *    minimum window height. Open it shorter and the WM silently clamps it, so
 *    the delta below would be measured against a height we never actually had.
 *  - The page reports a *delta* — how much the client area must change — not a
 *    target height. `set_size` sizes the whole frame, so a delta cancels out
 *    the titlebar, which the page has no way to measure.
 *  - The body scrolls, so the measured element may exceed the window and still
 *    report its own height instead of being clipped to the viewport.
 *
 * The page-side half of the contract lives in `./autosize-html`.
 */

/** Opening height, above any OS minimum so the reported delta isn't measured against a clamped window. */
export const START_HEIGHT = 160;

/**
 * Bind the `_grow` callback the page calls with its measured delta.
 *
 * Must be called before `setHTML`, and the window must have been created at
 * {@link START_HEIGHT} for the delta to land on the right height.
 */
export function bindAutosize(webview: Webview, width: number, maxHeight: number): void {
  webview.bind("_grow", (delta: number) => {
    webview.size = {
      width,
      height: Math.min(START_HEIGHT + delta, maxHeight),
      hint: SizeHint.FIXED,
    };
  });
}
