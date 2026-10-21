import "server-only";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Audience, Category, Channel } from "@/lib/messaging/audience";
import { pageWindow, type Page, type PageParams } from "./query";
import { audiencePreviewFrom, broadcastDetailFrom, broadcastRowFrom, userMessageRowFrom } from "./messages-map";
import type { AudiencePreview, BroadcastDetail, BroadcastListItem, UserMessage } from "./messages-map";

export type { AudiencePreview, BroadcastCounts, BroadcastDetail, BroadcastListItem, UserMessage } from "./messages-map";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRows(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

function fail(error: { message: string }): never {
  throw new Error(error.message);
}

/** How many people a message would reach, and why others are skipped. Counted by the database, not guessed here. */
export async function previewAudience(audience: Audience, channel: Channel, category: Category): Promise<AudiencePreview> {
  await requireAdminContext();
  const { data, error } = await createAdminClient().rpc("admin_audience_preview", {
    p_audience: audience,
    p_channel: channel,
    p_category: category,
  });
  if (error) fail(error);
  return audiencePreviewFrom(Array.isArray(data) ? data[0] : data);
}

export async function listBroadcasts(params: PageParams = {}): Promise<Page<BroadcastListItem>> {
  await requireAdminContext();
  const { page, pageSize, from } = pageWindow(params);
  const { data, error } = await createAdminClient().rpc("admin_list_broadcasts", { p_limit: pageSize, p_offset: from });
  if (error) fail(error);
  const rows = asRows(data).map(broadcastRowFrom);
  return { rows: rows.map((row) => row.item), total: rows[0]?.total ?? 0, page, pageSize };
}

/** One message with its delivery counts and up to 20 failures; null when it does not exist. */
export async function getBroadcast(id: string): Promise<BroadcastDetail | null> {
  await requireAdminContext();
  if (!UUID.test(id)) return null;
  const { data, error } = await createAdminClient().rpc("admin_get_broadcast", { p_id: id });
  if (error) {
    if (error.code === "P0002") return null;
    fail(error);
  }
  const raw = Array.isArray(data) ? data[0] : data;
  return raw ? broadcastDetailFrom(raw) : null;
}

/** The latest messages sent to one person (any channel, any category). */
export async function listUserMessages(userId: string, limit = 10): Promise<UserMessage[]> {
  await requireAdminContext();
  if (!UUID.test(userId)) return [];
  const { data, error } = await createAdminClient().rpc("admin_list_user_messages", { p_user_id: userId, p_limit: limit });
  if (error) fail(error);
  return asRows(data).map(userMessageRowFrom);
}
