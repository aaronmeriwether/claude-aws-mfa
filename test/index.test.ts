import { describe, test, expect } from "bun:test";
import { parseFlags } from "../src/flags";

describe("parseFlags", () => {
  // argv[0] is the runtime, argv[1] is the script — flags start at index 2
  const base = ["/usr/bin/bun", "/path/to/index.ts"];

  test("returns defaults when no flags", () => {
    const flags = parseFlags(base);
    expect(flags.setup).toBe(false);
    expect(flags.cacheSession).toBeUndefined();
    expect(flags.autoMfa).toBeUndefined();
    expect(flags.singleInstanceLock).toBeUndefined();
  });

  test("parses --setup", () => {
    expect(parseFlags([...base, "--setup"]).setup).toBe(true);
    expect(parseFlags([...base, "setup"]).setup).toBe(true);
  });

  test("parses --cache-session and --no-cache-session", () => {
    expect(parseFlags([...base, "--cache-session"]).cacheSession).toBe(true);
    expect(parseFlags([...base, "--no-cache-session"]).cacheSession).toBe(false);
  });

  test("parses --auto-mfa and --no-auto-mfa", () => {
    expect(parseFlags([...base, "--auto-mfa"]).autoMfa).toBe(true);
    expect(parseFlags([...base, "--no-auto-mfa"]).autoMfa).toBe(false);
  });

  test("parses --single-instance-lock and --no-single-instance-lock", () => {
    expect(parseFlags([...base, "--single-instance-lock"]).singleInstanceLock).toBe(true);
    expect(parseFlags([...base, "--no-single-instance-lock"]).singleInstanceLock).toBe(false);
  });

  test("last flag wins for conflicting flags", () => {
    const flags = parseFlags([...base, "--cache-session", "--no-cache-session"]);
    expect(flags.cacheSession).toBe(false);
  });

  test("parses multiple flags together", () => {
    const flags = parseFlags([...base, "--cache-session", "--auto-mfa", "--single-instance-lock"]);
    expect(flags.cacheSession).toBe(true);
    expect(flags.autoMfa).toBe(true);
    expect(flags.singleInstanceLock).toBe(true);
  });

  test("ignores unknown flags", () => {
    const flags = parseFlags([...base, "--unknown-flag", "--cache-session"]);
    expect(flags.cacheSession).toBe(true);
    expect(flags.setup).toBe(false);
  });
});
