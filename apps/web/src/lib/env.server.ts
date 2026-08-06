import "server-only";
import { z } from "zod";
import { clientEnv } from "./env.client";

/**
 * Server-only environment: the Supabase service-role key plus Monnify's
 * API secret (§12's payment provider, swapped from Paystack to Monnify).
 * The `server-only` import above makes Next.js throw a build error if this
 * module is ever pulled into a Client Component's bundle — the automated
 * version of the §18 rule ("Add a CI grep that fails the build if it
 * appears"); ci.yml's grep step is the second, belt-and-braces layer.
 *
 * MONNIFY_API_KEY is required here too (Monnify's API auth header is
 * `Authorization: Basic base64(apiKey:secretKey)` — both halves are
 * needed server-side for every API call, not just the secret). If the
 * inline checkout widget ends up being used, the API key alone (never
 * the secret) would ALSO be duplicated into env.client.ts as
 * NEXT_PUBLIC_MONNIFY_API_KEY — not done yet, pending a decision on
 * inline widget vs. redirect-based checkout.
 */
const serverOnlySchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MONNIFY_API_KEY: z.string().min(1),
  MONNIFY_API_SECRET: z.string().min(1),
  MONNIFY_CONTRACT_CODE: z.string().min(1),
  MONNIFY_BASE_URL: z.string().url(),
});

const serverOnly = serverOnlySchema.parse({
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  MONNIFY_API_KEY: process.env.MONNIFY_API_KEY,
  MONNIFY_API_SECRET: process.env.MONNIFY_API_SECRET,
  MONNIFY_CONTRACT_CODE: process.env.MONNIFY_CONTRACT_CODE,
  MONNIFY_BASE_URL: process.env.MONNIFY_BASE_URL,
});

export const serverEnv = { ...clientEnv, ...serverOnly };
