import { describe, test, expect, afterEach } from "bun:test";
import { tryAcquireLock, releaseLock, waitForLock } from "../src/config";

describe("single-instance lock", () => {
  afterEach(() => {
    releaseLock();
  });

  test("tryAcquireLock succeeds on first call", () => {
    expect(tryAcquireLock()).toBe(true);
  });

  test("tryAcquireLock fails when lock is already held", () => {
    expect(tryAcquireLock()).toBe(true);
    expect(tryAcquireLock()).toBe(false);
  });

  test("releaseLock allows re-acquisition", () => {
    expect(tryAcquireLock()).toBe(true);
    releaseLock();
    expect(tryAcquireLock()).toBe(true);
  });

  test("releaseLock is safe to call when no lock exists", () => {
    releaseLock(); // should not throw
    releaseLock(); // double release should not throw
  });

  test("waitForLock resolves immediately when no lock exists", async () => {
    const start = Date.now();
    await waitForLock();
    expect(Date.now() - start).toBeLessThan(100);
  });

  test("waitForLock resolves after lock is released", async () => {
    expect(tryAcquireLock()).toBe(true);

    // Release the lock after a short delay
    setTimeout(() => releaseLock(), 200);

    const start = Date.now();
    await waitForLock();
    const elapsed = Date.now() - start;
    // Should resolve within ~200ms + poll interval (500ms)
    expect(elapsed).toBeLessThan(1000);
  });
});
