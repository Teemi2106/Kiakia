import { describe, expect, it } from "vitest";
import { createLaunchUnsubscribeToken, hashLaunchUnsubscribeToken, isLaunchUnsubscribeToken } from "./unsubscribe-token";

describe("launch unsubscribe tokens", () => {
  it("creates high-entropy url-safe tokens and stores only a stable SHA-256 digest", () => {
    const first = createLaunchUnsubscribeToken();
    const second = createLaunchUnsubscribeToken();

    expect(isLaunchUnsubscribeToken(first.token)).toBe(true);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashLaunchUnsubscribeToken(first.token)).toBe(first.tokenHash);
  });

  it("rejects malformed tokens before they reach the database", () => {
    expect(isLaunchUnsubscribeToken("bad-token")).toBe(false);
    expect(() => hashLaunchUnsubscribeToken("bad-token")).toThrow("Invalid launch unsubscribe token");
  });
});
