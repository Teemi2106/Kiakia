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

  // Default is 1MB, too small for a menu-item photo or store banner
  // upload — the actual size cap (5MB) is enforced app-side in
  // lib/storage/vendor-media.ts and by the storage bucket itself (0036);
  // this just needs enough headroom to let that check run instead of the
  // request being rejected before it does. Still nested under
  // `experimental` in this Next version despite the stable-looking docs —
  // node_modules/next/dist/server/config-shared.d.ts is the source of
  // truth, not the docs snippet, per AGENTS.md.
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },

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
