import { describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseClientMock } from "@/test/supabase-mock";

const state = { client: supabaseClientMock() };
const requireAdminContext = vi.fn(() => Promise.resolve({ userId: "admin" }));
vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: () => requireAdminContext() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

const { getBroadcast, listBroadcasts, listUserMessages, previewAudience } = await import("./messages");

const ID = "3f2b8c1e-5d4a-4f6b-9a7c-1e2d3c4b5a69";

describe("previewAudience", () => {
  it("maps the count, the skipped reasons and at most 5 sample names", async () => {
    state.client = supabaseClientMock({
      rpc: {
        admin_audience_preview: ok({
          recipient_count: 120,
          suppressed_count: 9,
          suppressed_reasons: { no_address: 4, no_consent: 3, suspended: 2 },
          sample: Array.from({ length: 7 }, (_, i) => ({ user_id: `u${i}`, display_name: `Person ${i}`, role: "customer" })),
        }),
      },
    });
    const preview = await previewAudience({ kind: "role", role: "customer", segment: "all" }, "email", "promotional");
    expect(state.client.rpc).toHaveBeenCalledWith("admin_audience_preview", {
      p_audience: { kind: "role", role: "customer", segment: "all" },
      p_channel: "email",
      p_category: "promotional",
    });
    expect(preview).toMatchObject({ recipientCount: 120, suppressedCount: 9, noAddress: 4, noConsent: 3, suspended: 2 });
    expect(preview.sample).toHaveLength(5);
    expect(preview.sample[0]).toEqual({ userId: "u0", displayName: "Person 0", role: "customer" });
  });

  it("copes with missing fields instead of crashing the page", async () => {
    state.client = supabaseClientMock({ rpc: { admin_audience_preview: ok({}) } });
    expect(await previewAudience({ kind: "user", user_id: ID }, "sms", "transactional")).toEqual({
      recipientCount: 0,
      suppressedCount: 0,
      noAddress: 0,
      noConsent: 0,
      suspended: 0,
      sample: [],
    });
  });

  it("throws on an RPC error so the admin error page shows it", async () => {
    state.client = supabaseClientMock({ rpc: { admin_audience_preview: fail("boom") } });
    await expect(previewAudience({ kind: "user", user_id: ID }, "sms", "transactional")).rejects.toThrow("boom");
  });

  it("requires an admin", async () => {
    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(previewAudience({ kind: "user", user_id: ID }, "sms", "transactional")).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("listBroadcasts", () => {
  it("pages through the RPC and reads the total from the first row", async () => {
    state.client = supabaseClientMock({
      rpc: {
        admin_list_broadcasts: ok([
          {
            id: ID,
            created_at: "2026-10-20T10:00:00Z",
            created_by_name: "Ngozi",
            channel: "sms",
            category: "promotional",
            audience_label: "Customers: Everyone",
            subject: null,
            body: "Hello",
            recipient_count: 50,
            queued: 3,
            sent: 20,
            delivered: 25,
            failed: 1,
            suppressed: 1,
            total_count: 41,
          },
        ]),
      },
    });
    const page = await listBroadcasts({ page: 2 });
    expect(state.client.rpc).toHaveBeenCalledWith("admin_list_broadcasts", { p_limit: 25, p_offset: 25 });
    expect(page.total).toBe(41);
    expect(page.rows[0]).toMatchObject({
      id: ID,
      channel: "sms",
      category: "promotional",
      createdByName: "Ngozi",
      counts: { recipients: 50, waiting: 3, sent: 20, delivered: 25, failed: 1, skipped: 1 },
    });
  });

  it("returns an empty page for no rows", async () => {
    state.client = supabaseClientMock({ rpc: { admin_list_broadcasts: ok([]) } });
    expect(await listBroadcasts()).toMatchObject({ rows: [], total: 0, page: 1 });
  });
});

describe("getBroadcast", () => {
  it("maps counts and at most 20 failures, turning provider text into plain words", async () => {
    state.client = supabaseClientMock({
      rpc: {
        admin_get_broadcast: ok({
          id: ID,
          created_at: "2026-10-20T10:00:00Z",
          channel: "email",
          category: "transactional",
          audience_label: "Vendors: All vendors",
          subject: "Maintenance",
          body: "We are down Sunday",
          recipient_count: 30,
          counts: { queued: 2, sending: 1, sent: 10, delivered: 15, failed: 25, suppressed: 0 },
          failures: Array.from({ length: 25 }, (_, i) => ({
            display_name: `Vendor ${i}`,
            error: i === 0 ? "550 mailbox does not exist ada@example.com" : i === 1 ? "invalid_phone" : i === 2 ? "resend_http_429:rate_limit_exceeded" : "termii_network_error",
          })),
        }),
      },
    });
    const detail = await getBroadcast(ID);
    expect(detail?.counts).toEqual({ recipients: 30, waiting: 3, sent: 10, delivered: 15, failed: 25, skipped: 0 });
    expect(detail?.failures).toHaveLength(20);
    expect(detail?.failures[0]).toEqual({ displayName: "Vendor 0", reason: "Email bounced" });
    expect(detail?.failures[1]?.reason).toBe("Phone number invalid");
    expect(detail?.failures[2]?.reason).toBe("Provider unavailable: will retry");
    // The raw provider text, which can hold an address or number, never reaches the page.
    expect(JSON.stringify(detail)).not.toContain("example.com");
  });

  it("is null for a malformed id without calling the database", async () => {
    state.client = supabaseClientMock();
    expect(await getBroadcast("not-a-uuid")).toBeNull();
    expect(state.client.rpc).not.toHaveBeenCalled();
  });

  it("is null when the message does not exist", async () => {
    state.client = supabaseClientMock({ rpc: { admin_get_broadcast: fail("not found", "P0002") } });
    expect(await getBroadcast(ID)).toBeNull();
  });
});

describe("listUserMessages", () => {
  it("maps rows and explains failures in words", async () => {
    state.client = supabaseClientMock({
      rpc: {
        admin_list_user_messages: ok([
          { id: "m1", created_at: "2026-10-20T10:00:00Z", channel: "sms", category: "transactional", subject: null, body: "Hi", status: "failed", error: "invalid_phone" },
          { id: "m2", created_at: "2026-10-19T10:00:00Z", channel: "email", category: "promotional", subject: "Sale", body: "Big", status: "delivered", error: null },
          { id: "m3", created_at: "2026-10-18T10:00:00Z", channel: "email", category: "promotional", subject: "Sale", body: "Big", status: "suppressed", suppress_reason: "no_consent", error: null },
        ]),
      },
    });
    const rows = await listUserMessages(ID, 5);
    expect(state.client.rpc).toHaveBeenCalledWith("admin_list_user_messages", { p_user_id: ID, p_limit: 5 });
    expect(rows[0]).toMatchObject({ status: "failed", problem: "Phone number invalid" });
    expect(rows[1]).toMatchObject({ status: "delivered", problem: null, category: "promotional" });
    expect(rows[2]?.problem).toBe("Skipped: has not agreed to promotions");
  });
});
