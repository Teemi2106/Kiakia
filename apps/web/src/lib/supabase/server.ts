import "server-only";
import type { Database } from "@kiakia/db";
import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv } from "../env.client";

/**
 * Server Supabase client — anon key + the caller's own session cookie, so
 * every query still runs through RLS as that specific user. This is what
 * Server Components and Server Actions use for RLS-scoped reads/writes
 * (§5's default). For an operation that must bypass RLS entirely (e.g. an
 * operation transition_order() itself doesn't cover yet), use
 * lib/supabase/admin.ts instead, and only from a Server Action that has
 * already run its own DAL check.
 *
 * `cookies()` is async in Next 16 (no sync fallback) — this function must
 * be awaited by every caller.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, where cookies can't be
          // written. Harmless as long as proxy.ts is also refreshing the
          // session on every request (it is — see proxy.ts).
        }
      },
    },
  });
}
