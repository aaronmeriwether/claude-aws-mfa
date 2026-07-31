import { realpathSync } from "fs";
import { resolve } from "path";
import { Webview, SizeHint } from "webview-bun";
import { lib } from "webview-bun/src/ffi";
import { loadClaudeSettings, saveClaudeSettings } from "./claude-settings";
import { buildSetupHtml } from "./setup-html";
import { version, bin } from "../package.json";

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

export function runSetup(): boolean {
  const settings = loadClaudeSettings();
  const env = (settings.env ?? {}) as Record<string, string>;
  const credentialExportCmd = getCredentialExportCommand();

  const webview = new Webview(false, {
    width: 480,
    height: 480,
    hint: SizeHint.FIXED,
  });
  webview.title = `Claude Code Bedrock Setup v${version}`;

  let saved = false;
  const handle = webview.unsafeHandle;

  webview.bind("_submit", (json: string) => {
    const { env: envChanges, top: topChanges } = JSON.parse(json) as {
      env: Record<string, string | null>;
      top: Record<string, string | null>;
    };

    // Re-load settings in case they changed while the dialog was open
    const current = loadClaudeSettings();
    const currentEnv = (current.env ?? {}) as Record<string, string>;

    for (const [key, value] of Object.entries(envChanges)) {
      if (value === null) {
        delete currentEnv[key];
      } else {
        currentEnv[key] = value;
      }
    }
    current.env = currentEnv;

    for (const [key, value] of Object.entries(topChanges)) {
      if (value === null) {
        delete current[key];
      } else {
        (current as Record<string, unknown>)[key] = value;
      }
    }

    saveClaudeSettings(current);
    saved = true;
    lib.symbols.webview_terminate(handle);
  });

  webview.bind("_cancel", () => lib.symbols.webview_terminate(handle));

  webview.setHTML(buildSetupHtml(env, settings, credentialExportCmd));
  webview.run();

  return saved;
}
