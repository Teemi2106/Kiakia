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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

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
              for (const { name, value } of cookiesToSet) {
                request.cookies.set(name, value);
              }
              response = NextResponse.next({
                request: { headers: requestHeaders },
              });
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
      response = NextResponse.redirect(loginUrl);
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
