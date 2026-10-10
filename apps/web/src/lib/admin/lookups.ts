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

/** Batch profile lookup (one query for any number of ids) keyed by user id. */
export async function loadProfiles(admin: AdminClient, ids: readonly (string | null | undefined)[]): Promise<Map<string, ProfileSummary>> {
  const unique = distinctIds(ids);
  if (unique.length === 0) return new Map();

  const rows = unwrap(await admin.from("profiles").select("id, full_name, phone, status").in("id", unique)) ?? [];
  return new Map(rows.map((row) => [row.id, { id: row.id, fullName: row.full_name, phone: row.phone, status: row.status }]));
}

/** Batch vendor-name lookup keyed by vendor id. */
export async function loadVendorNames(admin: AdminClient, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = distinctIds(ids);
  if (unique.length === 0) return new Map();

  const rows = unwrap(await admin.from("vendors").select("id, name").in("id", unique)) ?? [];
  return new Map(rows.map((row) => [row.id, row.name]));
}
