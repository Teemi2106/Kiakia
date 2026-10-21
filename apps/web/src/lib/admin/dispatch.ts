import "server-only";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { cache } from "react";
import { DISPATCH_SETTING_KEYS, type DispatchSettingKey, type DispatchSettingsValues } from "./dispatch-settings-info";
import { mapStatusPayload, type DispatchStatusPayload, type WaitingOrder } from "./dispatch-info";
import { loadProfiles, unwrap } from "./lookups";

/**
 * Loaders for the "Waiting for a rider" page, the Overview tile, the order page
 * notice and the Rider matching settings. The page, the tile and the notice all
 * read admin_dispatch_status() (0097), the single source of truth for "ready,
 * no rider"; settings come from platform_settings.
 *
 * TODO(0097): admin_dispatch_status is not in packages/db's generated types
 * until they are regenerated. fetchStatus() calls it through a narrow cast;
 * remove the cast once the type exists.
 */

export interface DispatchSettingValue {
  readonly key: DispatchSettingKey;
  readonly value: number;
  readonly updatedAt: string;
  readonly updatedByName: string | null;
}

export interface DispatchSettings {
  readonly values: DispatchSettingsValues;
  /** Every dispatch_* setting the database has, with who last changed it. */
  readonly rows: readonly DispatchSettingValue[];
}

/** Used only when a setting row is missing: the 0097 defaults. */
const FALLBACK: DispatchSettingsValues = { radiusM: 0, maxRiders: 10, widenAfterSeconds: 60, notifyVendorAfterSeconds: 45 };

/** Pure: turns the raw platform_settings rows into the values the page and the action need. */
export function toDispatchValues(rows: readonly { key: string; value: number }[]): DispatchSettingsValues {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    radiusM: byKey.get("dispatch_radius_m") ?? FALLBACK.radiusM,
    maxRiders: byKey.get("dispatch_max_riders") ?? FALLBACK.maxRiders,
    widenAfterSeconds: byKey.get("dispatch_widen_after_seconds") ?? FALLBACK.widenAfterSeconds,
    notifyVendorAfterSeconds: byKey.get("dispatch_notify_vendor_after_seconds") ?? FALLBACK.notifyVendorAfterSeconds,
  };
}

const SETTING_KEYS: readonly string[] = DISPATCH_SETTING_KEYS;

/** Current rider-matching settings, read straight from the database on every call (no caching). */
export async function getDispatchSettings(): Promise<DispatchSettings> {
  await requireAdminContext();
  const admin = createAdminClient();
  const all = unwrap(await admin.from("platform_settings").select("key, value_int, updated_at, updated_by")) ?? [];
  const mine = all.filter((row) => SETTING_KEYS.includes(row.key) && row.value_int !== null);
  const people = await loadProfiles(admin, mine.map((row) => row.updated_by));

  return {
    values: toDispatchValues(mine.map((row) => ({ key: row.key, value: Number(row.value_int) }))),
    rows: mine.map((row) => ({
      key: row.key as DispatchSettingKey,
      value: Number(row.value_int),
      updatedAt: row.updated_at,
      updatedByName: row.updated_by ? (people.get(row.updated_by)?.fullName ?? null) : null,
    })),
  };
}

/** Audit action the backend writes for rider-matching changes (0097), details {key, unit, from, to}. */
export const DISPATCH_AUDIT_ACTIONS = ["dispatch_setting.set"] as const;

export interface DispatchChange {
  readonly id: string;
  readonly at: string;
  readonly actorName: string | null;
  readonly reason: string | null;
  /** Before/after as stored; null when the audit row has no readable details. */
  readonly change: { readonly key: string; readonly from: number; readonly to: number } | null;
}

/** The last few rider-matching changes, newest first. */
export async function listRecentDispatchChanges(limit = 8): Promise<DispatchChange[]> {
  await requireAdminContext();
  const admin = createAdminClient();
  const rows =
    unwrap(
      await admin
        .from("admin_audit_log")
        .select("id, actor_id, action, reason, details, created_at")
        .in("action", [...DISPATCH_AUDIT_ACTIONS])
        .order("created_at", { ascending: false })
        .limit(limit),
    ) ?? [];
  const people = await loadProfiles(admin, rows.map((row) => row.actor_id));

  return rows.map((row) => {
    const details = row.details as { key?: unknown; from?: unknown; to?: unknown } | null;
    const change =
      typeof details?.key === "string" && typeof details.from === "number" && typeof details.to === "number"
        ? { key: details.key, from: details.from, to: details.to }
        : null;
    return { id: row.id, at: row.created_at, actorName: people.get(row.actor_id)?.fullName ?? null, reason: row.reason, change };
  });
}

type StatusRpc = (fn: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** One admin_dispatch_status() call per request, shared by the page, the tile and the order notice. */
const fetchStatus = cache(async (): Promise<WaitingOrder[]> => {
  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as StatusRpc;
  const { data, error } = await rpc("admin_dispatch_status");
  if (error) throw new Error(error.message);
  return mapStatusPayload(data as DispatchStatusPayload | null);
});

/** Orders that are ready with no rider, longest wait first (the database caps this at 50). */
export async function listWaitingForRider(): Promise<WaitingOrder[]> {
  await requireAdminContext();
  return fetchStatus();
}

/** How many orders are ready with no rider: the Overview tile. Same call as the page. */
export async function countWaitingForRider(): Promise<number> {
  return (await listWaitingForRider()).length;
}

/** The waiting-for-a-rider entry for one order, or null when it has a rider or has not been waiting long. */
export async function getWaitingForOrder(orderId: string): Promise<WaitingOrder | null> {
  return (await listWaitingForRider()).find((order) => order.orderId === orderId) ?? null;
}
