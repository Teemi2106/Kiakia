import { requireAdminContext } from "@/lib/auth/dal";
import { createLaunchUnsubscribeToken } from "@/lib/launch/unsubscribe-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_SIZE = 1000;
const MAX_EXPORT = 50_000;

export async function GET() {
  const session = await requireAdminContext();
  const admin = createAdminClient();
  const { data: exportId, error: auditError } = await admin.rpc("admin_log_launch_subscribers_export", {
    p_actor_id: session.userId,
  });
  if (auditError || !exportId) return Response.json({ error: "Could not record the export." }, { status: 500 });
  const subscribers: { email: string; consented_at: string; unsubscribe_url: string }[] = [];
  let total = 0;

  while (total < MAX_EXPORT) {
    const limit = Math.min(BATCH_SIZE, MAX_EXPORT - total);
    const { data, error } = await admin
      .from("launch_subscribers")
      .select("id, email, consented_at")
      .is("unsubscribed_at", null)
      .order("id", { ascending: true })
      .range(total, total + limit - 1);

    if (error) return Response.json({ error: "Could not create the export." }, { status: 500 });
    const rows = data ?? [];
    if (rows.length === 0) break;

    const issued = rows.map((subscriber) => {
      const { token, tokenHash } = createLaunchUnsubscribeToken();
      return {
        subscriber_id: subscriber.id,
        token_hash: tokenHash,
        email: subscriber.email,
        consented_at: subscriber.consented_at,
        token,
      };
    });
    const { data: issuedCount, error: tokenError } = await admin.rpc("issue_launch_unsubscribe_tokens", {
      p_tokens: issued.map(({ subscriber_id, token_hash }) => ({ subscriber_id, token_hash })),
    });
    if (tokenError) return Response.json({ error: "Could not create the export." }, { status: 500 });
    if (issuedCount !== rows.length) return Response.json({ error: "The subscriber list changed during export. Please try again." }, { status: 409 });

    for (const subscriber of issued) {
      const unsubscribeUrl = new URL("/launch/unsubscribe", serverEnv.NEXT_PUBLIC_SITE_URL);
      unsubscribeUrl.searchParams.set("token", subscriber.token);
      subscribers.push({
        email: subscriber.email,
        consented_at: subscriber.consented_at,
        unsubscribe_url: unsubscribeUrl.toString(),
      });
    }
    total += rows.length;
    if (rows.length < limit) break;
  }

  const body = JSON.stringify({
    generated_at: new Date().toISOString(),
    truncated: total === MAX_EXPORT,
    subscribers,
  }, null, 2);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="kiakia-launch-subscribers-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Export-Id": exportId,
    },
  });
}
