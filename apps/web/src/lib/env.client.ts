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
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
});

// Safe parse with better error handling
function getClientEnv() {
  const result = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });

  if (!result.success) {
    // Log the errors but don't throw - this gives us a proper error message
    console.error("❌ Client environment validation failed:");
    result.error.errors.forEach((err) => {
      console.error(`  - ${err.path.join(".")}: ${err.message}`);
    });

    // Provide helpful defaults for development
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "⚠️  Using development defaults - some features may not work",
      );
      return {
        NEXT_PUBLIC_SUPABASE_URL:
          process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
          "dummy-key-for-development",
        NEXT_PUBLIC_SITE_URL:
          process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
      };
    }

    throw new Error(`Environment validation failed: ${result.error.message}`);
  }

  return result.data;
}

export const clientEnv = getClientEnv();
