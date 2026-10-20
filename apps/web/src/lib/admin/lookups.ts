import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { distinctIds } from "./query";

export type AdminClient = ReturnType<typeof createAdminClient>;

export interface ProfileSummary {
  readonly id: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly status: "active" | "suspended" | "deleted";
}

/** Throws on a Supabase error; the admin pages let (admin)/error.tsx handle it. */
export function unwrap<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** Ids per `.in()` query: 100 uuids is about 3.7 KB of URL, well under PostgREST's request-line limit. */
const ID_CHUNK = 100;

/** Runs `fetchChunk` over `ids` in chunks of ID_CHUNK concurrently and concatenates the rows. */
async function inChunks<Row>(ids: readonly string[], fetchChunk: (chunk: string[]) => PromiseLike<Row[]>): Promise<Row[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
  return (await Promise.all(chunks.map((chunk) => fetchChunk(chunk)))).flat();
}

/** Batch profile lookup (one query per 100 ids) keyed by user id. */
export async function loadProfiles(admin: AdminClient, ids: readonly (string | null | undefined)[]): Promise<Map<string, ProfileSummary>> {
  const unique = distinctIds(ids);
  if (unique.length === 0) return new Map();

  const rows = await inChunks(unique, async (chunk) => unwrap(await admin.from("profiles").select("id, full_name, phone, status").in("id", chunk)) ?? []);
  return new Map(rows.map((row) => [row.id, { id: row.id, fullName: row.full_name, phone: row.phone, status: row.status }]));
}

/** Batch order-code lookup (one query per 100 ids) keyed by order id. */
export async function loadOrderCodes(admin: AdminClient, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = distinctIds(ids);
  if (unique.length === 0) return new Map();

  const rows = await inChunks(unique, async (chunk) => unwrap(await admin.from("orders").select("id, code").in("id", chunk)) ?? []);
  return new Map(rows.map((row) => [row.id, row.code]));
}

/** Batch vendor-name lookup (one query per 100 ids) keyed by vendor id. */
export async function loadVendorNames(admin: AdminClient, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = distinctIds(ids);
  if (unique.length === 0) return new Map();

  const rows = await inChunks(unique, async (chunk) => unwrap(await admin.from("vendors").select("id, name").in("id", chunk)) ?? []);
  return new Map(rows.map((row) => [row.id, row.name]));
}
