import { homedir } from "os";
import { join, dirname, resolve, basename } from "path";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
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

/**
 * Suffix that scopes the config (role ARN, keys, cached STS session) to the
 * Claude Code profile in use, since separate profiles generally mean separate
 * AWS accounts — sharing one cached session across them would hand a profile
 * credentials for the wrong account.
 *
 * Empty for the default `~/.claude`, so existing installs keep the unsuffixed
 * file and need no migration. Otherwise the full path is encoded the way Claude
 * encodes project dirs (`/` and `.` both become `-`), rather than the basename,
 * which is not unique across config-dir tools.
 *
 * DETAIL: the encoding is lossy — `/a/b-c` and `/a-b/c` both yield `-a-b-c` —
 * and a hash would not be. That is a deliberate trade: these filenames sit in a
 * directory people read and prune by hand, and approximating the original words
 * is worth more than closing a collision that requires two config dirs whose
 * paths differ only in `/` versus `-`. Claude makes the same trade for
 * `~/.claude/projects`.
 */
export function profileSuffix(dir = process.env.CLAUDE_CONFIG_DIR): string {
  if (!dir) return "";
  const canonical = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const real = canonical(dir);
  if (real === canonical(join(homedir(), ".claude"))) return "";
  return real.replace(/[/.]/g, "-");
}

export interface ActiveProfile {
  name: string;
  path: string;
}

export const DEFAULT_PROFILE: ActiveProfile = { name: "default", path: "~/.claude" };

/**
 * The profile to name in dialog titles and headings. Because the single-instance
 * lock is per-profile, two profiles can have a dialog on screen at once, asking
 * for credentials to different AWS accounts — so which is which has to be
 * visible.
 *
 * The default config dir is named too, rather than left blank: a multi-profile
 * user facing a single unlabelled dialog cannot tell "this is the default
 * profile" from "this build doesn't label profiles".
 */
export function activeProfile(dir = process.env.CLAUDE_CONFIG_DIR): ActiveProfile {
  if (!dir || !profileSuffix(dir)) return DEFAULT_PROFILE;
  const clean = dir.replace(/\/+$/, "");
  const home = homedir();
  return {
    name: basename(clean),
    path: clean === home || clean.startsWith(home + "/") ? "~" + clean.slice(home.length) : clean,
  };
}

const CONFIG_PATH = join(homedir(), ".config", `claude-aws-mfa${profileSuffix()}.json`);

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

// Per-profile too: a profile must not block on, then inherit, another profile's session.
const LOCK_PATH = join(homedir(), ".config", `claude-aws-mfa${profileSuffix()}.lock`);
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

/**
 * Fields required to obtain credentials with no dialog shown at all (used by
 * --no-ui). A static typed-in MFA code can't be reused headlessly, so
 * command mode with a configured mfaCommand is mandatory here.
 */
export function missingConfigFields(cfg: Partial<Config>): string[] {
  const missing: string[] = [];
  if (!cfg.region) missing.push("region");
  if (!cfg.accessKeyId) missing.push("accessKeyId");
  if (!cfg.secretAccessKey) missing.push("secretAccessKey");
  if (!cfg.mfaArn) missing.push("mfaArn");
  if (!cfg.roleArn) missing.push("roleArn");
  if (cfg.mfaMode !== "command" || !cfg.mfaCommand) missing.push("mfaCommand");
  return missing;
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
