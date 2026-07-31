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

import { parseFlags } from "./flags";

const flags = parseFlags(process.argv);

if (flags.setup) {
  const { runSetup } = await import("./setup");
  process.exit(runSetup() ? 0 : 2);
}

import type { CachedSession, Config } from "./config";
import { loadConfig, saveConfig, seedDefaults, tryAcquireLock, releaseLock, waitForLock, missingConfigFields } from "./config";
import { assumeRoleWithMfa, STANDARD_DURATIONS } from "./sts";

// --- Resolve effective flags (CLI overrides config defaults) ---

const config = loadConfig();
const defaults: Partial<Config> = config ?? await seedDefaults();

const useCache = flags.cacheSession ?? defaults.cacheSession ?? true;
const useAutoMfa = flags.autoMfa ?? defaults.autoMfa ?? true;
const useLock = flags.singleInstanceLock ?? defaults.singleInstanceLock ?? true;

// --- Helper: check if a cached session is still valid ---

function isSessionValid(session: CachedSession | undefined): session is CachedSession {
  if (!session) return false;
  return new Date(session.Expiration).getTime() > Date.now();
}

// --- Helper: output credentials and save config ---

function outputCredentials(session: CachedSession): void {
  console.log(JSON.stringify({
    Credentials: {
      AccessKeyId: session.AccessKeyId,
      SecretAccessKey: session.SecretAccessKey,
      SessionToken: session.SessionToken,
    },
  }));
}

// --- Helper: report a failure, respecting --no-ui (dialog is never shown in that mode) ---

async function reportFailure(message: string): Promise<never> {
  if (flags.noUi) {
    // stdout is reserved for cleanly-parsable credentials JSON on success.
    process.stderr.write(`${message}\n`);
  } else {
    const { showErrorDialog } = await import("./dialog");
    showErrorDialog(message);
  }
  process.exit(2);
}

// --- Helper: run MFA command and attempt to obtain credentials without dialog ---
// Throws (rather than returning null) on failure so callers can decide whether to
// fall back to the dialog (interactive) or surface the error directly (--no-ui).

async function tryAutoMfa(cfg: Partial<Config>): Promise<CachedSession | null> {
  if (!cfg.mfaCommand || cfg.mfaMode !== "command") return null;
  if (!cfg.region || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.mfaArn || !cfg.roleArn) return null;

  const proc = Bun.spawnSync(["sh", "-c", cfg.mfaCommand]);
  if (proc.exitCode !== 0) {
    throw new Error(`MFA command failed: ${proc.stderr.toString().trim()}`);
  }
  const mfaCode = proc.stdout.toString().trim();
  if (!mfaCode) throw new Error("MFA command produced no output");

  const { credentials, duration } = await assumeRoleWithMfa({
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    mfaArn: cfg.mfaArn,
    roleArn: cfg.roleArn,
    mfaCode,
    duration: cfg.duration ?? STANDARD_DURATIONS[0],
  });

  const session: CachedSession = {
    AccessKeyId: credentials.AccessKeyId,
    SecretAccessKey: credentials.SecretAccessKey,
    SessionToken: credentials.SessionToken,
    Expiration: credentials.Expiration,
  };

  saveConfig({
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    mfaArn: cfg.mfaArn,
    roleArn: cfg.roleArn,
    duration,
    mfaMode: cfg.mfaMode,
    mfaCommand: cfg.mfaCommand,
    cacheSession: cfg.cacheSession,
    autoMfa: cfg.autoMfa,
    singleInstanceLock: cfg.singleInstanceLock,
    ...(useCache ? { cachedSession: session } : {}),
  });

  return session;
}

// --- Helper: show dialog and obtain credentials ---

async function obtainViaDialog(cfg: Partial<Config>): Promise<void> {
  const { showDialog } = await import("./dialog");
  const result = showDialog(cfg);
  if (!result) {
    process.stderr.write("User cancelled dialog.\n");
    process.exit(2);
  }

  let mfaCode = result.mfaCode;
  if (result.mfaMode === "command") {
    const proc = Bun.spawnSync(["sh", "-c", result.mfaCommand]);
    if (proc.exitCode !== 0) {
      throw new Error(`MFA command failed: ${proc.stderr.toString().trim()}`);
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
    duration: parseInt(result.duration, 10) || STANDARD_DURATIONS[0],
  });

  const session: CachedSession = {
    AccessKeyId: credentials.AccessKeyId,
    SecretAccessKey: credentials.SecretAccessKey,
    SessionToken: credentials.SessionToken,
    Expiration: credentials.Expiration,
  };

  saveConfig({
    region: result.region,
    accessKeyId: result.accessKeyId,
    secretAccessKey: result.secretAccessKey,
    mfaArn: result.mfaArn,
    roleArn: result.roleArn,
    duration,
    mfaMode: result.mfaMode,
    mfaCommand: result.mfaCommand || undefined,
    cacheSession: defaults.cacheSession,
    autoMfa: defaults.autoMfa,
    singleInstanceLock: defaults.singleInstanceLock,
    ...(useCache ? { cachedSession: session } : {}),
  });

  outputCredentials(session);
}

// --- Main flow ---

try {
  // 1. If cache-session is enabled, check for unexpired cached credentials
  if (useCache && config?.cachedSession) {
    if (isSessionValid(config.cachedSession)) {
      // Return cached credentials without showing dialog
      outputCredentials(config.cachedSession);
      process.exit(0);
    }
    // Expired — clear the cached session
    saveConfig({ ...config, cachedSession: undefined });
  }

  // 2. If auto-mfa is enabled, try to obtain credentials without dialog
  if (useAutoMfa) {
    try {
      const session = await tryAutoMfa(defaults);
      if (session) {
        outputCredentials(session);
        process.exit(0);
      }
    } catch (err) {
      // In --no-ui mode there's no dialog to fall back to — surface the error directly.
      if (flags.noUi) throw err;
    }
  }

  // 3. In --no-ui mode, never show a dialog — report why credentials couldn't be obtained.
  if (flags.noUi) {
    const missing = missingConfigFields(defaults);
    if (missing.length) {
      await reportFailure(`Missing config: ${missing.join(", ")}`);
    } else {
      await reportFailure("Unable to obtain credentials without UI: auto-MFA did not succeed.");
    }
  }

  // 4. If single-instance-lock is enabled, acquire lock before showing dialog
  if (useLock) {
    if (!tryAcquireLock()) {
      // Another instance holds the lock — wait for it
      process.stderr.write("Waiting for another instance to finish...\n");
      await waitForLock();

      // After lock releases, re-check cached session (another instance may have refreshed it)
      if (useCache) {
        const freshConfig = loadConfig();
        if (freshConfig?.cachedSession && isSessionValid(freshConfig.cachedSession)) {
          outputCredentials(freshConfig.cachedSession);
          process.exit(0);
        }
      }

      // Still need credentials — acquire lock and show dialog
      if (!tryAcquireLock()) {
        // Edge case: another waiter grabbed the lock first — wait again
        await waitForLock();
        if (useCache) {
          const freshConfig = loadConfig();
          if (freshConfig?.cachedSession && isSessionValid(freshConfig.cachedSession)) {
            outputCredentials(freshConfig.cachedSession);
            process.exit(0);
          }
        }
        // Final attempt to acquire — proceed regardless
        tryAcquireLock();
      }
    }

    try {
      await obtainViaDialog(defaults);
    } finally {
      releaseLock();
    }
  } else {
    // No lock — just show dialog directly
    await obtainViaDialog(defaults);
  }
} catch (err) {
  if (useLock) releaseLock();
  // Mask any AWS access-key IDs or secret keys that may appear in error messages
  const raw = String(err);
  const masked = raw
    .replace(/(?:AKIA|ASIA)[A-Z0-9]{16}/g, "****")
    .replace(/[A-Za-z0-9/+=]{40}/g, "****");
  // Claude Code does not surface stderr to the user, so failures are reported via
  // a dialog box instead (or to stderr in --no-ui mode, keeping stdout parsable).
  await reportFailure(`Authentication failed: ${masked}`);
}
