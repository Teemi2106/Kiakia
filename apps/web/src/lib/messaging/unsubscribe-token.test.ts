import { createHmac } from "node:crypto";
import type * as NodeCrypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET = "test-secret-value";
const USER = "3f2b8c1e-5d4a-4f6b-9a7c-1e2d3c4b5a69";

describe("unsubscribe tokens", () => {
  it("round-trips for each channel", () => {
    for (const channel of ["email", "sms"] as const) {
      expect(verifyUnsubscribeToken(SECRET, signUnsubscribeToken(SECRET, { userId: USER, channel }))).toEqual({ userId: USER, channel });
    }
  });

  it("matches the worker's format exactly", () => {
    const message = `${USER}.email`;
    const expected = `${Buffer.from(message).toString("base64url")}.${createHmac("sha256", SECRET).update(message).digest("hex")}`;
    expect(signUnsubscribeToken(SECRET, { userId: USER, channel: "email" })).toBe(expected);
    expect(verifyUnsubscribeToken(SECRET, expected)).toEqual({ userId: USER, channel: "email" });
  });

  it("rejects a token signed with another secret", () => {
    const token = signUnsubscribeToken("other-secret", { userId: USER, channel: "email" });
    expect(verifyUnsubscribeToken(SECRET, token)).toBeNull();
  });

  it("rejects a tampered user, channel or signature", () => {
    const token = signUnsubscribeToken(SECRET, { userId: USER, channel: "email" });
    const [, signature] = token.split(".") as [string, string];

    const otherUser = "3f2b8c1e-5d4a-4f6b-9a7c-1e2d3c4b5a70";
    expect(verifyUnsubscribeToken(SECRET, `${Buffer.from(`${otherUser}.email`).toString("base64url")}.${signature}`)).toBeNull();
    // Same signature, channel switched from email to sms: the signature covers the channel.
    expect(verifyUnsubscribeToken(SECRET, `${Buffer.from(`${USER}.sms`).toString("base64url")}.${signature}`)).toBeNull();
    expect(verifyUnsubscribeToken(SECRET, `${token.split(".")[0]}.${"0".repeat(64)}`)).toBeNull();
    expect(verifyUnsubscribeToken(SECRET, `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`)).toBeNull();
  });

  it("rejects a valid signature over a different channel name", () => {
    const message = `${USER}.push`;
    const token = `${Buffer.from(message).toString("base64url")}.${createHmac("sha256", SECRET).update(message).digest("hex")}`;
    expect(verifyUnsubscribeToken(SECRET, token)).toBeNull();
  });

  it("rejects a valid signature over a user id that is not a uuid", () => {
    const message = "not-a-uuid.email";
    const token = `${Buffer.from(message).toString("base64url")}.${createHmac("sha256", SECRET).update(message).digest("hex")}`;
    expect(verifyUnsubscribeToken(SECRET, token)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["no dot", "abc"],
    ["three parts", "a.b.c"],
    ["short signature", "YWJj.abcd"],
    ["non-hex signature", `YWJj.${"z".repeat(64)}`],
    ["bad base64url", `a+b/.${"a".repeat(64)}`],
    ["very long", "a".repeat(5000)],
  ])("returns null (never throws) for a malformed token: %s", (_name, token) => {
    expect(verifyUnsubscribeToken(SECRET, token)).toBeNull();
  });

  it("returns null for missing input or a missing secret", () => {
    expect(verifyUnsubscribeToken(SECRET, null)).toBeNull();
    expect(verifyUnsubscribeToken(SECRET, undefined)).toBeNull();
    const token = signUnsubscribeToken(SECRET, { userId: USER, channel: "sms" });
    expect(verifyUnsubscribeToken("", token)).toBeNull();
  });

  it("compares signatures with timingSafeEqual, for good and bad tokens alike", async () => {
    const crypto = await import("node:crypto");
    const spy = vi.mocked(crypto.timingSafeEqual);
    spy.mockClear();
    verifyUnsubscribeToken(SECRET, signUnsubscribeToken(SECRET, { userId: USER, channel: "email" }));
    verifyUnsubscribeToken(SECRET, signUnsubscribeToken("other-secret", { userId: USER, channel: "email" }));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
