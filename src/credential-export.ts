import { realpathSync } from "fs";
import { resolve } from "path";
import { bin } from "../package.json";

const BIN_NAME = Object.keys(bin)[0];

/**
 * Build the command string that Claude Code should use to invoke this tool.
 *
 * Bun always normalizes Bun.argv[1] to an absolute, symlink-resolved path —
 * identically whether launched via a bare PATH-resolved name, a relative path,
 * or an absolute path — so there's no way to recover how this process was
 * actually invoked. Instead, we check whether the bin name resolves via PATH
 * to this same script; if so Claude Code will resolve it the same way, so we
 * record just the bin name and avoid hardcoding a path that could go stale
 * across reinstalls or machines. Only fall back to an explicit path when this
 * isn't on PATH at all (e.g. running against a local dev checkout).
 *
 * This lives in its own module (rather than setup.ts) so it can be imported
 * without pulling in webview-bun, whose native library is loaded at import
 * time and isn't available in headless/unit-test environments.
 */
export function getCredentialExportCommand(): string {
  const script = Bun.argv[1];
  const onPath = Bun.which(BIN_NAME);
  if (onPath) {
    try {
      if (realpathSync(onPath) === realpathSync(script)) return BIN_NAME;
    } catch {}
  }
  return `${process.execPath} ${resolve(script)}`;
}
