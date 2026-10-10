import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const state = {
  roles: ["customer", "admin"] as string[],
  profileStatus: "active" as string | null,
  roleQueries: [] as ReturnType<typeof queryBuilder>[],
};

const redirect = vi.fn((to: string): never => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), cache: <T>(fn: T) => fn }));
const getActiveRole = vi.fn(() => Promise.resolve("customer" as "customer" | "vendor"));
vi.mock("./active-role", () => ({ getActiveRole: () => getActiveRole() }));
vi.mock("../supabase/server", () => ({
  createClient: () => {
    const userRoles = queryBuilder(ok(state.roles.map((role) => ({ role }))));
    state.roleQueries.push(userRoles);
    return Promise.resolve(
      supabaseClientMock({
        authUser: { id: USER_ID },
        from: {
          user_roles: userRoles,
          profiles: queryBuilder(ok(state.profileStatus ? { status: state.profileStatus } : null)),
        },
      }),
    );
  },
}));

const { isPureRider, requireAdminContext, requireFinanceContext, requireVendorContext } = await import("./dal");

beforeEach(() => {
  state.roles = ["customer", "admin"];
  state.profileStatus = "active";
  state.roleQueries = [];
  redirect.mockClear();
  getActiveRole.mockResolvedValue("customer");
});

describe("isPureRider", () => {
  it("is true for a rider with no other real role", () => {
    expect(isPureRider(["customer", "rider"])).toBe(true);
  });

  it.each(["vendor_owner", "vendor_manager", "vendor_staff", "admin", "superadmin"] as const)(
    "is false for a rider who also holds %s",
    (role) => {
      expect(isPureRider(["customer", "rider", role])).toBe(false);
    },
  );
});

describe("requireAdminContext", () => {
  it("admits an active admin", async () => {
    await expect(requireAdminContext()).resolves.toMatchObject({ userId: USER_ID });
  });

  it.each(["suspended", "deleted", null])("fails closed for an admin whose profile is %s", async (status) => {
    state.profileStatus = status;
    await expect(requireAdminContext()).rejects.toThrow("NEXT_REDIRECT:/home");
  });

  it("counts only platform-scoped role rows, so a vendor-scoped admin row grants nothing", async () => {
    await requireAdminContext();
    const queried = state.roleQueries.filter((query) => (query.select as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    expect(queried.length).toBeGreaterThan(0);
    for (const query of queried) expect(query.eq).toHaveBeenCalledWith("scope_type", "platform");
  });

  it("turns away an account without an admin role", async () => {
    state.roles = ["customer"];
    await expect(requireAdminContext()).rejects.toThrow("NEXT_REDIRECT:/home");
  });
});

describe("requireFinanceContext", () => {
  it("turns away a plain admin", async () => {
    await expect(requireFinanceContext()).rejects.toThrow("NEXT_REDIRECT:/admin");
  });

  it.each(["finance", "superadmin"])("admits an admin who holds %s", async (role) => {
    state.roles = ["customer", "admin", role];
    await expect(requireFinanceContext()).resolves.toMatchObject({ userId: USER_ID });
  });

  it("does not let the finance role alone through the admin gate", async () => {
    state.roles = ["customer", "finance"];
    await expect(requireFinanceContext()).rejects.toThrow("NEXT_REDIRECT:/home");
  });
});

describe("requireVendorContext", () => {
  beforeEach(() => {
    state.roles = ["customer", "vendor_owner"];
    getActiveRole.mockResolvedValue("vendor");
  });

  it("admits an active vendor in vendor mode", async () => {
    await expect(requireVendorContext()).resolves.toMatchObject({ userId: USER_ID });
  });

  it.each(["suspended", "deleted", null])("sends a vendor whose profile is %s to the public landing page", async (status) => {
    state.profileStatus = status;
    await expect(requireVendorContext("/home")).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("still sends an account without a vendor role to the requested page", async () => {
    state.roles = ["customer"];
    await expect(requireVendorContext("/home")).rejects.toThrow("NEXT_REDIRECT:/home");
  });

  it("still sends a vendor who is not in vendor mode to the requested page", async () => {
    getActiveRole.mockResolvedValue("customer");
    await expect(requireVendorContext("/home")).rejects.toThrow("NEXT_REDIRECT:/home");
  });
});
