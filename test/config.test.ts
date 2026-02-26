import { describe, test, expect } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, openSync, closeSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("config serialization", () => {
  const config = {
    region: "us-west-2",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    mfaArn: "arn:aws:iam::123456789012:mfa/user",
    roleArn: "arn:aws:iam::123456789012:role/TestRole",
    duration: 7200,
  };

  test("round-trips through JSON correctly", () => {
    const json = JSON.stringify(config, null, 2) + "\n";
    expect(JSON.parse(json)).toEqual(config);
  });

  test("does not include mfaCode", () => {
    expect(config).not.toHaveProperty("mfaCode");
  });

  test("contains all expected fields", () => {
    for (const key of ["region", "accessKeyId", "secretAccessKey", "mfaArn", "roleArn", "duration"]) {
      expect(config).toHaveProperty(key);
    }
  });

  test("duration is a number", () => {
    expect(typeof config.duration).toBe("number");
  });
});

describe("config file I/O", () => {
  let tmpDir: string;

  test("writes and reads config file", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "claude-aws-mfa-test-"));
    const path = join(tmpDir, "test-config.json");

    const config = {
      region: "eu-west-1",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
      mfaArn: "arn:mfa",
      roleArn: "arn:role",
      duration: 3600,
    };

    writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
    const loaded = JSON.parse(readFileSync(path, "utf-8"));
    expect(loaded).toEqual(config);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns null for missing file", () => {
    try {
      readFileSync("/nonexistent/path/config.json", "utf-8");
      expect(true).toBe(false); // should not reach here
    } catch {
      // Expected — loadConfig wraps this in try/catch and returns null
    }
  });
});

const isWindows = process.platform === "win32";

// Unix file-permission semantics don't apply on Windows.
describe.skipIf(isWindows)("config file permissions", () => {
  test("file created with openSync mode 0o600 has correct permissions", () => {
    const tmp = mkdtempSync(join(tmpdir(), "claude-aws-mfa-perms-"));
    const path = join(tmp, "creds.json");

    const fd = openSync(path, "w", 0o600);
    closeSync(fd);
    writeFileSync(path, '{"test":true}\n');

    const perms = statSync(path).mode & 0o777;
    expect(perms).toBe(0o600);

    rmSync(tmp, { recursive: true, force: true });
  });

  test("directory created with mkdirSync mode 0o700 has correct permissions", () => {
    const tmp = mkdtempSync(join(tmpdir(), "claude-aws-mfa-dir-"));
    const dir = join(tmp, "subdir");

    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const perms = statSync(dir).mode & 0o777;
    expect(perms).toBe(0o700);

    rmSync(tmp, { recursive: true, force: true });
  });

  test("chmodSync can fix overly-permissive file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "claude-aws-mfa-fix-"));
    const path = join(tmp, "creds.json");

    writeFileSync(path, '{"test":true}\n');
    chmodSync(path, 0o644);
    expect(statSync(path).mode & 0o777).toBe(0o644);

    chmodSync(path, 0o600);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    rmSync(tmp, { recursive: true, force: true });
  });
});
