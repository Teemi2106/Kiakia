// Swapped in for the real "server-only" package under Vitest (see
// vitest.config.ts's resolve.alias) — the real package unconditionally
// throws on import, which is correct in the Next.js build but wrong for a
// Node test runner that legitimately imports server-only modules.
export {};
