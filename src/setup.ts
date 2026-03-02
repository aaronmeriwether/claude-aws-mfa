import { resolve } from "path";
import { Webview, SizeHint } from "webview-bun";
import { lib } from "webview-bun/src/ffi";
import { loadClaudeSettings, saveClaudeSettings } from "./claude-settings";
import { buildSetupHtml } from "./setup-html";
import { version } from "../package.json";

/** Build the command string that Claude Code should use to invoke this tool. */
function getCredentialExportCommand(): string {
  const script = Bun.argv[1];
  // If the script has a .ts or .js extension, it was launched via interpreter
  if (/\.[tj]sx?$/.test(script)) {
    return `${process.execPath} ${resolve(script)}`;
  }
  // Otherwise it's an installed bin — use the bin path directly
  return script;
}

export function runSetup(): boolean {
  const settings = loadClaudeSettings();
  const env = (settings.env ?? {}) as Record<string, string>;
  const credentialExportCmd = getCredentialExportCommand();

  const webview = new Webview(false, {
    width: 480,
    height: 640,
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
