// Re-exec with WebKitGTK sandbox disabled on Linux (same workaround as src/index.ts).
// Bun's process.env doesn't propagate to C-level getenv(), so we re-exec with
// the env var set at the OS level.
if (process.platform === "linux" && !process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS) {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, ...Bun.argv.slice(1)],
    env: { ...process.env, WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1" },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(proc.exitCode);
}

import { showDialog } from "../src/dialog";

showDialog({});
