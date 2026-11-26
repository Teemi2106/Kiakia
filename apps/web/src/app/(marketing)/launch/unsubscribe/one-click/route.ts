import { createAdminClient } from "@/lib/supabase/admin";
import { hashLaunchUnsubscribeToken, isLaunchUnsubscribeToken } from "@/lib/launch/unsubscribe-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    return new Response("Unsupported unsubscribe request", { status: 415, headers: { "Cache-Control": "no-store" } });
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return new Response("Unsupported unsubscribe request", { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 200) {
      await reader.cancel();
      return new Response("Unsupported unsubscribe request", { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder().decode(bytes);
  if (new URLSearchParams(body).get("List-Unsubscribe") !== "One-Click") {
    return new Response("Unsupported unsubscribe request", { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const token = new URL(request.url).searchParams.get("token");
  if (!isLaunchUnsubscribeToken(token)) {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  const { error } = await createAdminClient().rpc("unsubscribe_launch_email", {
    p_token_hash: hashLaunchUnsubscribeToken(token),
  });
  if (error) {
    return new Response("Unsubscribe could not be completed", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
