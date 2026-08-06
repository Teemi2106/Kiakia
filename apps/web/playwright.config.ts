import { defineConfig, devices } from "@playwright/test";

/**
 * Golden-path e2e coverage. NOT part of `pnpm turbo run test` — unlike the
 * Vitest suite (mocked, runs anywhere), this needs a full live stack: a
 * running `pnpm dev` server against a real (local or staging) Supabase
 * project with the two seeded test accounts below, plus real menu/vendor
 * fixture data. Run it explicitly with `pnpm --filter web e2e` once that
 * stack exists; nothing in this sandbox can start Docker/Supabase to
 * execute it here.
 *
 * Required env (see e2e/fixtures.ts):
 *   E2E_BASE_URL              defaults to http://localhost:3000
 *   E2E_CUSTOMER_EMAIL / E2E_CUSTOMER_PASSWORD   a seeded, confirmed customer account
 *   E2E_VENDOR_EMAIL / E2E_VENDOR_PASSWORD       a seeded vendor_staff account on an
 *                                                 active, accepting-orders test vendor
 *                                                 with at least one available menu item
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
});
