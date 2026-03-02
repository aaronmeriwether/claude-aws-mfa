import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock AWS SDK before importing sts module.
let mockSend: ReturnType<typeof mock>;
const capturedCommands: any[] = [];

mock.module("@aws-sdk/client-sts", () => {
  return {
    STSClient: class {
      constructor() {}
      send(command: any) { return mockSend(command); }
    },
    AssumeRoleCommand: class {
      input: any;
      constructor(input: any) {
        this.input = input;
        capturedCommands.push(input);
      }
    },
  };
});

const { assumeRoleWithMfa, durationLadder, isDurationError } = await import("../src/sts");

const BASE_PARAMS = {
  region: "us-east-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  mfaArn: "arn:aws:iam::123456789012:mfa/user",
  roleArn: "arn:aws:iam::123456789012:role/TestRole",
  mfaCode: "123456",
  duration: 43200,
};

const MOCK_CREDENTIALS = {
  Credentials: {
    AccessKeyId: "ASIATEMP",
    SecretAccessKey: "TempSecret",
    SessionToken: "TempToken",
  },
};

beforeEach(() => {
  capturedCommands.length = 0;
  mockSend = mock(() => Promise.resolve(MOCK_CREDENTIALS));
});

describe("durationLadder", () => {
  test("standard duration returns it and all smaller standard values", () => {
    expect(durationLadder(43200)).toEqual([43200, 28800, 21600, 14400, 7200, 3600]);
  });

  test("mid-range standard duration", () => {
    expect(durationLadder(7200)).toEqual([7200, 3600]);
  });

  test("minimum standard duration", () => {
    expect(durationLadder(3600)).toEqual([3600]);
  });

  test("non-standard duration is tried first, then smaller standard values", () => {
    expect(durationLadder(50000)).toEqual([50000, 43200, 28800, 21600, 14400, 7200, 3600]);
  });

  test("non-standard mid-range duration", () => {
    expect(durationLadder(5000)).toEqual([5000, 3600]);
  });

  test("below-minimum duration returns only that value", () => {
    expect(durationLadder(1800)).toEqual([1800]);
  });
});

describe("isDurationError", () => {
  test("detects DurationSeconds error", () => {
    expect(isDurationError(new Error("DurationSeconds exceeds the maximum"))).toBe(true);
  });

  test("detects duration exceed error", () => {
    expect(isDurationError(new Error("The requested duration exceeds the limit"))).toBe(true);
  });

  test("rejects unrelated error", () => {
    expect(isDurationError(new Error("AccessDenied"))).toBe(false);
  });

  test("handles non-Error values", () => {
    expect(isDurationError("durationseconds too long")).toBe(true);
    expect(isDurationError(42)).toBe(false);
  });
});

describe("assumeRoleWithMfa", () => {
  test("returns credentials on success", async () => {
    const result = await assumeRoleWithMfa(BASE_PARAMS);

    expect(result.credentials).toEqual({
      AccessKeyId: "ASIATEMP",
      SecretAccessKey: "TempSecret",
      SessionToken: "TempToken",
    });
    expect(result.duration).toBe(43200);
  });

  test("passes correct parameters to STS", async () => {
    await assumeRoleWithMfa(BASE_PARAMS);

    expect(capturedCommands).toHaveLength(1);
    expect(capturedCommands[0]).toEqual({
      RoleArn: BASE_PARAMS.roleArn,
      RoleSessionName: "claude-aws-mfa",
      SerialNumber: BASE_PARAMS.mfaArn,
      TokenCode: BASE_PARAMS.mfaCode,
      DurationSeconds: 43200,
    });
  });

  test("falls back to shorter duration on duration error", async () => {
    let callCount = 0;
    mockSend = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("DurationSeconds exceeds the maximum"));
      return Promise.resolve(MOCK_CREDENTIALS);
    });

    const result = await assumeRoleWithMfa(BASE_PARAMS);

    expect(result.duration).toBe(28800);
    expect(capturedCommands).toHaveLength(2);
    expect(capturedCommands[0].DurationSeconds).toBe(43200);
    expect(capturedCommands[1].DurationSeconds).toBe(28800);
  });

  test("tries all durations in ladder on repeated duration errors", async () => {
    let callCount = 0;
    mockSend = mock(() => {
      callCount++;
      if (callCount < 6) return Promise.reject(new Error("DurationSeconds exceeds the maximum"));
      return Promise.resolve(MOCK_CREDENTIALS);
    });

    const result = await assumeRoleWithMfa(BASE_PARAMS);

    expect(result.duration).toBe(3600);
    expect(capturedCommands).toHaveLength(6);
  });

  test("throws non-duration errors immediately without retry", async () => {
    mockSend = mock(() => Promise.reject(new Error("AccessDenied")));

    expect(assumeRoleWithMfa(BASE_PARAMS)).rejects.toThrow("AccessDenied");
    // Wait for the rejection to complete
    await Bun.sleep(10);
    expect(capturedCommands).toHaveLength(1);
  });

  test("throws when all duration attempts fail", async () => {
    mockSend = mock(() => Promise.reject(new Error("DurationSeconds exceeds the maximum")));

    expect(assumeRoleWithMfa(BASE_PARAMS)).rejects.toThrow("DurationSeconds");
  });

  test("uses custom duration in ladder", async () => {
    let callCount = 0;
    mockSend = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("DurationSeconds exceeds the maximum"));
      return Promise.resolve(MOCK_CREDENTIALS);
    });

    const result = await assumeRoleWithMfa({ ...BASE_PARAMS, duration: 50000 });

    expect(capturedCommands[0].DurationSeconds).toBe(50000);
    expect(capturedCommands[1].DurationSeconds).toBe(43200);
    expect(result.duration).toBe(43200);
  });
});
