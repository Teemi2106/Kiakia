import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseClientMock, type QueryResult } from "@/test/supabase-mock";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "55555555-5555-4555-8555-555555555555";

const state = { adminClient: supabaseClientMock() };

const adminSession = { userId: ADMIN_ID, email: null, phone: null };
const requireAdminContext = vi.fn(() => Promise.resolve(adminSession));
vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: () => requireAdminContext() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.adminClient) }));

const { setUserStatusAction, setPlatformRoleAction } = await import("./admin-users");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const order: string[] = [];

const suspended = ok({ status: "suspended", previous_status: "active", changed: true });
const reinstated = ok({ status: "active", previous_status: "suspended", changed: true });

/** An admin client whose rpc and auth.admin.updateUserById calls are recorded in call order. */
function useClient(rpcResults: Record<string, QueryResult>, ban = vi.fn(() => Promise.resolve({ data: {}, error: null })) as ReturnType<typeof vi.fn>) {
  const client = supabaseClientMock({ rpc: rpcResults });
  const rpc = client.rpc.getMockImplementation()!;
  client.rpc.mockImplementation((fn: string) => {
    order.push(`rpc:${fn}`);
    return rpc(fn);
  });
  const updateUserById = vi.fn((id: string, attributes: unknown) => {
    order.push("ban");
    return ban(id, attributes);
  });
  Object.assign(client.auth, { admin: { updateUserById } });
  state.adminClient = client;
  return { rpc: client.rpc, updateUserById, ban };
}

beforeEach(() => {
  order.length = 0;
  requireAdminContext.mockReset();
  requireAdminContext.mockResolvedValue(adminSession);
});

describe("setUserStatusAction", () => {
  it("does nothing when the admin check rejects", async () => {
    const { rpc, updateUserById } = useClient({ admin_set_user_status: suspended });
    requireAdminContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/home"));

    await expect(setUserStatusAction({}, formData({ userId: USER_ID, status: "suspended", reason: "Fraud" }))).rejects.toThrow("NEXT_REDIRECT:/home");
    expect(rpc).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("requires a reason to suspend but not to reinstate", async () => {
    const { rpc } = useClient({ admin_set_user_status: reinstated });

    const missing = await setUserStatusAction({}, formData({ userId: USER_ID, status: "suspended", reason: "" }));
    expect(missing.error).toBe("Give a reason for suspending an account");
    expect(rpc).not.toHaveBeenCalled();

    expect(await setUserStatusAction({}, formData({ userId: USER_ID, status: "active", reason: "" }))).toEqual({ success: true });
  });

  it("records the suspension first, then bans the auth user", async () => {
    const { rpc, updateUserById } = useClient({ admin_set_user_status: suspended });

    const result = await setUserStatusAction({}, formData({ userId: USER_ID, status: "suspended", reason: "Chargeback abuse" }));

    expect(result).toEqual({ success: true });
    expect(order).toEqual(["rpc:admin_set_user_status", "ban"]);
    expect(rpc).toHaveBeenCalledWith("admin_set_user_status", {
      p_user_id: USER_ID,
      p_status: "suspended",
      p_reason: "Chargeback abuse",
      p_actor_id: ADMIN_ID,
    });
    expect(updateUserById).toHaveBeenCalledWith(USER_ID, { ban_duration: "876000h" });
  });

  it("lifts the ban when the user really went from suspended to active", async () => {
    const { updateUserById } = useClient({ admin_set_user_status: reinstated });
    await setUserStatusAction({}, formData({ userId: USER_ID, status: "active" }));
    expect(updateUserById).toHaveBeenCalledWith(USER_ID, { ban_duration: "none" });
  });

  it("leaves the ban alone when reinstating a user who was not suspended", async () => {
    const { updateUserById } = useClient({
      admin_set_user_status: ok({ status: "active", previous_status: "active", changed: false }),
    });
    expect(await setUserStatusAction({}, formData({ userId: USER_ID, status: "active" }))).toEqual({ success: true });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("re-applies the ban on a replayed suspension", async () => {
    const { updateUserById } = useClient({
      admin_set_user_status: ok({ status: "suspended", previous_status: "suspended", changed: false }),
    });
    await setUserStatusAction({}, formData({ userId: USER_ID, status: "suspended", reason: "Fraud" }));
    expect(updateUserById).toHaveBeenCalledWith(USER_ID, { ban_duration: "876000h" });
  });

  it("defers the ban for a rider who is finishing a delivery, and says so", async () => {
    const { updateUserById } = useClient({
      admin_set_user_status: ok({ status: "suspended", previous_status: "active", changed: true, sign_in_ban_deferred: true }),
    });
    const result = await setUserStatusAction({}, formData({ userId: USER_ID, status: "suspended", reason: "Fraud" }));

    expect(updateUserById).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.message).toContain("finishing a delivery");
    expect(result.message).toContain("Submit the suspension again");
  });

  it("says how to recover when lifting the ban fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    useClient({ admin_set_user_status: reinstated }, vi.fn(() => Promise.resolve({ data: null, error: { message: "auth down" } })));
    const result = await setUserStatusAction({}, formData({ userId: USER_ID, status: "active" }));
    expect(result.error).toContain("Suspend and reinstate it again");
    spy.mockRestore();
  });

  it("skips the ban when the database step fails", async () => {
    const { updateUserById } = useClient({
      admin_set_user_status: fail("admin_set_user_status: you cannot change your own account status", "23514"),
    });
    const result = await setUserStatusAction({}, formData({ userId: USER_ID, status: "suspended", reason: "Fraud" }));
    expect(result.error).toBe("you cannot change your own account status");
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("tells the admin to retry when the ban call fails, and a resubmit applies it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ban = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "auth down" } })
      .mockResolvedValueOnce({ data: {}, error: null });
    useClient({ admin_set_user_status: suspended }, ban);
    const form = formData({ userId: USER_ID, status: "suspended", reason: "Fraud" });

    const first = await setUserStatusAction({}, form);
    expect(first.error).toContain("Submit again to retry");
    expect(first.success).toBeUndefined();

    expect(await setUserStatusAction({}, form)).toEqual({ success: true });
    expect(ban).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("setPlatformRoleAction", () => {
  const base = { userId: USER_ID, role: "admin", action: "grant", reason: "Joined the support team" };

  it("maps grant/revoke to p_grant and sends the reason", async () => {
    const { rpc } = useClient({ admin_set_platform_role: ok(true) });

    await setPlatformRoleAction({}, formData(base));
    await setPlatformRoleAction({}, formData({ ...base, action: "revoke" }));

    expect(rpc).toHaveBeenNthCalledWith(1, "admin_set_platform_role", {
      p_user_id: USER_ID,
      p_role: "admin",
      p_grant: true,
      p_reason: "Joined the support team",
      p_actor_id: ADMIN_ID,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "admin_set_platform_role", expect.objectContaining({ p_grant: false }));
  });

  it("rejects an unknown role or a missing reason before the RPC", async () => {
    const { rpc } = useClient({ admin_set_platform_role: ok(true) });
    expect((await setPlatformRoleAction({}, formData({ ...base, role: "owner" }))).error).toBeTruthy();
    expect((await setPlatformRoleAction({}, formData({ ...base, reason: "" }))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tells a non-superadmin they lack permission", async () => {
    useClient({ admin_set_platform_role: fail("admin_set_platform_role: superadmin required", "42501") });
    expect((await setPlatformRoleAction({}, formData(base))).error).toBe("You don't have permission to do that.");
  });
});
