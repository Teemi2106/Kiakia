import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseClientMock, type QueryResult } from "@/test/supabase-mock";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

const state = { adminClient: supabaseClientMock() };
const adminSession = { userId: ADMIN_ID, email: null, phone: null };
const requireFinanceContext = vi.fn(() => Promise.resolve(adminSession));
vi.mock("@/lib/auth/dal", () => ({ requireFinanceContext: () => requireFinanceContext() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.adminClient) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { setPlatformFeeAction } = await import("./admin-settings");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

function useClient(rpc: Record<string, QueryResult>) {
  state.adminClient = supabaseClientMock({ rpc });
  return state.adminClient.rpc;
}

const base = { key: "service_fee_bps", percent: "2.5", reason: "Covering card costs" };

beforeEach(() => {
  requireFinanceContext.mockReset();
  requireFinanceContext.mockResolvedValue(adminSession);
  revalidatePath.mockReset();
});

describe("setPlatformFeeAction", () => {
  it("converts the typed percentage to basis points and takes the actor from the session", async () => {
    const rpc = useClient({ admin_set_platform_fee: ok({}) });
    const result = await setPlatformFeeAction({}, formData(base));
    expect(result.success).toBe(true);
    expect(rpc).toHaveBeenCalledWith("admin_set_platform_fee", {
      p_key: "service_fee_bps",
      p_value: 250,
      p_reason: "Covering card costs",
      p_actor_id: ADMIN_ID,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("accepts 0 percent and the default-commission key", async () => {
    const rpc = useClient({ admin_set_platform_fee: ok({}) });
    await setPlatformFeeAction({}, formData({ ...base, percent: "0" }));
    await setPlatformFeeAction({}, formData({ key: "default_vendor_commission_bps", percent: "12.5", reason: "New vendor rate" }));
    expect(rpc).toHaveBeenNthCalledWith(1, "admin_set_platform_fee", expect.objectContaining({ p_value: 0 }));
    expect(rpc).toHaveBeenNthCalledWith(2, "admin_set_platform_fee", expect.objectContaining({ p_key: "default_vendor_commission_bps", p_value: 1250 }));
  });

  it.each([
    ["service_fee_bps", "20.01"],
    ["service_fee_bps", "100"],
    ["default_vendor_commission_bps", "50.5"],
    ["service_fee_bps", "-1"],
    ["service_fee_bps", "abc"],
    ["service_fee_bps", "1.234"],
    ["service_fee_bps", ""],
    ["made_up", "2"],
  ])("rejects %s = %j before the RPC", async (key, percent) => {
    const rpc = useClient({ admin_set_platform_fee: ok({}) });
    const result = await setPlatformFeeAction({}, formData({ ...base, key, percent }));
    expect(result.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says the ceiling in plain words", async () => {
    useClient({ admin_set_platform_fee: ok({}) });
    expect((await setPlatformFeeAction({}, formData({ ...base, percent: "25" }))).error).toBe("The service fee cannot exceed 20%");
  });

  it("requires a reason", async () => {
    const rpc = useClient({ admin_set_platform_fee: ok({}) });
    expect((await setPlatformFeeAction({}, formData({ ...base, reason: "  " }))).error).toMatch(/reason/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never reaches the RPC when the finance check rejects", async () => {
    const rpc = useClient({ admin_set_platform_fee: ok({}) });
    requireFinanceContext.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/admin"));
    await expect(setPlatformFeeAction({}, formData(base))).rejects.toThrow("NEXT_REDIRECT:/admin");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database refusal in plain words and does not revalidate", async () => {
    useClient({ admin_set_platform_fee: fail("admin_set_platform_fee: the service fee must be between 0% and 20% (0-2000 basis points), got 2500 basis points", "23514") });
    const result = await setPlatformFeeAction({}, formData(base));
    expect(result.error).toBe("the service fee must be between 0% and 20% (0-2000 basis points), got 2500 basis points");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("hides unexpected failures behind a generic message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    useClient({ admin_set_platform_fee: fail("relation platform_settings exploded", "XX000") });
    expect((await setPlatformFeeAction({}, formData(base))).error).toBe("Something went wrong. Please try again.");
  });
});
