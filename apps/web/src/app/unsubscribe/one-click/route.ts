import { type NextRequest, NextResponse } from "next/server";
import { applyUnsubscribe } from "@/lib/messaging/unsubscribe";

/**
 * RFC 8058 one-click unsubscribe. Mail clients that honour the
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header POST to the URL in
 * `List-Unsubscribe`, which is `/unsubscribe?token=<token>`: proxy.ts rewrites
 * a plain POST there to this handler (a page cannot answer a POST that is not a
 * Server Action). No cookies, no interaction; the signed token is the only
 * credential.
 *
 * GET never changes anything (link scanners and previewers fetch URLs): it
 * sends the person to the confirm page instead.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? request.nextUrl.searchParams.get("t");
  const outcome = await applyUnsubscribe(token);
  if (outcome === "invalid") return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  if (outcome === "failed") return NextResponse.json({ error: "try_again" }, { status: 503 });
  return NextResponse.json({ ok: true });
}

export function GET(request: NextRequest) {
  const target = new URL("/unsubscribe", request.url);
  const token = request.nextUrl.searchParams.get("token") ?? request.nextUrl.searchParams.get("t");
  if (token) target.searchParams.set("token", token);
  return NextResponse.redirect(target, 303);
}
