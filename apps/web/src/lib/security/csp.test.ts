import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContentSecurityPolicy, generateNonce } from "./csp";

describe("generateNonce", () => {
  it("produces a non-empty, URL-safe-ish base64 string", () => {
    const nonce = generateNonce();
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("is different on every call (a reused nonce defeats the CSP's purpose)", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
  });
});

describe("buildContentSecurityPolicy", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    vi.stubEnv("NODE_ENV", originalEnv ?? "test");
  });

  it("never allows a wildcard source, in dev or prod", () => {
    for (const env of ["development", "production"] as const) {
      vi.stubEnv("NODE_ENV", env);
      const csp = buildContentSecurityPolicy("test-nonce", "abcd.supabase.co");
      expect(csp).not.toMatch(/[\s:]\*(\s|$)/);
    }
  });

  it("omits 'unsafe-eval' in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = buildContentSecurityPolicy("test-nonce", "abcd.supabase.co");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows 'unsafe-eval' only in development (React's dev error overlay needs it)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const csp = buildContentSecurityPolicy("test-nonce", "abcd.supabase.co");
    expect(csp).toContain("unsafe-eval");
  });

  it("embeds the given nonce into script-src", () => {
    const csp = buildContentSecurityPolicy("abc123nonce", "abcd.supabase.co");
    expect(csp).toContain("'nonce-abc123nonce'");
  });

  it("sets object-src to 'none' (blocks Flash/plugin-based XSS vectors)", () => {
    const csp = buildContentSecurityPolicy("n", "abcd.supabase.co");
    expect(csp).toContain("object-src 'none'");
  });

  it("sets frame-ancestors to 'none' (blocks clickjacking)", () => {
    const csp = buildContentSecurityPolicy("n", "abcd.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("includes both https and wss Supabase origins when a hostname is given", () => {
    const csp = buildContentSecurityPolicy("n", "abcd.supabase.co");
    expect(csp).toContain("https://abcd.supabase.co");
    expect(csp).toContain("wss://abcd.supabase.co");
  });

  it("degrades gracefully with no Supabase hostname (no dangling 'https://' token)", () => {
    const csp = buildContentSecurityPolicy("n", null);
    expect(csp).not.toContain("https:// ");
    expect(csp).not.toContain("undefined");
  });

  it("allow-lists exactly the known Monnify origins for script/connect/frame", () => {
    const csp = buildContentSecurityPolicy("n", "abcd.supabase.co");
    for (const directive of ["script-src", "connect-src", "frame-src"]) {
      const line = csp.split("; ").find((d) => d.startsWith(directive));
      expect(line).toContain("https://sdk.monnify.com");
      expect(line).toContain("https://api.monnify.com");
      expect(line).toContain("https://sandbox.monnify.com");
    }
  });
});
