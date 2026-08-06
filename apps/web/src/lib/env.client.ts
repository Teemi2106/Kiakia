import { z } from "zod";

/**
 * Client-safe environment. Every key here is a NEXT_PUBLIC_* var, which
 * Next.js inlines into the browser bundle at build time — so nothing in
 * this schema may ever be a secret. §18: "Service-role key exists only in
 * Server Action / Edge Function environments."
 *
 * Vars are referenced as literal `process.env.NEXT_PUBLIC_X` property
 * accesses (not a spread of `process.env`) because Next's compiler only
 * statically inlines vars it can see written out like this in client code.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  // Supabase's newer key system: "publishable" replaces "anon" (same slot
  // in the SDK constructor, just renamed). sb_publishable_... prefix.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
});

export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});
