import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const state = {
  session: { userId: "user-1", email: "user-1@example.com", phone: null } as {
    userId: string;
    email: string | null;
    phone: string | null;
  },
  client: { current: supabaseClientMock() },
  adminClient: { current: supabaseClientMock() },
};

const requireRole = vi.fn((..._args: unknown[]) => Promise.resolve(state.session));
const verifySession = vi.fn(() => Promise.resolve(state.session));

vi.mock("@/lib/auth/dal", () => ({
  requireRole: (...args: unknown[]) => requireRole(...args),
  verifySession: () => verifySession(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(() => Promise.resolve(state.client.current)) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.adminClient.current) }));

const { registerVendorAction, updateVendorSettingsAction } = await import("./vendor");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const VALID_VENDOR_FORM = { name: "Mama Put Kitchen", category: "food", addressLine: "1 Test Street" };

describe("registerVendorAction", () => {
  beforeEach(() => {
    requireRole.mockClear();
    verifySession.mockClear();
  });

  it("rejects a missing/too-short store name without calling the RPC", async () => {
    const result = await registerVendorAction({}, formData({ name: "A" }));
    expect(result.error).toBeTruthy();
    expect(state.client.current.rpc).not.toHaveBeenCalled();
  });

  it("registers on the first attempt and redirects to the dashboard", async () => {
    const rpc = vi.fn(() => Promise.resolve(ok({ id: "vendor-1", slug: "mama-put-kitchen" })));
    state.client.current = supabaseClientMock({ rpc: { register_vendor: ok({ id: "vendor-1" }) } });
    state.client.current.rpc = rpc as never;
    await expect(registerVendorAction({}, formData(VALID_VENDOR_FORM))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("register_vendor", expect.objectContaining({ p_slug: "mama-put-kitchen" }));
  });

  it("retries with a suffixed slug on a slug collision, then succeeds", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } })
      .mockResolvedValueOnce({ data: { id: "vendor-1" }, error: null });
    state.client.current = supabaseClientMock();
    state.client.current.rpc = rpc as never;

    await expect(registerVendorAction({}, formData(VALID_VENDOR_FORM))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(rpc).toHaveBeenCalledTimes(2);
    const firstSlug = rpc.mock.calls[0][1].p_slug;
    const secondSlug = rpc.mock.calls[1][1].p_slug;
    expect(firstSlug).toBe("mama-put-kitchen");
    expect(secondSlug).not.toBe(firstSlug);
    expect(secondSlug.startsWith("mama-put-kitchen-")).toBe(true);
  });

  it("stops after one attempt when the account already owns a vendor (not a slug collision to retry)", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: null, error: { message: "one vendor per account in this release" } }));
    state.client.current = supabaseClientMock();
    state.client.current.rpc = rpc as never;

    const result = await registerVendorAction({}, formData(VALID_VENDOR_FORM));
    expect(result.error).toBe("This account is already linked to a vendor.");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("stops after one attempt on an unrelated error, without leaking the raw message", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: null, error: { message: "permission denied for table vendors" } }));
    state.client.current = supabaseClientMock();
    state.client.current.rpc = rpc as never;

    const result = await registerVendorAction({}, formData(VALID_VENDOR_FORM));
    expect(result.error).toBe("We couldn't create your store. Please try again.");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("gives up after 5 slug collisions with a friendly message", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } }));
    state.client.current = supabaseClientMock();
    state.client.current.rpc = rpc as never;

    const result = await registerVendorAction({}, formData(VALID_VENDOR_FORM));
    expect(result.error).toContain("available store URL");
    expect(rpc).toHaveBeenCalledTimes(5);
  });
});

describe("updateVendorSettingsAction", () => {
  beforeEach(() => {
    requireRole.mockClear();
    requireRole.mockImplementation(() => Promise.resolve({ userId: "vendor-staff-1", email: null, phone: null }));
  });

  it("rejects a missing vendorId", async () => {
    const result = await updateVendorSettingsAction({}, formData({}));
    expect(result.error).toBe("Missing store.");
  });

  it("refuses to update a vendor this user doesn't staff — the write never reaches the admin client", async () => {
    state.client.current = supabaseClientMock({ from: { vendor_staff: queryBuilder(ok(null)) } });
    const update = vi.fn();
    state.adminClient.current = { from: vi.fn(() => ({ update })) } as never;

    const result = await updateVendorSettingsAction({}, formData({ vendorId: "vendor-not-mine", name: "New Name" }));
    expect(result.error).toBe("You don't have access to this store.");
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a missing/too-short store name after confirming staff membership", async () => {
    state.client.current = supabaseClientMock({ from: { vendor_staff: queryBuilder(ok({ vendor_id: "vendor-1" })) } });
    const result = await updateVendorSettingsAction({}, formData({ vendorId: "vendor-1", name: "A" }));
    expect(result.error).toBeTruthy();
  });

  it("updates only self-service fields — status/kyc_status are never in the write payload", async () => {
    state.client.current = supabaseClientMock({ from: { vendor_staff: queryBuilder(ok({ vendor_id: "vendor-1" })) } });
    let capturedPayload: Record<string, unknown> | undefined;
    const eq = vi.fn(() => Promise.resolve({ error: null }));
    const update = vi.fn((payload: Record<string, unknown>) => {
      capturedPayload = payload;
      return { eq };
    });
    state.adminClient.current = { from: vi.fn(() => ({ update })) } as never;

    const result = await updateVendorSettingsAction(
      {},
      formData({ vendorId: "vendor-1", name: "Mama Put Kitchen", isAcceptingOrders: "on" }),
    );

    expect(result.success).toBe(true);
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload).not.toHaveProperty("status");
    expect(capturedPayload).not.toHaveProperty("kyc_status");
    expect(capturedPayload).not.toHaveProperty("id");
    expect(eq).toHaveBeenCalledWith("id", "vendor-1");
  });

  it("never leaks a raw database error on update failure", async () => {
    state.client.current = supabaseClientMock({ from: { vendor_staff: queryBuilder(ok({ vendor_id: "vendor-1" })) } });
    const eq = vi.fn(() => Promise.resolve({ error: { message: 'value too long for type character varying(255)' } }));
    const update = vi.fn(() => ({ eq }));
    state.adminClient.current = { from: vi.fn(() => ({ update })) } as never;

    const result = await updateVendorSettingsAction({}, formData({ vendorId: "vendor-1", name: "Mama Put Kitchen" }));
    expect(result.error).toBe("Could not save your settings.");
  });
});
