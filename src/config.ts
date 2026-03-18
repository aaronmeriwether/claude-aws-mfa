import { homedir } from "os";
import { join, dirname } from "path";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "fs";
import { STSClient } from "@aws-sdk/client-sts";

export interface CachedSession {
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
  Expiration: string; // ISO 8601
}

export interface Config {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  mfaArn: string;
  roleArn: string;
  duration: number;
  mfaMode?: "code" | "command";
  mfaCommand?: string;
  cacheSession?: boolean;
  autoMfa?: boolean;
  singleInstanceLock?: boolean;
  cachedSession?: CachedSession;
}

const CONFIG_PATH = join(homedir(), ".config", "claude-aws-mfa.json");

// Unix file-permission enforcement is skipped on Windows where chmod is a no-op.
const IS_UNIX = process.platform !== "win32";

/** Ensure the parent directory exists with 0700 permissions. */
function ensureConfigDir(): void {
  const dir = dirname(CONFIG_PATH);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (err: any) {
    if (err?.code !== "EEXIST") {
      throw new Error(`Cannot create config directory ${dir}: ${err.message}`);
    }
  }
  if (IS_UNIX) {
    const dirPerms = statSync(dir).mode & 0o777;
    if (dirPerms !== 0o700) {
      try {
        chmodSync(dir, 0o700);
      } catch {
        throw new Error(
          `Config directory ${dir} has permissions ${dirPerms.toString(8)} and cannot be fixed — aborting to protect credentials.`,
        );
      }
    }
  }
}

/**
 * Validate permissions on an existing config file.
 * Attempts to fix permissions if incorrect.
 * Throws if the file has bad permissions and they cannot be corrected.
 * Returns false if the file does not exist yet.
 * On Windows, permission checks are skipped (NTFS uses ACLs, not mode bits).
 */
function validateConfigPermissions(): boolean {
  try {
    const st = statSync(CONFIG_PATH);
    if (IS_UNIX) {
      const perms = st.mode & 0o777;
      if (perms !== 0o600) {
        try {
          chmodSync(CONFIG_PATH, 0o600);
        } catch {
          throw new Error(
            `Config file ${CONFIG_PATH} has permissions ${perms.toString(8)} and cannot be fixed — aborting to protect credentials.`,
          );
        }
      }
    }
    return true;
  } catch (err: any) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

export function loadConfig(): Config | null {
  try {
    validateConfigPermissions();
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveConfig(config: Config) {
  ensureConfigDir();

  // Create the file with correct permissions *before* writing content,
  // avoiding a window where the file exists with default-umask permissions.
  if (!validateConfigPermissions()) {
    // File does not exist yet — create it with restrictive permissions first
    const fd = openSync(CONFIG_PATH, "w", 0o600);
    closeSync(fd);
  }

  // File now exists with 0600 — overwrite its content
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

// --- Single-instance lock ---

const LOCK_PATH = join(homedir(), ".config", "claude-aws-mfa.lock");
const LOCK_POLL_MS = 500;
const LOCK_STALE_MS = 120_000; // 2 minutes — assume stale if holder crashed

/**
 * Attempt to acquire an exclusive lock.  Returns true if acquired.
 * Uses O_EXCL to atomically create the lock file.
 */
export function tryAcquireLock(): boolean {
  ensureConfigDir();
  try {
    const fd = openSync(LOCK_PATH, "wx", 0o600);
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch (err: any) {
    if (err?.code === "EEXIST") {
      // Check for stale lock
      try {
        const st = statSync(LOCK_PATH);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          // Stale lock — remove and retry once
          try { rmSync(LOCK_PATH); } catch {}
          return tryAcquireLock();
        }
      } catch {}
      return false;
    }
    throw err;
  }
}

/** Release the lock file. */
export function releaseLock(): void {
  try { rmSync(LOCK_PATH); } catch {}
}

/**
 * Wait until the lock is released, polling every LOCK_POLL_MS.
 * Returns once the lock file disappears (or becomes stale).
 */
export async function waitForLock(): Promise<void> {
  while (true) {
    try {
      const st = statSync(LOCK_PATH);
      if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        // Stale — break out so caller can acquire
        try { rmSync(LOCK_PATH); } catch {}
        return;
      }
    } catch {
      // Lock file gone — we can proceed
      return;
    }
    await Bun.sleep(LOCK_POLL_MS);
  }
}

export async function seedDefaults(): Promise<Partial<Config>> {
  const defaults: Partial<Config> = {};
  try {
    const client = new STSClient({});
    const creds = await client.config.credentials();
    if (creds.accessKeyId) defaults.accessKeyId = creds.accessKeyId;
    if (creds.secretAccessKey) defaults.secretAccessKey = creds.secretAccessKey;
    defaults.region = await client.config.region();
  } catch {}
  return defaults;
}
