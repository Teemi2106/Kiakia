import { type NextRequest, NextResponse } from "next/server";

/**
 * Short link used in promotional texts: /u/<token>. Only redirects to the
 * confirm page, so a link previewer opening it unsubscribes nobody.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = new URL("/unsubscribe", request.url);
  target.searchParams.set("token", token.slice(0, 512));
  return NextResponse.redirect(target, 303);
}
