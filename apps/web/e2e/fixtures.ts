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
