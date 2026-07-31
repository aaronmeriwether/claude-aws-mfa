import { describe, test, expect } from "bun:test";
import { AUTOSIZE_CSS, AUTOSIZE_SCRIPT } from "../src/autosize-html";
import { buildHtml, buildErrorHtml } from "../src/dialog-html";
import { buildSetupHtml } from "../src/setup-html";

const PAGES: Record<string, string> = {
  dialog: buildHtml({ region: "us-east-1" }),
  error: buildErrorHtml("something went wrong"),
  setup: buildSetupHtml({}, {}, "claude-aws-mfa"),
};

describe("autosize contract", () => {
  for (const [name, html] of Object.entries(PAGES)) {
    describe(name, () => {
      test("carries the measurement CSS and script", () => {
        expect(html).toContain(AUTOSIZE_CSS);
        expect(html).toContain(AUTOSIZE_SCRIPT);
      });

      test("wraps its content in the measured #fit element", () => {
        expect(html).toContain(`<div id="fit">`);
        // The wrapper must close before </body>, or it would measure nothing.
        expect(html.indexOf(`<div id="fit">`)).toBeLessThan(html.indexOf("</body>"));
      });

      test("keeps page padding on #fit, not body", () => {
        // Padding on body sits outside #fit's box and would be measured away.
        const bodyRule = html.match(/\n  body \{[^}]*\}/)?.[0] ?? "";
        expect(bodyRule).not.toContain("padding");
      });
    });
  }
});

describe("AUTOSIZE_SCRIPT", () => {
  test("reports a delta rather than an absolute height", () => {
    // set_size sizes the whole frame; only a delta cancels out the titlebar.
    expect(AUTOSIZE_SCRIPT).toContain("- innerHeight");
    expect(AUTOSIZE_SCRIPT).toContain("_grow(delta)");
  });

  test("waits for fonts before measuring", () => {
    expect(AUTOSIZE_SCRIPT).toContain("document.fonts?.ready");
    expect(AUTOSIZE_SCRIPT).toContain("requestAnimationFrame");
  });

  test("skips the resize when the content already fits", () => {
    expect(AUTOSIZE_SCRIPT).toContain("if (delta)");
  });
});

describe("AUTOSIZE_CSS", () => {
  test("keeps the body scrollable so #fit can exceed the viewport", () => {
    expect(AUTOSIZE_CSS).toContain("overflow-y: scroll");
  });
});
