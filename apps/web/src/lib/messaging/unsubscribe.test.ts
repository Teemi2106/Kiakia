import { beforeEach, describe, expect, it, vi } from "vitest";
import { signUnsubscribeToken } from "./unsubscribe-token";

const SECRET = "route-test-secret";
const USER = "3f2b8c1e-5d4a-4f6b-9a7c-1e2d3c4b5a69";

const env: { MESSAGE_UNSUBSCRIBE_SECRET: string | undefined } = { MESSAGE_UNSUBSCRIBE_SECRET: SECRET };
vi.mock("@/lib/env.server", () => ({ serverEnv: env }));

const upsert = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...args: unknown[]) => upsert(...args) }) }));

const { applyUnsubscribe, readUnsubscribeToken } = await import("./unsubscribe");
const { POST, GET } = await import("@/app/unsubscribe/one-click/route");
const { NextRequest } = await import("next/server");

beforeEach(() => {
  env.MESSAGE_UNSUBSCRIBE_SECRET = SECRET;
  upsert.mockReset();
  upsert.mockResolvedValue({ error: null });
});

describe("applyUnsubscribe", () => {
  it("withdraws only the token's channel, for the token's user, through message_opt_out", async () => {
    expect(await applyUnsubscribe(signUnsubscribeToken(SECRET, { userId: USER, channel: "sms" }))).toBe("done");
    expect(upsert).toHaveBeenCalledWith("message_opt_out", { p_user_id: USER, p_channel: "sms", p_source: "unsubscribe_link" });

    upsert.mockClear();
    await applyUnsubscribe(signUnsubscribeToken(SECRET, { userId: USER, channel: "email" }));
    expect(upsert).toHaveBeenCalledWith("message_opt_out", { p_user_id: USER, p_channel: "email", p_source: "unsubscribe_link" });
  });

  it("does nothing for a forged token", async () => {
    expect(await applyUnsubscribe(signUnsubscribeToken("wrong", { userId: USER, channel: "email" }))).toBe("invalid");
    expect(await applyUnsubscribe("garbage")).toBe("invalid");
    expect(await applyUnsubscribe(null)).toBe("invalid");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses everything when no secret is configured", async () => {
    env.MESSAGE_UNSUBSCRIBE_SECRET = undefined;
    const token = signUnsubscribeToken(SECRET, { userId: USER, channel: "email" });
    expect(readUnsubscribeToken(token)).toBeNull();
    expect(await applyUnsubscribe(token)).toBe("invalid");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports a database failure without leaking it", async () => {
    upsert.mockResolvedValue({ error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await applyUnsubscribe(signUnsubscribeToken(SECRET, { userId: USER, channel: "email" }))).toBe("failed");
  });
});

describe("one-click route (RFC 8058)", () => {
  const url = (token?: string, name = "token") => `http://localhost/unsubscribe/one-click${token ? `?${name}=${token}` : ""}`;

  it("POST with a valid token unsubscribes and answers 200", async () => {
    const token = signUnsubscribeToken(SECRET, { userId: USER, channel: "email" });
    const response = await POST(new NextRequest(url(token), { method: "POST", body: "List-Unsubscribe=One-Click" }));
    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("also accepts the short ?t= name", async () => {
    const token = signUnsubscribeToken(SECRET, { userId: USER, channel: "sms" });
    expect((await POST(new NextRequest(url(token, "t"), { method: "POST" }))).status).toBe(200);
  });

  it("POST with a bad or missing token is a 400 and changes nothing", async () => {
    expect((await POST(new NextRequest(url("nope"), { method: "POST" }))).status).toBe(400);
    expect((await POST(new NextRequest(url(), { method: "POST" }))).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("GET never changes anything: it redirects to the confirm page", async () => {
    const token = signUnsubscribeToken(SECRET, { userId: USER, channel: "email" });
    const response = GET(new NextRequest(url(token)));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/unsubscribe");
    expect(upsert).not.toHaveBeenCalled();
  });
});
