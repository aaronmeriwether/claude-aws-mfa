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
import { loadConfig, saveConfig, seedDefaults, tryAcquireLock, releaseLock, waitForLock } from "./config";
import { showDialog } from "./dialog";
import { assumeRoleWithMfa, STANDARD_DURATIONS } from "./sts";

// --- Resolve effective flags (CLI overrides config defaults) ---

const config = loadConfig();
const defaults: Partial<Config> = config ?? await seedDefaults();

const useCache = flags.cacheSession ?? defaults.cacheSession ?? false;
const useAutoMfa = flags.autoMfa ?? defaults.autoMfa ?? false;
const useLock = flags.singleInstanceLock ?? defaults.singleInstanceLock ?? false;

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

// --- Helper: run MFA command and attempt to obtain credentials without dialog ---

async function tryAutoMfa(cfg: Partial<Config>): Promise<CachedSession | null> {
  if (!cfg.mfaCommand || cfg.mfaMode !== "command") return null;
  if (!cfg.region || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.mfaArn || !cfg.roleArn) return null;

  try {
    const proc = Bun.spawnSync(["sh", "-c", cfg.mfaCommand]);
    if (proc.exitCode !== 0) return null;
    const mfaCode = proc.stdout.toString().trim();
    if (!mfaCode) return null;

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
  } catch {
    return null;
  }
}

// --- Helper: show dialog and obtain credentials ---

async function obtainViaDialog(cfg: Partial<Config>): Promise<void> {
  const result = showDialog(cfg);
  if (!result) {
    process.stderr.write("User cancelled dialog.\n");
    process.exit(2);
  }

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
    const session = await tryAutoMfa(defaults);
    if (session) {
      outputCredentials(session);
      process.exit(0);
    }
  }

  // 3. If single-instance-lock is enabled, acquire lock before showing dialog
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
  process.stderr.write(`STS AssumeRole failed: ${masked}\n`);
  process.exit(2);
}
