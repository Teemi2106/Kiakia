import type { Database } from "@kiakia/db";
import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "./lib/env.client";
import { buildContentSecurityPolicy, generateNonce } from "./lib/security/csp";

/**
 * Runs on (almost) every request. Two jobs, per the Next.js authentication
 * guide's "optimistic checks with Proxy" pattern:
 *
 * 1. Refresh the Supabase session cookie so it doesn't expire mid-visit.
 * 2. Bounce unauthenticated users off customer/vendor routes before a
 *    Server Component even starts rendering.
 *
 * This is NOT the authorization boundary — it only proves "is someone
 * logged in," using `getUser()` (which revalidates the JWT against
 * Supabase Auth, unlike `getSession()`, which trusts the cookie's decoded
 * claims). Role checks (customer vs vendor_staff) happen in the DAL
 * (lib/auth/dal.ts) inside each route group's layout and inside every
 * Server Action, which is what actually gates access to data.
 *
 * It also generates a per-request CSP nonce — see lib/security/csp.ts.
 */

const PROTECTED_PREFIXES = ["/home", "/cart", "/checkout", "/orders", "/profile", "/dashboard"];

function requiresAuth(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (requiresAuth(pathname) && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    response = NextResponse.redirect(loginUrl);
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|avif)$).*)"],
};
