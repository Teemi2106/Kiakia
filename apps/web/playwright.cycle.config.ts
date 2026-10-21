import { defineConfig, devices } from "@playwright/test";

/**
 * The full-cycle e2e: ONE order from signup to payout, against a throwaway
 * local Supabase stack. Separate from playwright.config.ts (the golden-path
 * specs against a seeded project) because it needs its own servers and a
 * strictly serial run: every step depends on the one before it.
 *
 * Run it with `pnpm --filter web e2e:cycle` (which loads the env file the
 * stack script wrote and then calls this config). See e2e/README.md.
 *
 * Servers started here:
 *  1. e2e/support/monnify-mock.mjs  - stand-in for Monnify's REST API
 *  2. `next build && next start` on its own port and its own dist dir, wired by EXPLICIT env
 *     vars to the local stack. Next never overrides a variable that is
 *     already in the process environment, so apps/web/.env.local (which
 *     points at a hosted project on a developer machine) cannot leak in for
 *     any key set below - and every key that file defines is set below.
 */

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set - run via \`pnpm --filter web e2e:cycle\` (see e2e/README.md).`);
  return value;
};

const supabaseUrl = required("E2E_SUPABASE_URL");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(supabaseUrl)) {
  throw new Error(`Refusing to run the full-cycle e2e against a non-local Supabase URL (${new URL(supabaseUrl).hostname}).`);
}

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const port = new URL(baseURL).port || "3100";
const mockUrl = required("E2E_MONNIFY_MOCK_URL");
const mockPort = new URL(mockUrl).port;

// One id for the whole run, shared with the worker process through the env.
process.env.E2E_RUN_ID ??= Date.now().toString(36);

// Signs the unsubscribe links the messages spec builds; the Next server below gets the same value.
process.env.E2E_UNSUBSCRIBE_SECRET ??= "e2e-unsubscribe-secret-value";

export default defineConfig({
  testDir: "./e2e/cycle",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "cycle" }],
  webServer: [
    {
      command: "node e2e/support/monnify-mock.mjs",
      url: `${mockUrl}/healthz`,
      env: { MONNIFY_MOCK_PORT: mockPort },
      reuseExistingServer: !!process.env.E2E_REUSE_SERVERS,
      timeout: 30_000,
    },
    {
      // A production build, not `next dev`: dev compiles every route on its
      // first visit (10-20s each), which no sane per-step timeout survives.
      // E2E_NEXT_MODE=dev opts back into dev for debugging the app itself.
      command:
        process.env.E2E_NEXT_MODE === "dev"
          ? `pnpm exec next dev --port ${port}`
          : `pnpm exec next build && pnpm exec next start --port ${port}`,
      url: `${baseURL}/login`,
      reuseExistingServer: !!process.env.E2E_REUSE_SERVERS,
      timeout: 480_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        NEXT_E2E_SKIP_TYPECHECK: "1",
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: required("E2E_SUPABASE_ANON_KEY"),
        SUPABASE_SERVICE_ROLE_KEY: required("E2E_SUPABASE_SERVICE_ROLE_KEY"),
        NEXT_PUBLIC_SITE_URL: baseURL,
        MONNIFY_API_KEY: "e2e-api-key",
        MONNIFY_API_SECRET: required("E2E_MONNIFY_SECRET"),
        MONNIFY_CONTRACT_CODE: "e2e-contract",
        MONNIFY_BASE_URL: mockUrl,
        MONNIFY_REDIRECT_BASE_URL: baseURL,
        MESSAGE_UNSUBSCRIBE_SECRET: process.env.E2E_UNSUBSCRIBE_SECRET,
        // Set (to harmless dummies) rather than left unset: an unset key would
        // let a value from .env.local through.
        NEXT_PUBLIC_MAPBOX_TOKEN: "pk.e2e-local-dummy-token",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
      },
    },
  ],
});
