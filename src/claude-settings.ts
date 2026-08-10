import { homedir } from "os";
import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

/**
 * Claude Code reads its settings from $CLAUDE_CONFIG_DIR when set, so tools that
 * pin a per-project config dir (e.g. claude-as) get their own settings.json —
 * which is what makes a Bedrock-only profile possible. Child processes inherit
 * the variable, so the credential-export path sees it automatically; `--setup`
 * run from a plain shell does not, and configures the default profile.
 */
export const claudeConfigDir = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

const settingsPath = () => join(claudeConfigDir(), "settings.json");

export interface ClaudeSettings {
  env?: Record<string, string>;
  [key: string]: unknown;
}

export function loadClaudeSettings(): ClaudeSettings {
  try {
    return JSON.parse(readFileSync(settingsPath(), "utf-8"));
  } catch {
    return {};
  }
}

export function saveClaudeSettings(settings: ClaudeSettings): void {
  mkdirSync(claudeConfigDir(), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + "\n");
}
