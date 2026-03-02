import { homedir } from "os";
import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

export interface ClaudeSettings {
  env?: Record<string, string>;
  [key: string]: unknown;
}

export function loadClaudeSettings(): ClaudeSettings {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function saveClaudeSettings(settings: ClaudeSettings): void {
  const dir = join(homedir(), ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}
