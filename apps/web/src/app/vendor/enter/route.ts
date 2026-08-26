import { switchToVendorAction } from "@/app/actions/session";
import { NextResponse, type NextRequest } from "next/server";

/**
 * B2 (independent security review): /vendor/layout.tsx used to call
 * setActiveRole("vendor") directly during a Server Component's render, to
 * fix an earlier /vendor/login-redirect mismatch with requireVendorContext()
 * (see (vendor)/layout.tsx). Next.js 16 forbids writing cookies during
 * render — only Server Actions and Route Handlers may do that (confirmed
 * against next/dist/docs's cookies() reference and the sealed-cookies guard
 * in adapters/request-cookies.js) — so any already-signed-in vendor hitting
 * /vendor/login or /vendor/register threw a runtime error instead of
 * bouncing cleanly to /dashboard.
 *
 * Fix: the layout now redirects an already-vendor-role session here instead
 * of setting the cookie itself. This Route Handler is allowed to write
 * cookies, so it delegates straight to switchToVendorAction() (the same
 * "switch into vendor mode" primitive the rest of the app uses,
 * app/actions/session.ts) rather than duplicating its role check/cookie
 * write/redirect logic — that function already re-verifies the caller
 * actually holds a vendor role (never trusts that only a legitimately
 * vendor-eligible layout could have linked here) and redirects to
 * /onboarding if not.
 *
 * Security review (round 2, nit): this is a `GET` Route Handler that writes
 * a cookie — CSRF-reachable from any cross-site navigation, `<img>` tag, or
 * link, not just the same-origin redirect (vendor)/layout.tsx issues. Impact
 * is capped (it can only switch an account that already holds a vendor role
 * into vendor mode — switchToVendorAction() re-checks that), but costs
 * nothing to narrow: reject any request whose `Sec-Fetch-Site` header
 * declares a cross-site origin, since the only legitimate caller today is
 * vendor/layout.tsx's own same-origin redirect chain. Fails open when the
 * header is absent (older browsers/clients that don't send it) rather than
 * blocking a same-origin caller outright — a full fix (e.g. requiring a
 * same-origin POST instead of a bare GET) would mean restructuring how
 * vendor/layout.tsx hands off to this route, which is a bigger change than
 * this nit warrants on its own.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.redirect(new URL("/vendor/login", request.url));
  }

  await switchToVendorAction();
}
