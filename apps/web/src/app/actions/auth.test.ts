import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseClientMock } from "@/test/supabase-mock";

const mockClient = { current: supabaseClientMock() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockClient.current)),
}));

// vendorLoginAction's role check goes through the DAL, not straight to
// Supabase — mocked at the module boundary same as orders.test.ts, so these
// tests control "does this account hold a vendor role" directly instead of
// wiring up a user_roles table fixture.
const getRoles = vi.fn(() => Promise.resolve<string[]>([]));
vi.mock("@/lib/auth/dal", () => ({
  getRoles: () => getRoles(),
  hasRole: (roles: string[], ...allowed: string[]) => roles.some((role) => allowed.includes(role)),
  VENDOR_ROLES: ["vendor_staff", "vendor_manager", "vendor_owner"],
}));

const setActiveRole = vi.fn((..._args: unknown[]) => Promise.resolve());
const clearActiveRole = vi.fn(() => Promise.resolve());
vi.mock("@/lib/auth/active-role", () => ({
  setActiveRole: (...args: unknown[]) => setActiveRole(...args),
  clearActiveRole: () => clearActiveRole(),
}));

const {
  loginAction,
  registerAction,
  requestPasswordResetAction,
  signOutAction,
  updatePasswordAction,
  vendorLoginAction,
  vendorRegisterAction,
} = await import("./auth");

const VALID_REGISTER_FORM = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+2348012345678",
  password: "abcd1234",
  confirmPassword: "abcd1234",
};

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("registerAction", () => {
  beforeEach(() => {
    mockClient.current = supabaseClientMock({
      auth: { signUp: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })) },
    });
  });

  it("rejects an invalid payload without ever calling Supabase", async () => {
    const result = await registerAction({}, formData({ ...VALID_REGISTER_FORM, email: "not-an-email" }));
    expect(result.error).toBeTruthy();
    expect(mockClient.current.auth.signUp).not.toHaveBeenCalled();
  });

  it("rejects mismatched password confirmation", async () => {
    const result = await registerAction({}, formData({ ...VALID_REGISTER_FORM, confirmPassword: "somethingElse1" }));
    expect(result.error).toBeTruthy();
  });

  it("maps an 'already registered' Supabase error to a user-friendly, non-leaking message", async () => {
    mockClient.current = supabaseClientMock({
      auth: {
        signUp: vi.fn(() =>
          Promise.resolve({ data: { session: null }, error: { message: "User already registered" } }),
        ),
      },
    });
    const result = await registerAction({}, formData(VALID_REGISTER_FORM));
    expect(result.error).toBe("An account with that email already exists.");
  });

  it("never leaks the raw Supabase error message for unrelated failures", async () => {
    mockClient.current = supabaseClientMock({
      auth: {
        signUp: vi.fn(() =>
          Promise.resolve({ data: { session: null }, error: { message: "relation auth.users does not exist" } }),
        ),
      },
    });
    const result = await registerAction({}, formData(VALID_REGISTER_FORM));
    expect(result.error).not.toContain("relation");
    expect(result.error).not.toContain("auth.users");
  });

  it("redirects to /home when Supabase returns an immediate session", async () => {
    mockClient.current = supabaseClientMock({
      auth: { signUp: vi.fn(() => Promise.resolve({ data: { session: { access_token: "x" } }, error: null })) },
    });
    await expect(registerAction({}, formData(VALID_REGISTER_FORM))).rejects.toThrow("NEXT_REDIRECT:/home");
  });

  it("returns a success message (not a redirect) when email confirmation is required", async () => {
    const result = await registerAction({}, formData(VALID_REGISTER_FORM));
    expect(result.success).toBeTruthy();
    expect(result.error).toBeUndefined();
  });
});

describe("loginAction", () => {
  it("rejects an empty password without calling Supabase", async () => {
    const result = await loginAction({}, formData({ email: "ada@example.com", password: "" }));
    expect(result.error).toBeTruthy();
  });

  it("returns a generic error on bad credentials (does not reveal whether the email exists)", async () => {
    mockClient.current = supabaseClientMock({
      auth: { signInWithPassword: vi.fn(() => Promise.resolve({ error: { message: "Invalid login credentials" } })) },
    });
    const result = await loginAction({}, formData({ email: "ada@example.com", password: "wrongpass1" }));
    expect(result.error).toBe("Incorrect email or password.");
  });

  it("redirects to /home on success", async () => {
    mockClient.current = supabaseClientMock({
      auth: { signInWithPassword: vi.fn(() => Promise.resolve({ error: null })) },
    });
    await expect(loginAction({}, formData({ email: "ada@example.com", password: "abcd1234" }))).rejects.toThrow(
      "NEXT_REDIRECT:/home",
    );
  });
});

describe("vendorRegisterAction", () => {
  it("redirects to /onboarding (not /home) when Supabase returns an immediate session", async () => {
    mockClient.current = supabaseClientMock({
      auth: { signUp: vi.fn(() => Promise.resolve({ data: { session: { access_token: "x" } }, error: null })) },
    });
    await expect(vendorRegisterAction({}, formData(VALID_REGISTER_FORM))).rejects.toThrow(
      "NEXT_REDIRECT:/onboarding",
    );
  });

  it("returns a success message pointing at vendor sign-in when email confirmation is required", async () => {
    mockClient.current = supabaseClientMock({
      auth: { signUp: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })) },
    });
    const result = await vendorRegisterAction({}, formData(VALID_REGISTER_FORM));
    expect(result.success).toContain("vendor");
  });
});

describe("vendorLoginAction", () => {
  beforeEach(() => {
    getRoles.mockReset();
    setActiveRole.mockClear();
    mockClient.current = supabaseClientMock({
      auth: { signInWithPassword: vi.fn(() => Promise.resolve({ error: null })) },
    });
  });

  it("redirects to /dashboard when the account already holds a vendor role", async () => {
    getRoles.mockResolvedValueOnce(["vendor_owner"]);
    await expect(
      vendorLoginAction({}, formData({ email: "ada@example.com", password: "abcd1234" })),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(setActiveRole).toHaveBeenCalledWith("vendor");
  });

  it("redirects to /onboarding when the account has no vendor role yet", async () => {
    getRoles.mockResolvedValueOnce([]);
    await expect(
      vendorLoginAction({}, formData({ email: "ada@example.com", password: "abcd1234" })),
    ).rejects.toThrow("NEXT_REDIRECT:/onboarding");
  });

  it("resets a stale vendor-mode cookie to customer when redirecting a non-vendor account to /onboarding (S3)", async () => {
    getRoles.mockResolvedValueOnce([]);
    await expect(
      vendorLoginAction({}, formData({ email: "ada@example.com", password: "abcd1234" })),
    ).rejects.toThrow("NEXT_REDIRECT:/onboarding");
    expect(setActiveRole).toHaveBeenCalledWith("customer");
    expect(setActiveRole).not.toHaveBeenCalledWith("vendor");
  });

  it("returns a generic error on bad credentials without checking roles", async () => {
    mockClient.current = supabaseClientMock({
      auth: {
        signInWithPassword: vi.fn(() => Promise.resolve({ error: { message: "Invalid login credentials" } })),
      },
    });
    const result = await vendorLoginAction({}, formData({ email: "ada@example.com", password: "wrongpass1" }));
    expect(result.error).toBe("Incorrect email or password.");
    expect(getRoles).not.toHaveBeenCalled();
  });
});

describe("requestPasswordResetAction", () => {
  it("returns the same generic success message for an invalid email, without touching Supabase", async () => {
    mockClient.current = supabaseClientMock({
      auth: { resetPasswordForEmail: vi.fn(() => Promise.resolve({ error: null })) },
    });
    const result = await requestPasswordResetAction({}, formData({ email: "not-an-email" }));
    expect(result.success).toBeTruthy();
    expect(mockClient.current.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("returns the identical generic success message for a valid, real-looking email (no user enumeration)", async () => {
    mockClient.current = supabaseClientMock({
      auth: { resetPasswordForEmail: vi.fn(() => Promise.resolve({ error: null })) },
    });
    const invalidResult = await requestPasswordResetAction({}, formData({ email: "not-an-email" }));
    const validResult = await requestPasswordResetAction({}, formData({ email: "real.user@example.com" }));
    expect(validResult.success).toBe(invalidResult.success);
  });
});

describe("updatePasswordAction", () => {
  it("rejects a weak password without calling Supabase", async () => {
    const result = await updatePasswordAction({}, formData({ password: "short" }));
    expect(result.error).toBeTruthy();
  });

  it("returns an expired-link message rather than the raw Supabase error", async () => {
    mockClient.current = supabaseClientMock({
      auth: { updateUser: vi.fn(() => Promise.resolve({ error: { message: "JWT expired" } })) },
    });
    const result = await updatePasswordAction({}, formData({ password: "abcd1234" }));
    expect(result.error).toBe("That reset link has expired. Request a new one.");
  });

  it("redirects to /home on success", async () => {
    mockClient.current = supabaseClientMock({
      auth: { updateUser: vi.fn(() => Promise.resolve({ error: null })) },
    });
    await expect(updatePasswordAction({}, formData({ password: "abcd1234" }))).rejects.toThrow("NEXT_REDIRECT:/home");
  });
});

describe("signOutAction", () => {
  it("signs out, clears the active-role cookie, and redirects to /login", async () => {
    const signOut = vi.fn(() => Promise.resolve({ error: null }));
    mockClient.current = supabaseClientMock({ auth: { signOut } });
    clearActiveRole.mockClear();
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(signOut).toHaveBeenCalledOnce();
    expect(clearActiveRole).toHaveBeenCalledOnce();
  });
});
