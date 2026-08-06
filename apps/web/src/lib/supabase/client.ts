"use client";

import type { Database } from "@kiakia/db";
import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "../env.client";

/**
 * Browser Supabase client — anon key, RLS-scoped to whichever user is
 * signed in. Use only from Client Components (catalog browsing, cart
 * mutations, anything §5 marks "read-only, cacheable, no reason to
 * proxy"). Never import this where a Server Action's own auth check is
 * meant to be the gate — that belongs to lib/supabase/server.ts + the DAL.
 */
export function createClient() {
  return createBrowserClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
