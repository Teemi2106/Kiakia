import type { Database } from "@kiakia/db";
import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "./lib/env.client";
import { buildContentSecurityPolicy, generateNonce } from "./lib/security/csp";

const PROTECTED_PREFIXES = [
  "/home",
  "/cart",
  "/checkout",
  "/orders",
  "/profile",
  "/dashboard",
  "/admin",
];

function requiresAuth(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function supabaseHost(): string | null {
  try {
    return new URL(clientEnv.NEXT_PUBLIC_SUPABASE_URL).host;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(nonce, supabaseHost());

  /**
   * Forwards the request *as it currently stands* to the render, plus the
   * CSP nonce.
   *
   * Rebuilding the headers on every call is the point. This used to hoist a
   * single `new Headers(request.headers)` snapshot taken before Supabase had
   * a chance to rotate the session, and reuse that same stale object inside
   * setAll() below. A Headers copy doesn't track later mutations of
   * request.cookies, so on any request where the session rotated, the
   * browser was sent the new cookies while the render was handed the old
   * ones — it then authenticated with a refresh token Supabase had just
   * invalidated, failed, and redirected to /login, which bounced straight
   * back to /home off the browser's valid cookies. See proxy.test.ts.
   */
  function forwardRequest() {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    return NextResponse.next({ request: { headers } });
  }

  let response = forwardRequest();

  // Skip auth checks during development if env vars are missing
  const isDev = process.env.NODE_ENV === "development";
  const isMissingSupabase =
    !clientEnv.NEXT_PUBLIC_SUPABASE_URL ||
    clientEnv.NEXT_PUBLIC_SUPABASE_URL === "http://localhost:54321";

  if (isDev && isMissingSupabase) {
    console.warn(
      "⚠️  Supabase environment variables missing - skipping auth in development",
    );
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  try {
    const supabase = createServerClient<Database>(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(
            cookiesToSet: {
              name: string;
              value: string;
              options: CookieOptions;
            }[],
          ) {
            try {
              // Mutate the incoming request first, so forwardRequest()
              // below picks the rotated cookies up — request.cookies.set
              // writes through to request.headers, which is what it reads.
              for (const { name, value } of cookiesToSet) {
                request.cookies.set(name, value);
              }
              response = forwardRequest();
              for (const { name, value, options } of cookiesToSet) {
                response.cookies.set(name, value, options);
              }
            } catch (cookieError) {
              console.warn(
                "Cookie operation failed:",
                cookieError instanceof Error
                  ? cookieError.message
                  : "Unknown error",
              );
            }
          },
        },
      },
    );

    let user = null;
    try {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch (authError) {
      console.warn(
        "Auth check failed:",
        authError instanceof Error ? authError.message : "Unknown error",
      );
      user = null;
    }

    const { pathname } = request.nextUrl;

    if (requiresAuth(pathname) && !user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);

      // Carry over whatever setAll() wrote before replacing the response.
      // Assigning a fresh NextResponse here used to discard those cookies
      // outright — and when getUser() fails because the refresh token is
      // dead, what Supabase writes is the *clearing* of the auth cookies.
      // Dropping that clear left the browser holding a token it could never
      // refresh, so every later request repeated the same failed refresh and
      // bounced back here instead of ever settling on a signed-out state.
      const redirectResponse = NextResponse.redirect(loginUrl);
      for (const cookie of response.cookies.getAll()) {
        redirectResponse.cookies.set(cookie);
      }
      response = redirectResponse;
    }
  } catch (error) {
    console.error(
      "Proxy error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    // Continue with the response
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|avif)$).*)",
  ],
};
