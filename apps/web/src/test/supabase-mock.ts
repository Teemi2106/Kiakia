import { vi } from "vitest";

export interface QueryResult<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export function ok<T>(data: T): QueryResult<T> {
  return { data, error: null };
}

export function fail(message: string, code?: string): QueryResult<never> {
  return { data: null, error: { message, code } };
}

const CHAIN_METHODS = ["select", "eq", "neq", "in", "order", "limit", "gt", "lt", "not", "or", "match"] as const;

/**
 * A stand-in for a Supabase PostgrestFilterBuilder. Every filter/modifier
 * method returns itself (chainable); the builder itself is also thenable so
 * `await supabase.from(x).select().eq(...)` resolves without a terminal
 * `.single()` call, matching how the real client behaves.
 */
export function queryBuilder<T>(result: QueryResult<T>) {
  const builder: Record<string, unknown> = {};
  for (const method of CHAIN_METHODS) {
    builder[method] = vi.fn(() => builder);
  }
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (onFulfilled: (r: QueryResult<T>) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

export interface SupabaseMockOptions {
  from?: Record<string, ReturnType<typeof queryBuilder>>;
  rpc?: Record<string, QueryResult>;
  authUser?: { id: string; email?: string | null; phone?: string | null } | null;
  /**
   * Extra/overriding `auth.*` method mocks (signUp, signInWithPassword,
   * resetPasswordForEmail, updateUser, signOut, ...) — merged over the
   * default `getUser`. Each not explicitly given here throws when called,
   * same "no silent undefined" rule as `from`/`rpc`.
   */
  auth?: Record<string, ReturnType<typeof vi.fn>>;
}

/**
 * Minimal stand-in for the return value of createClient()/createAdminClient().
 * Throws loudly (rather than returning undefined) when a test exercises a
 * table/RPC/auth method it forgot to mock — a silent `undefined.select is
 * not a function` is much harder to debug than a clear "no mock configured".
 */
export interface SupabaseClientMock {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  // Indexed so call sites can reference any auth.* method (signUp,
  // signInWithPassword, resetPasswordForEmail, ...) without a cast.
  auth: { getUser: ReturnType<typeof vi.fn> } & Record<string, ReturnType<typeof vi.fn>>;
}

export function supabaseClientMock(opts: SupabaseMockOptions = {}): SupabaseClientMock {
  return {
    from: vi.fn((table: string) => {
      const b = opts.from?.[table];
      if (!b) throw new Error(`supabaseClientMock: no mock configured for table "${table}"`);
      return b;
    }),
    rpc: vi.fn((fn: string) => {
      const r = opts.rpc?.[fn];
      if (!r) throw new Error(`supabaseClientMock: no mock configured for rpc "${fn}"`);
      return Promise.resolve(r);
    }),
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve(
          opts.authUser
            ? { data: { user: opts.authUser }, error: null }
            : { data: { user: null }, error: { message: "not authenticated" } },
        ),
      ),
      ...opts.auth,
    },
  };
}
