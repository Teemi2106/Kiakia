import { describe, expect, it, vi } from "vitest";

const getRoles = vi.fn(() => Promise.resolve<string[]>([]));
const verifySession = vi.fn(() =>
  Promise.resolve({ userId: "user-1", email: "user-1@example.com", phone: null }),
);
vi.mock("@/lib/auth/dal", () => ({
  getRoles: () => getRoles(),
  hasRole: (roles: string[], ...allowed: string[]) => roles.some((role) => allowed.includes(role)),
  VENDOR_ROLES: ["vendor_staff", "vendor_manager", "vendor_owner"],
  verifySession: () => verifySession(),
}));

const setActiveRole = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("@/lib/auth/active-role", () => ({
  setActiveRole: (...args: unknown[]) => setActiveRole(...args),
}));

const { switchToVendorAction, switchToCustomerAction } = await import("./session");

describe("switchToVendorAction", () => {
  it("refuses to switch a session that doesn't hold a vendor role, and sends it to onboarding instead", async () => {
    getRoles.mockResolvedValueOnce([]);
    await expect(switchToVendorAction()).rejects.toThrow("NEXT_REDIRECT:/onboarding");
    expect(setActiveRole).not.toHaveBeenCalled();
  });

  it("switches an eligible session into vendor mode and redirects to the dashboard", async () => {
    getRoles.mockResolvedValueOnce(["vendor_owner"]);
    await expect(switchToVendorAction()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(setActiveRole).toHaveBeenCalledWith("vendor");
  });
});

describe("switchToCustomerAction", () => {
  it("verifies the session, switches into customer mode, and redirects home", async () => {
    await expect(switchToCustomerAction()).rejects.toThrow("NEXT_REDIRECT:/home");
    expect(verifySession).toHaveBeenCalled();
    expect(setActiveRole).toHaveBeenCalledWith("customer");
  });
});
