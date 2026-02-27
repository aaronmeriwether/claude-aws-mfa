import { Webview, SizeHint } from "webview-bun";
import { lib } from "webview-bun/src/ffi";
import type { Config } from "./config";
import { buildHtml } from "./dialog-html";
import { version } from "../package.json";

/**
 * On Linux, WebKitGTK uses bubblewrap (bwrap) to sandbox web processes.
 * If user namespaces are unavailable (containers, restrictive sysctl, etc.)
 * the sandbox setup fails and the process crashes. Since we only render a
 * local HTML form, we can safely disable the sandbox in those environments.
 */
function ensureWebkitSandboxCompat(): void {
  if (process.platform !== "linux") return;
  if (process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS) return;

  try {
    const result = Bun.spawnSync(["bwrap", "--ro-bind", "/", "/", "true"]);
    if (result.exitCode !== 0) {
      process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS = "1";
    }
  } catch {
    // bwrap not found or other error — disable sandbox to be safe.
    process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS = "1";
  }
}

export interface DialogResult {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  mfaArn: string;
  roleArn: string;
  duration: string;
  mfaMode: "code" | "command";
  mfaCode: string;
  mfaCommand: string;
}

/** Build the clipboard-read command with absolute paths where possible. */
function clipboardCommand(): string[] {
  if (process.platform === "darwin") {
    return ["/usr/bin/pbpaste"];
  }
  if (process.platform === "win32") {
    // Construct absolute path to powershell.exe from the system root.
    const root = process.env.SystemRoot ?? "C:\\Windows";
    return [`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, "-Command", "Get-Clipboard"];
  }
  // Linux — xclip path is not standardised; rely on PATH here.
  return ["xclip", "-selection", "clipboard", "-o"];
}

export function showDialog(defaults: Partial<Config>): DialogResult | null {
  ensureWebkitSandboxCompat();

  const webview = new Webview(false, {
    width: 440,
    height: 670,
    hint: SizeHint.FIXED,
  });
  webview.title = `Claude AWS MFA v${version}`;

  let result: DialogResult | null = null;

  // Must call webview_terminate (not destroy) from callbacks — run() handles
  // destroy on return.
  const handle = webview.unsafeHandle;

  webview.bind("_submit", (json: string) => {
    result = JSON.parse(json);
    lib.symbols.webview_terminate(handle);
  });

  webview.bind("_cancel", () => lib.symbols.webview_terminate(handle));

  // Fallback clipboard reader: spawn a platform-specific helper.
  // The HTML-side paste handler tries navigator.clipboard.readText() first
  // (no external process needed) and only calls _paste() if that fails.
  const cmd = clipboardCommand();
  webview.bind("_paste", () => {
    const proc = Bun.spawnSync(cmd);
    return proc.stdout.toString();
  });

  webview.setHTML(buildHtml({
    region: defaults.region ?? "",
    accessKeyId: defaults.accessKeyId ?? "",
    secretAccessKey: defaults.secretAccessKey ?? "",
    mfaArn: defaults.mfaArn ?? "",
    roleArn: defaults.roleArn ?? "",
    duration: String(defaults.duration ?? 43200),
    mfaCommand: defaults.mfaCommand ?? "",
    mfaMode: defaults.mfaMode ?? "code",
  }));

  webview.run();
  return result;
}
