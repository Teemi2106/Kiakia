import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseClientMock } from "@/test/supabase-mock";

const mockClient = { current: supabaseClientMock() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockClient.current)),
}));

// registerAction asks phone_in_use() through the admin client before signing
// up; mocked so no test reaches a real project.
const phoneInUse = vi.fn(() => Promise.resolve<{ data: boolean; error: null }>({ data: false, error: null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: () => phoneInUse() }),
}));

// vendorLoginAction's role check goes through the DAL, not straight to
// Supabase — mocked at the module boundary same as orders.test.ts, so these
// tests control "does this account hold a vendor role" directly instead of
// wiring up a user_roles table fixture.
const getRoles = vi.fn(() => Promise.resolve<string[]>([]));
const VENDOR_ROLES = ["vendor_staff", "vendor_manager", "vendor_owner"];
const hasRole = (roles: string[], ...allowed: string[]) => roles.some((role) => allowed.includes(role));
vi.mock("@/lib/auth/dal", () => ({
  getRoles: () => getRoles(),
  hasRole,
  VENDOR_ROLES,
  // Real logic, not a stub — same shape as dal.ts's own isPureRider, so
  // these tests exercise the actual "rider but no vendor role" condition
  // rather than a value the test controls directly.
  isPureRider: (roles: string[]) => hasRole(roles, "rider") && !hasRole(roles, ...VENDOR_ROLES),
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
  resendSignupCodeAction,
  signOutAction,
  updatePasswordAction,
  vendorLoginAction,
  vendorRegisterAction,
  vendorVerifyEmailAction,
  verifyEmailAction,
} = await import("./auth");

const VALID_REGISTER_FORM = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+2348012345678",
  password: "abcd1234",
  confirmPassword: "abcd1234",
};

beforeEach(() => {
  phoneInUse.mockClear();
});

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

  it("moves to the code-entry step (not a redirect) when email confirmation is required", async () => {
    const result = await registerAction({}, formData(VALID_REGISTER_FORM));
    expect(result.verifyEmail).toBe("ada@example.com");
    expect(result.error).toBeUndefined();
  });

  it("tells the user a taken phone number is taken, without calling signUp", async () => {
    phoneInUse.mockResolvedValueOnce({ data: true, error: null });
    const signUp = vi.fn(() => Promise.resolve({ data: { session: null }, error: null }));
    mockClient.current = supabaseClientMock({ auth: { signUp } });

    const result = await registerAction({}, formData(VALID_REGISTER_FORM));

    expect(result.error).toMatch(/phone number is already linked/i);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("signs up without a phone number, and without asking whether it is taken", async () => {
    const signUp = vi.fn((..._args: unknown[]) => Promise.resolve({ data: { session: null }, error: null }));
    mockClient.current = supabaseClientMock({ auth: { signUp } });

    const result = await registerAction({}, formData({ ...VALID_REGISTER_FORM, phone: "" }));

    expect(result.verifyEmail).toBe("ada@example.com");
    expect(phoneInUse).not.toHaveBeenCalled();
    expect(signUp.mock.calls[0]?.[0]).toMatchObject({ options: { data: { full_name: "Ada Lovelace" } } });
    expect(JSON.stringify(signUp.mock.calls[0]?.[0])).not.toContain('"phone"');
  });

  it("goes to the page the visitor came from once signed in", async () => {
    mockClient.current = supabaseClientMock({
      auth: { signUp: vi.fn(() => Promise.resolve({ data: { session: { access_token: "x" } }, error: null })) },
    });
    await expect(
      registerAction({}, formData({ ...VALID_REGISTER_FORM, next: "/checkout/continue" })),
    ).rejects.toThrow("NEXT_REDIRECT:/checkout/continue");
  });

  it("ignores a next target that leaves the site", async () => {
    mockClient.current = supabaseClientMock({
      auth: { signUp: vi.fn(() => Promise.resolve({ data: { session: { access_token: "x" } }, error: null })) },
    });
    await expect(registerAction({}, formData({ ...VALID_REGISTER_FORM, next: "//evil.com" }))).rejects.toThrow(
      "NEXT_REDIRECT:/home",
    );
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

  it("redirects to /home on success for an account with no vendor role", async () => {
    getRoles.mockResolvedValueOnce([]);
    mockClient.current = supabaseClientMock({
      auth: { signInWithPassword: vi.fn(() => Promise.resolve({ error: null })) },
    });
    await expect(loginAction({}, formData({ email: "ada@example.com", password: "abcd1234" }))).rejects.toThrow(
      "NEXT_REDIRECT:/home",
    );
    expect(setActiveRole).toHaveBeenCalledWith("customer");
  });

  it("returns to the page the visitor was sent from, e.g. the checkout hand-off", async () => {
    getRoles.mockResolvedValueOnce([]);
    mockClient.current = supabaseClientMock({
      auth: { signInWithPassword: vi.fn(() => Promise.resolve({ error: null })) },
    });
    await expect(
      loginAction({}, formData({ email: "ada@example.com", password: "abcd1234", next: "/checkout/continue" })),
    ).rejects.toThrow("NEXT_REDIRECT:/checkout/continue");
  });

  it("falls back to /home when next is not a same-site path", async () => {
    getRoles.mockResolvedValueOnce([]);
    mockClient.current = supabaseClientMock({
      auth: { signInWithPassword: vi.fn(() => Promise.resolve({ error: null })) },
    });
    await expect(
      loginAction({}, formData({ email: "ada@example.com", password: "abcd1234", next: "https://evil.com" })),
    ).rejects.toThrow("NEXT_REDIRECT:/home");
  });

  it("redirects to /dashboard on success for an account that holds a vendor role", async () => {
    getRoles.mockResolvedValueOnce(["vendor_owner"]);
    mockClient.current = supabaseClientMock({
      auth: { signInWithPassword: vi.fn(() => Promise.resolve({ error: null })) },
    });
    await expect(loginAction({}, formData({ email: "ada@example.com", password: "abcd1234" }))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
    expect(setActiveRole).toHaveBeenCalledWith("vendor");
  });

  it("signs a pure-rider account back out and refuses to set up a web session", async () => {
    getRoles.mockResolvedValueOnce(["rider", "customer"]);
    const signOut = vi.fn(() => Promise.resolve({ error: null }));
    mockClient.current = supabaseClientMock({
      auth: { signInWithPassword: vi.fn(() => Promise.resolve({ error: null })), signOut },
    });
    setActiveRole.mockClear();
    const result = await loginAction({}, formData({ email: "rider@example.com", password: "abcd1234" }));
    expect(result.error).toContain("rider");
    expect(signOut).toHaveBeenCalled();
    expect(setActiveRole).not.toHaveBeenCalled();
  });

  it("does not block a rider account that also holds a vendor role", async () => {
    getRoles.mockResolvedValueOnce(["rider", "vendor_owner"]);
    mockClient.current = supabaseClientMock({
      auth: { signInWithPassword: vi.fn(() => Promise.resolve({ error: null })) },
    });
    await expect(loginAction({}, formData({ email: "ada@example.com", password: "abcd1234" }))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
    expect(setActiveRole).toHaveBeenCalledWith("vendor");
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

  it("moves to the code-entry step when email confirmation is required", async () => {
    mockClient.current = supabaseClientMock({
      auth: { signUp: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })) },
    });
    const result = await vendorRegisterAction({}, formData(VALID_REGISTER_FORM));
    expect(result.verifyEmail).toBe("ada@example.com");
  });
});

describe("verifyEmailAction", () => {
  const verifyOtp = vi.fn((..._args: unknown[]) => Promise.resolve<{ error: unknown }>({ error: null }));

  beforeEach(() => {
    verifyOtp.mockClear();
    setActiveRole.mockClear();
    mockClient.current = supabaseClientMock({ auth: { verifyOtp } });
  });

  it("rejects a malformed code without calling Supabase, staying on the code step", async () => {
    const result = await verifyEmailAction({}, formData({ email: "ada@example.com", code: "12ab" }));
    expect(result.error).toBeTruthy();
    expect(result.verifyEmail).toBe("ada@example.com");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("maps a wrong or expired code to a friendly message that does not leak Supabase's", async () => {
    verifyOtp.mockResolvedValueOnce({ error: { message: "Token has expired or is invalid" } });
    const result = await verifyEmailAction({}, formData({ email: "ada@example.com", code: "123456" }));
    expect(result.error).toMatch(/incorrect or has expired/i);
    expect(result.error).not.toContain("Token");
    expect(result.verifyEmail).toBe("ada@example.com");
  });

  it("verifies as a signup OTP, then signs the customer in and goes home", async () => {
    await expect(verifyEmailAction({}, formData({ email: "ada@example.com", code: "123456" }))).rejects.toThrow(
      "NEXT_REDIRECT:/home",
    );
    expect(verifyOtp).toHaveBeenCalledWith({ email: "ada@example.com", token: "123456", type: "signup" });
    expect(setActiveRole).toHaveBeenCalledWith("customer");
  });

  it("returns to the page the visitor came from, ignoring off-site targets", async () => {
    await expect(
      verifyEmailAction({}, formData({ email: "ada@example.com", code: "123456", next: "/checkout/continue" })),
    ).rejects.toThrow("NEXT_REDIRECT:/checkout/continue");
    await expect(
      verifyEmailAction({}, formData({ email: "ada@example.com", code: "123456", next: "//evil.com" })),
    ).rejects.toThrow("NEXT_REDIRECT:/home");
  });

  it("sends a verified vendor applicant to /onboarding", async () => {
    await expect(
      vendorVerifyEmailAction({}, formData({ email: "ada@example.com", code: "123456", next: "/home" })),
    ).rejects.toThrow("NEXT_REDIRECT:/onboarding");
  });
});

describe("resendSignupCodeAction", () => {
  it("asks Supabase for a new signup code", async () => {
    const resend = vi.fn((..._args: unknown[]) => Promise.resolve({ error: null }));
    mockClient.current = supabaseClientMock({ auth: { resend } });
    const result = await resendSignupCodeAction({}, formData({ email: "ada@example.com" }));
    expect(resend).toHaveBeenCalledWith({ type: "signup", email: "ada@example.com" });
    expect(result.success).toBeTruthy();
  });

  it("reports a failure without leaking the provider message", async () => {
    mockClient.current = supabaseClientMock({
      auth: { resend: vi.fn(() => Promise.resolve({ error: { message: "rate limit smtp_host" } })) },
    });
    const result = await resendSignupCodeAction({}, formData({ email: "ada@example.com" }));
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain("smtp");
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

  it("signs a pure-rider account back out instead of sending it to /onboarding", async () => {
    getRoles.mockResolvedValueOnce(["rider", "customer"]);
    const signOut = vi.fn(() => Promise.resolve({ error: null }));
    mockClient.current = supabaseClientMock({
      auth: { signInWithPassword: vi.fn(() => Promise.resolve({ error: null })), signOut },
    });
    const result = await vendorLoginAction({}, formData({ email: "rider@example.com", password: "abcd1234" }));
    expect(result.error).toContain("rider");
    expect(signOut).toHaveBeenCalled();
    expect(setActiveRole).not.toHaveBeenCalled();
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
