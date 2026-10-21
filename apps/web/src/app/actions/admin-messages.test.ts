import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseClientMock, type QueryResult } from "@/test/supabase-mock";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";

const state = { adminClient: supabaseClientMock() };
const adminSession = { userId: ADMIN_ID, email: null, phone: null };
const requireAdminContext = vi.fn(() => Promise.resolve(adminSession));
const isSuperadmin = vi.fn(() => Promise.resolve(false));
vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: () => requireAdminContext(), isSuperadmin: () => isSuperadmin() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.adminClient) }));
const listUsers = vi.fn();
vi.mock("@/lib/admin/users", () => ({ listUsers: (...args: unknown[]) => listUsers(...args) }));

const { previewAudienceAction, searchPeopleAction, sendBroadcastAction, sendMessageAction } = await import("./admin-messages");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

function mockRpc(rpc: Record<string, QueryResult>) {
  state.adminClient = supabaseClientMock({ rpc });
  return state.adminClient.rpc;
}

let counter = 0;
const broadcast = (overrides: Record<string, string> = {}) =>
  formData({
    audience: JSON.stringify({ kind: "role", role: "customer", segment: "all" }),
    channel: "email",
    category: "transactional",
    subject: "Maintenance on Sunday",
    body: "Hi {{first_name}}, the app will be down on Sunday.",
    reason: "Planned maintenance",
    submissionId: `sub-${++counter}`,
    ...overrides,
  });

beforeEach(() => {
  requireAdminContext.mockReset();
  requireAdminContext.mockResolvedValue(adminSession);
  isSuperadmin.mockReset();
  isSuperadmin.mockResolvedValue(false);
  listUsers.mockReset();
});

describe("sendBroadcastAction", () => {
  it("sends a service message as an admin, taking the actor from the session", async () => {
    const rpc = mockRpc({ admin_create_broadcast: ok("33333333-3333-4333-8333-333333333333") });
    const result = await sendBroadcastAction({}, broadcast());
    expect(result).toMatchObject({ success: true, broadcastId: "33333333-3333-4333-8333-333333333333" });
    expect(rpc).toHaveBeenCalledWith("admin_create_broadcast", {
      p_actor_id: ADMIN_ID,
      p_audience: { kind: "role", role: "customer", segment: "all" },
      p_channel: "email",
      p_category: "transactional",
      p_subject: "Maintenance on Sunday",
      p_body: "Hi {{first_name}}, the app will be down on Sunday.",
      p_reason: "Planned maintenance",
      p_idempotency_key: expect.any(String),
    });
  });

  it("re-checks the role every time", async () => {
    mockRpc({ admin_create_broadcast: ok("x") });
    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/home"));
    await expect(sendBroadcastAction({}, broadcast())).rejects.toThrow("NEXT_REDIRECT");
  });

  it("keeps promotions for superadmins, with a clear next step for everyone else", async () => {
    const rpc = mockRpc({ admin_create_broadcast: ok("33333333-3333-4333-8333-333333333333") });
    const denied = await sendBroadcastAction({}, broadcast({ category: "promotional" }));
    expect(denied.error).toMatch(/superadmin/i);
    expect(denied.error).toMatch(/ask a superadmin/i);
    expect(rpc).not.toHaveBeenCalled();

    isSuperadmin.mockResolvedValue(true);
    const allowed = await sendBroadcastAction({}, broadcast({ category: "promotional" }));
    expect(allowed.success).toBe(true);
    expect(rpc).toHaveBeenCalledWith("admin_create_broadcast", expect.objectContaining({ p_category: "promotional" }));
  });

  it("sends the form's one-time id as the idempotency key, so a double submit or retry returns the same broadcast", async () => {
    const rpc = mockRpc({ admin_create_broadcast: ok("33333333-3333-4333-8333-333333333333") });
    const fd = broadcast({ submissionId: "double-click" });
    const first = await sendBroadcastAction({}, fd);
    const second = await sendBroadcastAction({}, fd);
    expect(second).toEqual(first);
    expect(rpc).toHaveBeenNthCalledWith(1, "admin_create_broadcast", expect.objectContaining({ p_idempotency_key: "double-click" }));
    expect(rpc).toHaveBeenNthCalledWith(2, "admin_create_broadcast", expect.objectContaining({ p_idempotency_key: "double-click" }));
  });

  it("sends no subject for a text message, and no key when the form has no id", async () => {
    const rpc = mockRpc({ admin_create_broadcast: ok("33333333-3333-4333-8333-333333333333") });
    const fd = broadcast({ channel: "sms", subject: "ignored", body: "Short text" });
    fd.delete("submissionId");
    await sendBroadcastAction({}, fd);
    expect(rpc).toHaveBeenCalledWith("admin_create_broadcast", expect.objectContaining({ p_subject: null, p_idempotency_key: null }));
  });

  it("explains the database's refusals in plain words", async () => {
    const cases: [string, string, RegExp][] = [
      ["admin_create_broadcast: no deliverable recipients (12 suppressed: suspended, no address or no consent)", "23514", /Nobody in this group can get this message/],
      ["admin_create_broadcast: 6000 deliverable recipients exceeds the cap of 5000 per broadcast; narrow the audience", "23514", /more than 5000 people/],
      ["admin_create_broadcast: rate limit reached (30 transactional broadcasts in the last 24 hours, limit 30)", "23514", /last 24 hours/],
      ["admin_create_broadcast: the body is empty once variables are removed", "23514", /empty once names are filled in/],
    ];
    for (const [message, code, expected] of cases) {
      mockRpc({ admin_create_broadcast: fail(message, code) });
      expect((await sendBroadcastAction({}, broadcast())).error).toMatch(expected);
    }
  });

  it("passes the database's own plain-language refusals through", async () => {
    mockRpc({ admin_create_broadcast: fail("admin_create_broadcast: something specific the admin can act on", "23514") });
    expect((await sendBroadcastAction({}, broadcast())).error).toBe("something specific the admin can act on");
  });

  it("hides unexpected database errors behind a generic message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockRpc({ admin_create_broadcast: fail('relation "message_outbox" does not exist', "42P01") });
    expect((await sendBroadcastAction({}, broadcast())).error).toBe("Something went wrong. Please try again.");
  });

  describe("validation happens before the RPC", () => {
    it.each([
      ["a missing reason", { reason: "  " }, /reason/i],
      ["an email with no subject", { subject: "" }, /subject/i],
      ["an empty body", { body: "   " }, /write the message/i],
      ["a text over 612 characters", { channel: "sms", body: "a".repeat(613) }, /612/],
      ["a promotional text over 440 characters", { channel: "sms", category: "promotional", body: "a".repeat(441) }, /440/],
      ["an emoji text over 268 characters", { channel: "sms", body: "\u{1F600}".repeat(269) }, /268/],
      ["a text that is only short once names are blank but long with a 40-character name", { channel: "sms", body: `${"a".repeat(580)}{{first_name}}` }, /612/],
      ["a subject over 150 characters", { subject: "s".repeat(151) }, /150/],
      ["a subject with a line break", { subject: "one\ntwo" }, /single line/],
      ["control characters in the body", { body: "bad\u0007bell" }, /cannot be sent/],
      ["an unknown merge field", { body: "Use {{coupon_code}}" }, /not something we can fill in/i],
      ["a store name for non-vendors", { body: "Hi {{store_name}}" }, /vendors/i],
      ["a segment that does not fit the role", { audience: JSON.stringify({ kind: "role", role: "customer", segment: "online" }) }, /valid group/i],
      ["a broken audience", { audience: "{nope" }, /./],
      ["an unknown channel", { channel: "whatsapp" }, /email or text/i],
      ["a user audience without a valid id", { audience: JSON.stringify({ kind: "user", user_id: "abc" }) }, /./],
    ])("rejects %s", async (_name, overrides, message) => {
      const rpc = mockRpc({ admin_create_broadcast: ok("x") });
      const result = await sendBroadcastAction({}, broadcast(overrides));
      expect(result.error).toMatch(message);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("allows the store name for vendors, and a 612-character text", async () => {
      mockRpc({ admin_create_broadcast: ok("33333333-3333-4333-8333-333333333333") });
      const vendors = JSON.stringify({ kind: "role", role: "vendor", segment: "active" });
      expect((await sendBroadcastAction({}, broadcast({ audience: vendors, body: "Hi {{store_name}}" }))).success).toBe(true);
      expect((await sendBroadcastAction({}, broadcast({ channel: "sms", subject: "", body: "a".repeat(612) }))).success).toBe(true);
    });
  });
});

describe("sendMessageAction", () => {
  const message = (overrides: Record<string, string> = {}) =>
    formData({ userId: PERSON_ID, channel: "sms", subject: "", body: "Your payout is ready, {{first_name}}.", reason: "Support request", submissionId: `m-${++counter}`, ...overrides });

  it("sends a one-to-one message as the signed-in admin", async () => {
    const rpc = mockRpc({ admin_send_message: ok("44444444-4444-4444-8444-444444444444") });
    expect((await sendMessageAction({}, message())).success).toBe(true);
    expect(rpc).toHaveBeenCalledWith("admin_send_message", {
      p_actor_id: ADMIN_ID,
      p_user_id: PERSON_ID,
      p_channel: "sms",
      p_subject: null,
      p_body: "Your payout is ready, {{first_name}}.",
      p_reason: "Support request",
    });
  });

  it("has no promotional path, whatever the form says", async () => {
    const rpc = mockRpc({ admin_send_message: ok("x") });
    await sendMessageAction({}, message({ category: "promotional" }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("promotional");
  });

  it("validates before the RPC and explains a person with no phone number in words", async () => {
    const rpc = mockRpc({ admin_send_message: fail("admin_send_message: the user has no phone number on file (a confirmed email / a phone number is required)", "23514") });
    expect((await sendMessageAction({}, message({ userId: "nope" }))).error).toBeTruthy();
    expect((await sendMessageAction({}, message({ reason: "" }))).error).toMatch(/reason/i);
    expect(rpc).not.toHaveBeenCalled();
    expect((await sendMessageAction({}, message())).error).toBe("This person has no phone number on file, so we cannot text them. Try email instead.");
  });

  it("re-checks the role", async () => {
    mockRpc({ admin_send_message: ok("x") });
    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/home"));
    await expect(sendMessageAction({}, message())).rejects.toThrow("NEXT_REDIRECT");
  });

  it("explains a suspended account and a missing email in words", async () => {
    mockRpc({ admin_send_message: fail("admin_send_message: the account is suspended; no message was sent", "23514") });
    expect((await sendMessageAction({}, message())).error).toBe("This account is suspended, so no message was sent.");
    mockRpc({ admin_send_message: fail("admin_send_message: the user has no verified email address on file (a confirmed email / a phone number is required)", "23514") });
    expect((await sendMessageAction({}, message({ channel: "email", subject: "Hi" }))).error).toMatch(/no confirmed email address/);
  });
});

describe("previewAudienceAction", () => {
  it("returns the preview and refuses a non-admin", async () => {
    mockRpc({ admin_audience_preview: ok({ recipient_count: 5, suppressed_count: 0, suppressed_reasons: {}, sample: [] }) });
    const result = await previewAudienceAction({ audience: { kind: "role", role: "rider", segment: "online" }, channel: "sms", category: "transactional" });
    expect(result.preview?.recipientCount).toBe(5);

    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/home"));
    await expect(previewAudienceAction({})).rejects.toThrow("NEXT_REDIRECT");
  });

  it("rejects an impossible audience and says plainly when counting fails", async () => {
    mockRpc({ admin_audience_preview: fail("boom") });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await previewAudienceAction({ audience: { kind: "role", role: "rider", segment: "ordered_30d" }, channel: "sms", category: "transactional" })).error).toMatch(/valid group/i);
    expect((await previewAudienceAction({ audience: { kind: "role", role: "rider", segment: "all" }, channel: "sms", category: "transactional" })).error).toMatch(/could not work out/i);
  });
});

describe("searchPeopleAction", () => {
  it("needs two characters, then reuses the accounts search", async () => {
    listUsers.mockResolvedValue({ rows: [{ id: PERSON_ID, fullName: "Ada Obi", phone: "0803", status: "active", roles: [], createdAt: "" }], total: 1, page: 1, pageSize: 8 });
    expect(await searchPeopleAction("a")).toEqual([]);
    expect(listUsers).not.toHaveBeenCalled();
    expect(await searchPeopleAction(" Ada ")).toEqual([{ id: PERSON_ID, name: "Ada Obi", phone: "0803" }]);
    expect(listUsers).toHaveBeenCalledWith({ q: "Ada", status: "active", page: 1, pageSize: 8 });
  });

  it("is admin-only", async () => {
    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/home"));
    await expect(searchPeopleAction("ada")).rejects.toThrow("NEXT_REDIRECT");
  });
});
