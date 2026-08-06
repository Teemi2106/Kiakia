/**
 * Content-Security-Policy, built per-request in proxy.ts with a fresh
 * nonce rather than a static header in next.config.ts. Next.js reads the
 * nonce back out of this same header on the response to nonce its own
 * inline bootstrap scripts, which is why this can't be a static config
 * value — see https://nextjs.org/docs/app/guides/content-security-policy.
 */

// Monnify's own well-known domains (§12's payment provider — swapped from
// Paystack to Monnify per project decision). Allowed ahead of the Phase 1
// integration landing, so the CSP doesn't need a follow-up change the day
// checkout ships. sdk.monnify.com serves the inline checkout widget
// script; api.monnify.com/sandbox.monnify.com are the API + hosted
// checkout hosts. If the inline widget turns out to load its payment UI
// from an additional Monnify subdomain (observable once it's actually
// exercised in a browser), add it here then — not guessed now.
const MONNIFY_ORIGINS = ["https://sdk.monnify.com", "https://api.monnify.com", "https://sandbox.monnify.com"];

export function buildContentSecurityPolicy(nonce: string, supabaseHostname: string | null): string {
  const supabaseHttps = supabaseHostname ? `https://${supabaseHostname}` : "";
  const supabaseWss = supabaseHostname ? `wss://${supabaseHostname}` : "";
  // React's dev-mode error-stack reconstruction relies on eval(); the CSP
  // guide calls this out explicitly. Never needed (or allowed) in prod.
  const isDev = process.env.NODE_ENV === "development";

  const directives: Record<string, string> = {
    "default-src": "'self'",
    "script-src": `'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""} ${MONNIFY_ORIGINS.join(" ")}`,
    "style-src": "'self' 'unsafe-inline'", // Tailwind's runtime style injection has no nonce hook yet
    "img-src": `'self' data: blob: ${supabaseHttps}`,
    "font-src": "'self' data:",
    "connect-src": `'self' ${supabaseHttps} ${supabaseWss} ${MONNIFY_ORIGINS.join(" ")}`,
    "frame-src": `'self' ${MONNIFY_ORIGINS.join(" ")}`,
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",
  };

  return Object.entries(directives)
    .map(([key, value]) => `${key} ${value}`.replace(/\s+/g, " ").trim())
    .join("; ");
}

export function generateNonce(): string {
  // 16 random bytes, base64 — matches the length Next's own CSP guide uses.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
