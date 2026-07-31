import { Webview, SizeHint } from "webview-bun";
import { lib } from "webview-bun/src/ffi";
import { loadClaudeSettings, saveClaudeSettings } from "./claude-settings";
import { buildSetupHtml } from "./setup-html";
import { getCredentialExportCommand } from "./credential-export";
import { START_HEIGHT, bindAutosize } from "./autosize";
import { version } from "../package.json";

const SETUP_WIDTH = 480;
const SETUP_MAX_HEIGHT = 720;

export function runSetup(): boolean {
  const settings = loadClaudeSettings();
  const env = (settings.env ?? {}) as Record<string, string>;
  const credentialExportCmd = getCredentialExportCommand();

  const webview = new Webview(false, {
    width: SETUP_WIDTH,
    height: START_HEIGHT,
    hint: SizeHint.FIXED,
  });
  webview.title = `Claude Code Bedrock Setup v${version}`;
  bindAutosize(webview, SETUP_WIDTH, SETUP_MAX_HEIGHT);

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
