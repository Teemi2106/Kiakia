import { expect, type Page } from "@playwright/test";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — e2e specs need real seeded test accounts (see playwright.config.ts's header comment), not fabricated ones.`,
    );
  }
  return value;
}

export const e2eEnv = {
  get customerEmail() {
    return requireEnv("E2E_CUSTOMER_EMAIL");
  },
  get customerPassword() {
    return requireEnv("E2E_CUSTOMER_PASSWORD");
  },
  get vendorEmail() {
    return requireEnv("E2E_VENDOR_EMAIL");
  },
  get vendorPassword() {
    return requireEnv("E2E_VENDOR_PASSWORD");
  },
};

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  // loginAction redirects to /home on success — waiting for that is the
  // actual proof the credentials worked, not just that the form submitted.
  await expect(page).toHaveURL(/\/home/, { timeout: 15_000 });
}

/**
 * Signs in through /vendor/login rather than the customer /login form.
 * Required for any spec that then visits /dashboard/*: the (vendor) layout
 * gates on requireVendorContext(), which needs the session to have
 * explicitly switched into vendor mode (see lib/auth/active-role.ts) — the
 * customer loginAction sets the opposite mode, so a vendor-role account that
 * signs in via loginAs() above still bounces off /dashboard back to /home.
 */
export async function loginAsVendor(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/vendor/login");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  // vendorLoginAction redirects to /dashboard for an account that already
  // holds a vendor role, setting active mode to vendor along the way.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}
