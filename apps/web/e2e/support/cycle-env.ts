/**
 * Environment for the full-cycle spec (e2e/cycle/*). Everything comes from the
 * env file stack.mjs generates for the THROWAWAY local stack - never from
 * apps/web/.env.local, never from a hosted project.
 *
 * assertLocalStack() is the hard safety rail: this suite creates users, orders
 * and ledger rows with a service-role key, so it refuses to run against
 * anything but a loopback Supabase URL.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Run \`pnpm --filter web e2e:cycle\` (it loads the stack env file) - see e2e/README.md.`);
  }
  return value;
}

export const cycleEnv = {
  get supabaseUrl() {
    return requireEnv("E2E_SUPABASE_URL");
  },
  get anonKey() {
    return requireEnv("E2E_SUPABASE_ANON_KEY");
  },
  get serviceKey() {
    return requireEnv("E2E_SUPABASE_SERVICE_ROLE_KEY");
  },
  get monnifySecret() {
    return requireEnv("E2E_MONNIFY_SECRET");
  },
  get monnifyMockUrl() {
    return requireEnv("E2E_MONNIFY_MOCK_URL");
  },
  get webhookUrl() {
    return requireEnv("E2E_WEBHOOK_URL");
  },
  get inbucketUrl() {
    return process.env.E2E_INBUCKET_URL ?? "";
  },
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function assertLocalStack(): void {
  const host = new URL(cycleEnv.supabaseUrl).hostname;
  if (!LOOPBACK.has(host)) {
    throw new Error(`Refusing to run the full-cycle e2e against non-local Supabase host "${host}".`);
  }
  const defaultDevPorts = new Set(["54321", "55321"]);
  const port = new URL(cycleEnv.supabaseUrl).port;
  if (defaultDevPorts.has(port)) {
    throw new Error(`Refusing to run against port ${port}: that is a developer's own local stack, not the throwaway e2e stack.`);
  }
}

/** One run's identities. A run id keeps reruns against a reused stack from colliding on email/slug. */
const runId = (process.env.E2E_RUN_ID ?? Date.now().toString(36)).toLowerCase();

/** profiles.phone is unique, so a reused stack needs fresh numbers every run: 080 + 7 run digits + a slot digit. */
const runDigits = String(parseInt(runId, 36) % 10_000_000).padStart(7, "0");
const phone = (slot: number) => `080${runDigits}${slot}`;

export const cycleUsers = {
  runId,
  password: "E2e-Cycle-Pass-1",
  admin: { email: `admin.${runId}@e2e-cycle.test`, fullName: `E2E Superadmin ${runId}`, phone: phone(1) },
  customer: { email: `customer.${runId}@e2e-cycle.test`, fullName: `Cycle Customer ${runId}`, phone: phone(2) },
  vendor: { email: `vendor.${runId}@e2e-cycle.test`, fullName: `Cycle Vendor Owner ${runId}`, phone: phone(3) },
  rider: { email: `rider.${runId}@e2e-cycle.test`, fullName: `Cycle Rider ${runId}`, phone: phone(4) },
  rider2: { email: `rider2.${runId}@e2e-cycle.test`, fullName: `Cycle Rider Two ${runId}`, phone: phone(5) },
  storeName: `Cycle Kitchen ${runId}`,
  dish: { name: "Cycle Jollof", priceNaira: 2500 },
};

/** Inside the seed's synthetic service area polygon: lon 7.4-7.5, lat 9.0-9.1 (supabase/seed.sql). */
export const IN_AREA = { latitude: 9.05, longitude: 7.45 };
