import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const requireAdminContext = vi.hoisted(() => vi.fn());
const isSuperadmin = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const headers = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/dal", () => ({ requireAdminContext, isSuperadmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/env.server", () => ({ serverEnv: { SUPABASE_SERVICE_ROLE_KEY: "test-service-key", NEXT_PUBLIC_SITE_URL: "https://www.kiakia.ng" } }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { subscribeToLaunchAction } = await import("./launch");
const { startLaunchAnnouncementAction } = await import("./launch-admin");
const { POST: launchOneClickUnsubscribe } = await import("../(marketing)/launch/unsubscribe/one-click/route");

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  rpc.mockReset();
  requireAdminContext.mockReset().mockResolvedValue({ userId: "admin-1", email: null, phone: null });
  isSuperadmin.mockReset().mockResolvedValue(true);
  revalidatePath.mockReset();
  headers.mockReset().mockResolvedValue(new Headers());
});

describe("launch signup email queue", () => {
  const signup = () => form({ email: "Foodie@Example.com", consent: "yes" });

  it("shows success only after the signup RPC accepts and queues a new subscriber", async () => {
    rpc.mockResolvedValue({ data: [{ outcome: "subscribed", subscriber_id: "subscriber-1" }], error: null });

    const result = await subscribeToLaunchAction({}, signup());

    expect(result).toMatchObject({ status: "success", welcomeQueued: true });
    expect(rpc).toHaveBeenCalledWith("subscribe_launch_email", {
      p_email: "foodie@example.com",
      p_rate_key: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_consent_version: "launch-list-v2",
      p_unsubscribe_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.unsubscribeUrl).toMatch(/^\/launch\/unsubscribe\?token=/);
  });

  it("does not enqueue another welcome for an accepted duplicate address", async () => {
    rpc.mockResolvedValue({ data: [{ outcome: "already_subscribed", subscriber_id: "subscriber-1" }], error: null });

    const result = await subscribeToLaunchAction({}, signup());

    expect(result).toMatchObject({ status: "success", welcomeQueued: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not show success for a backend error, unknown result, or honeypot submission", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "database unavailable" } });
    expect((await subscribeToLaunchAction({}, signup())).status).toBe("error");

    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await subscribeToLaunchAction({}, signup())).status).toBe("error");

    const trap = form({ email: "bot@example.com", consent: "yes", website: "https://spam.example" });
    expect((await subscribeToLaunchAction({}, trap)).status).toBe("error");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("manual launch campaign approval", () => {
  it("queues only after a superadmin confirms the exact phrase and checkbox", async () => {
    rpc.mockResolvedValue({ data: { outcome: "started", campaign_id: "campaign-1", recipient_count: 42, status: "queued" }, error: null });

    const result = await startLaunchAnnouncementAction({}, form({ confirm: "yes", phrase: "ANNOUNCE KIAKIA", expectedRecipientCount: "42" }));

    expect(result).toMatchObject({ status: "success", recipientCount: 42 });
    expect(rpc).toHaveBeenCalledWith("admin_start_launch_announcement", {
      p_actor_id: "admin-1",
      p_confirmation_phrase: "ANNOUNCE KIAKIA",
      p_expected_recipient_count: 42,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/launch-subscribers");
  });

  it("does not call the campaign RPC without full confirmation or superadmin access", async () => {
    expect((await startLaunchAnnouncementAction({}, form({ confirm: "yes", phrase: "ANNOUNCE KIAKIA!", expectedRecipientCount: "42" }))).status).toBe("error");
    isSuperadmin.mockResolvedValue(false);
    const unauthorized = await startLaunchAnnouncementAction({}, form({ confirm: "yes", phrase: "ANNOUNCE KIAKIA", expectedRecipientCount: "42" }));
    expect(unauthorized.status).toBe("error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a duplicate approval without claiming that another campaign was sent", async () => {
    rpc.mockResolvedValue({ data: { outcome: "already_started", campaign_id: "campaign-1", recipient_count: 42, status: "sending" }, error: null });
    const result = await startLaunchAnnouncementAction({}, form({ confirm: "yes", phrase: "ANNOUNCE KIAKIA", expectedRecipientCount: "42" }));
    expect(result.status).toBe("existing");
    expect(result.message).toMatch(/No second campaign/);
  });

  it("requires a fresh review when the eligible count changes after the preview", async () => {
    rpc.mockResolvedValue({ data: { outcome: "count_changed", eligible_count: 43 }, error: null });
    const result = await startLaunchAnnouncementAction({}, form({ confirm: "yes", phrase: "ANNOUNCE KIAKIA", expectedRecipientCount: "42" }));
    expect(result.status).toBe("error");
    expect(result.message).toContain("changed to 43");
  });
});

describe("launch unsubscribe one-click endpoint", () => {
  it("accepts RFC 8058 opt-out posts and records the hashed token", async () => {
    const token = "A".repeat(43);
    rpc.mockResolvedValue({ data: true, error: null });
    const request = new Request(`https://www.kiakia.ng/launch/unsubscribe/one-click?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });

    const response = await launchOneClickUnsubscribe(request);

    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("unsubscribe_launch_email", {
      p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("rejects arbitrary POSTs before contacting Supabase", async () => {
    const response = await launchOneClickUnsubscribe(new Request("https://www.kiakia.ng/launch/unsubscribe/one-click?token=bad", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "hello=world",
    }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
