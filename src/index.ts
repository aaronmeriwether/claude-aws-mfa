#!/usr/bin/env bun

// Disable WebKitGTK's bubblewrap sandbox on Linux — it requires unprivileged
// user namespaces which are unavailable in many environments (containers,
// restrictive sysctl, etc.).  Bun's process.env doesn't propagate to C-level
// getenv(), so we re-exec with the env var set at the OS level.
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

import { loadConfig, saveConfig, seedDefaults } from "./config";
import { showDialog } from "./dialog";
import { assumeRoleWithMfa } from "./sts";

const defaults = loadConfig() ?? await seedDefaults();

const result = showDialog(defaults);
if (!result) {
  process.stderr.write("User cancelled dialog.\n");
  process.exit(2);
}

try {
  let mfaCode = result.mfaCode;
  if (result.mfaMode === "command") {
    const proc = Bun.spawnSync(["sh", "-c", result.mfaCommand]);
    if (proc.exitCode !== 0) {
      process.stderr.write(`MFA command failed: ${proc.stderr.toString()}\n`);
      process.exit(2);
    }
    mfaCode = proc.stdout.toString().trim();
  }

  const { credentials, duration } = await assumeRoleWithMfa({
    region: result.region,
    accessKeyId: result.accessKeyId,
    secretAccessKey: result.secretAccessKey,
    mfaArn: result.mfaArn,
    roleArn: result.roleArn,
    mfaCode,
    duration: parseInt(result.duration, 10) || 43200,
  });

  saveConfig({
    region: result.region,
    accessKeyId: result.accessKeyId,
    secretAccessKey: result.secretAccessKey,
    mfaArn: result.mfaArn,
    roleArn: result.roleArn,
    duration,
    mfaMode: result.mfaMode,
    mfaCommand: result.mfaCommand || undefined,
  });

  console.log(JSON.stringify({ Credentials: credentials }));
} catch (err) {
  // Mask any AWS access-key IDs or secret keys that may appear in error messages
  const raw = String(err);
  const masked = raw
    .replace(/(?:AKIA|ASIA)[A-Z0-9]{16}/g, "****")
    .replace(/[A-Za-z0-9/+=]{40}/g, "****");
  process.stderr.write(`STS AssumeRole failed: ${masked}\n`);
  process.exit(2);
}
