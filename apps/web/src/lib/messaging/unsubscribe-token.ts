import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Unsubscribe link tokens, minted by the Edge sending worker and verified here.
 *
 *   token = base64url(`${userId}.${channel}`) + "." + hex(HMAC-SHA256(secret, `${userId}.${channel}`))
 *
 * The format is fixed by the worker; change both sides together. Pure functions
 * (the secret is a parameter) so they test without any environment.
 */

export type UnsubscribeChannel = "email" | "sms";

export interface UnsubscribeClaim {
  readonly userId: string;
  readonly channel: UnsubscribeChannel;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function mac(secret: string, message: string): Buffer {
  return createHmac("sha256", secret).update(message).digest();
}

export function signUnsubscribeToken(secret: string, claim: UnsubscribeClaim): string {
  const message = `${claim.userId}.${claim.channel}`;
  return `${Buffer.from(message, "utf8").toString("base64url")}.${mac(secret, message).toString("hex")}`;
}

/** The claim inside a token whose signature checks out, or null for anything else. Never throws. */
export function verifyUnsubscribeToken(secret: string, token: string | null | undefined): UnsubscribeClaim | null {
  if (!secret || typeof token !== "string" || token.length > 512) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];
  if (!BASE64URL.test(encoded) || !HEX_SHA256.test(signature)) return null;

  const message = Buffer.from(encoded, "base64url").toString("utf8");
  const dot = message.lastIndexOf(".");
  if (dot < 0) return null;
  const userId = message.slice(0, dot);
  const channel = message.slice(dot + 1);
  if (!UUID.test(userId) || (channel !== "email" && channel !== "sms")) return null;

  // Both sides are 32 bytes, so timingSafeEqual cannot throw on length.
  const expected = mac(secret, message);
  const given = Buffer.from(signature, "hex");
  if (!timingSafeEqual(expected, given)) return null;

  return { userId, channel };
}
