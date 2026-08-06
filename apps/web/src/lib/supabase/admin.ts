import "server-only";
import type { Database } from "@kiakia/db";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "../env.server";

/**
 * Service-role Supabase client. Bypasses RLS entirely — every query this
 * client makes is trusted at face value. §5/§18: this key must exist ONLY
 * in a Server Action / Route Handler / Edge Function, never in a
 * `NEXT_PUBLIC_*` var or a client bundle. The `server-only` import plus
 * `lib/env.server.ts`'s own `server-only` import make that a build error,
 * not just a convention; ci.yml's grep step is the second check.
 *
 * Stateless by design (no cookies) — this is not "the current user with
 * elevated privileges," it's the platform acting as itself. Every call
 * site must have already run its own authorization check (via the DAL)
 * before reaching for this client.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
