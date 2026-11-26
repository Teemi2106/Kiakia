import { createHash, randomBytes } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createLaunchUnsubscribeToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashLaunchUnsubscribeToken(token) };
}

export function hashLaunchUnsubscribeToken(token: string) {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Invalid launch unsubscribe token");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isLaunchUnsubscribeToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}
