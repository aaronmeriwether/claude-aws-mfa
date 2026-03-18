import { describe, test, expect } from "bun:test";
import type { CachedSession, Config } from "../src/config";

describe("session cache validation", () => {
  function isSessionValid(session: CachedSession | undefined): session is CachedSession {
    if (!session) return false;
    return new Date(session.Expiration).getTime() > Date.now();
  }

  const validSession: CachedSession = {
    AccessKeyId: "ASIATEMP",
    SecretAccessKey: "TempSecret",
    SessionToken: "TempToken",
    Expiration: new Date(Date.now() + 3600_000).toISOString(), // 1 hour from now
  };

  const expiredSession: CachedSession = {
    AccessKeyId: "ASIATEMP",
    SecretAccessKey: "TempSecret",
    SessionToken: "TempToken",
    Expiration: new Date(Date.now() - 1000).toISOString(), // 1 second ago
  };

  test("returns true for unexpired session", () => {
    expect(isSessionValid(validSession)).toBe(true);
  });

  test("returns false for expired session", () => {
    expect(isSessionValid(expiredSession)).toBe(false);
  });

  test("returns false for undefined session", () => {
    expect(isSessionValid(undefined)).toBe(false);
  });

  test("cached session round-trips through config JSON", () => {
    const config: Config = {
      region: "us-west-2",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      mfaArn: "arn:aws:iam::123456789012:mfa/user",
      roleArn: "arn:aws:iam::123456789012:role/TestRole",
      duration: 7200,
      cacheSession: true,
      cachedSession: validSession,
    };

    const json = JSON.stringify(config, null, 2);
    const parsed = JSON.parse(json) as Config;
    expect(parsed.cachedSession).toEqual(validSession);
    expect(parsed.cacheSession).toBe(true);
  });

  test("config without cached session is valid", () => {
    const config: Config = {
      region: "us-west-2",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      mfaArn: "arn:aws:iam::123456789012:mfa/user",
      roleArn: "arn:aws:iam::123456789012:role/TestRole",
      duration: 7200,
    };

    const json = JSON.stringify(config, null, 2);
    const parsed = JSON.parse(json) as Config;
    expect(parsed.cachedSession).toBeUndefined();
    expect(parsed.cacheSession).toBeUndefined();
  });

  test("feature flags round-trip through config JSON", () => {
    const config: Config = {
      region: "us-west-2",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      mfaArn: "arn:aws:iam::123456789012:mfa/user",
      roleArn: "arn:aws:iam::123456789012:role/TestRole",
      duration: 7200,
      cacheSession: true,
      autoMfa: true,
      singleInstanceLock: false,
    };

    const json = JSON.stringify(config, null, 2);
    const parsed = JSON.parse(json) as Config;
    expect(parsed.cacheSession).toBe(true);
    expect(parsed.autoMfa).toBe(true);
    expect(parsed.singleInstanceLock).toBe(false);
  });
});
