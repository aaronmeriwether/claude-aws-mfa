import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Subprocess } from "bun";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SCREENSHOT_DIR = join(import.meta.dir, "screenshots");

/**
 * Count distinct colors in the center 60% of an RGBA image buffer.
 * Quantizes to 4-bit per channel and samples every 3rd pixel.
 */
function countCenterColors(
  rgba: Buffer,
  width: number,
  height: number,
): number {
  const xStart = Math.floor(width * 0.2);
  const xEnd = Math.floor(width * 0.8);
  const yStart = Math.floor(height * 0.2);
  const yEnd = Math.floor(height * 0.8);

  const colors = new Set<number>();

  for (let y = yStart; y < yEnd; y += 3) {
    for (let x = xStart; x < xEnd; x += 3) {
      const i = (y * width + x) * 4;
      const r = rgba[i] >> 4;
      const g = rgba[i + 1] >> 4;
      const b = rgba[i + 2] >> 4;
      colors.add((r << 8) | (g << 4) | b);
    }
  }

  return colors.size;
}

describe.skipIf(!process.env.GUI_TEST)("GUI screenshot tests", () => {
  let proc: Subprocess;
  let windowModule: typeof import("node-screenshots");
  let foundWindow: InstanceType<
    typeof import("node-screenshots").Window
  > | null = null;

  beforeAll(async () => {
    windowModule = await import("node-screenshots");

    mkdirSync(SCREENSHOT_DIR, { recursive: true });

    // Spawn the dialog as a background process
    proc = Bun.spawn(["bun", join(import.meta.dir, "gui-launch.ts")], {
      stdout: "inherit",
      stderr: "inherit",
    });

    // Poll for the window to appear (up to 15s)
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const windows = windowModule.Window.all();
      const match = windows.find((w) => {
        try { return w.title()?.includes("Claude AWS MFA"); }
        catch { return false; }
      });
      if (match) {
        foundWindow = match;
        break;
      }
      await Bun.sleep(500);
    }
  });

  afterAll(() => {
    proc?.kill();
  });

  test("app launches without error", () => {
    // The subprocess should still be running (exitCode is null while alive)
    expect(proc.exitCode).toBeNull();
  });

  test("window appears in window manager", () => {
    expect(foundWindow).not.toBeNull();
    expect(foundWindow!.title()).toContain("Claude AWS MFA");
  });

  test("window content is non-uniform", () => {
    expect(foundWindow).not.toBeNull();

    const image = foundWindow!.captureImageSync();
    const width = image.width;
    const height = image.height;
    const rgba = image.toRawSync();

    // Save screenshot for debugging
    const png = image.toPngSync();
    const screenshotPath = join(SCREENSHOT_DIR, `dialog-${process.platform}.png`);
    Bun.writeSync(
      Bun.openSync(screenshotPath, "w"),
      png,
    );
    console.log(`Screenshot saved to ${screenshotPath}`);

    const uniqueColors = countCenterColors(rgba, width, height);
    console.log(`Unique colors in center region: ${uniqueColors}`);

    // A rendered form has dozens of distinct colors; a blank window has ~1
    expect(uniqueColors).toBeGreaterThan(5);
  });
});
