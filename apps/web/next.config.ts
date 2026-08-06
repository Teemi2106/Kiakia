import type { NextConfig } from "next";

/**
 * Derives the Supabase project host from NEXT_PUBLIC_SUPABASE_URL so
 * next/image can be scoped to it exactly, instead of a wildcard remote
 * pattern. Falls back to no remote host when the env var is a placeholder
 * or missing — an empty allowlist fails safe.
 */
function supabaseHost(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const supabaseHostname = supabaseHost();

// Content-Security-Policy is set per-request (with a fresh nonce) in
// proxy.ts, not here — see apps/web/src/lib/security/csp.ts. Everything
// that doesn't need a nonce lives in this static list.
const staticSecurityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Raw-TS workspace packages, no build step per §6's monorepo layout.
  transpilePackages: ["@kiakia/domain", "@kiakia/db", "@kiakia/ui"],

  images: {
    // §14: vendor banners must be small, exact-size AVIF/WebP — never a
    // wildcard remote pattern that would let any URL be optimized through
    // this server.
    remotePatterns: supabaseHostname
      ? [{ protocol: "https", hostname: supabaseHostname, pathname: "/storage/v1/object/**" }]
      : [],
    formats: ["image/avif", "image/webp"],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders,
      },
    ];
  },
};

export default nextConfig;
