import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getCredentialExportCommand } from "../src/setup";
import { bin } from "../package.json";

const BIN_NAME = Object.keys(bin)[0];

describe("getCredentialExportCommand", () => {
  const origArgv = Bun.argv;
  const origWhich = Bun.which;
  let tmpDir: string;

  afterEach(() => {
    Bun.argv = origArgv;
    Bun.which = origWhich;
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  test("uses the bare bin name when it resolves via PATH to this same script (bin invoked directly)", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "claude-aws-mfa-setup-test-"));
    const scriptTarget = join(tmpDir, "index.ts");
    writeFileSync(scriptTarget, "");
    // Mirrors real installed-bin behavior: the shim on PATH is a symlink whose
    // target Bun resolves into Bun.argv[1].
    const shim = join(tmpDir, BIN_NAME);
    symlinkSync(scriptTarget, shim);

    Bun.argv = [process.execPath, scriptTarget];
    Bun.which = ((cmd: string) => (cmd === BIN_NAME ? shim : null)) as typeof Bun.which;

    expect(getCredentialExportCommand()).toBe(BIN_NAME);
  });

  test("falls back to an explicit bun+script invocation when not resolvable via PATH", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "claude-aws-mfa-setup-test-"));
    const scriptTarget = join(tmpDir, "index.ts");
    writeFileSync(scriptTarget, "");

    Bun.argv = [process.execPath, scriptTarget];
    Bun.which = (() => null) as typeof Bun.which;

    expect(getCredentialExportCommand()).toBe(`${process.execPath} ${scriptTarget}`);
  });

  test("falls back when PATH resolves the bin name to a different install", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "claude-aws-mfa-setup-test-"));
    const scriptTarget = join(tmpDir, "index.ts");
    const otherInstall = join(tmpDir, "other-index.ts");
    writeFileSync(scriptTarget, "");
    writeFileSync(otherInstall, "");

    Bun.argv = [process.execPath, scriptTarget];
    Bun.which = ((cmd: string) => (cmd === BIN_NAME ? otherInstall : null)) as typeof Bun.which;

    expect(getCredentialExportCommand()).toBe(`${process.execPath} ${scriptTarget}`);
  });
});
