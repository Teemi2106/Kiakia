import "server-only";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { cache } from "react";
import { z } from "zod";
import { readDispatchHistory, type DispatchHistory } from "./dispatch-history";
import { readDispatchStatus, type DispatchStatus, type WaitingOrder } from "./dispatch-info";
import { readDispatchMetrics, type DispatchMetrics } from "./dispatch-metrics";
import {
  DISPATCH_DEFAULTS,
  DISPATCH_SETTING_KEYS,
  DISPATCH_VALUE_FIELD,
  type DispatchSettingKey,
  type DispatchSettingsValues,
} from "./dispatch-settings-info";
import { loadProfiles, unwrap } from "./lookups";

/**
 * Loaders for the "Waiting for a rider" page, the Overview tile, the order page
 * notice, the per-order history, the metrics panel and the Rider matching
 * settings. The page, the tile and the notice all read admin_dispatch_status()
 * (0097/0102), the single source of truth for "ready, no rider"; settings come
 * from platform_settings.
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

/** Pure: turns the raw platform_settings rows into the values the page and the action need. A missing row falls back to the shipped default. */
export function toDispatchValues(rows: readonly { key: string; value: number }[]): DispatchSettingsValues {
  const values: Record<keyof DispatchSettingsValues, number> = { ...DISPATCH_DEFAULTS };
  for (const key of DISPATCH_SETTING_KEYS) {
    const row = rows.find((candidate) => candidate.key === key);
    if (row) values[DISPATCH_VALUE_FIELD[key]] = row.value;
  }
  return values;
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

/** One admin_dispatch_status() call per request, shared by the page, the tile and the order notice. */
const fetchStatus = cache(async (): Promise<DispatchStatus> => {
  const { data, error } = await createAdminClient().rpc("admin_dispatch_status");
  if (error) throw new Error(error.message);
  return readDispatchStatus(data);
});

/** Everything the Waiting for a rider page shows: orders with no rider (longest wait first, capped at 50 by the database) and the upcoming ones. */
export async function getDispatchStatus(): Promise<DispatchStatus> {
  await requireAdminContext();
  return fetchStatus();
}

export async function listWaitingForRider(): Promise<readonly WaitingOrder[]> {
  return (await getDispatchStatus()).orders;
}

export interface DispatchOverview {
  /** Orders the system has flagged (two rounds with no accept, errors, nobody nearby for a while). */
  readonly needsAttention: number;
  /** Orders with no rider yet that are being searched for or waiting on someone. */
  readonly waiting: number;
  /** Of those, how many have a rider being asked right now. */
  readonly askingNow: number;
  /** Accepted orders whose search starts later. */
  readonly startingLater: number;
}

/** The Overview tile's numbers, from the same call as the page. */
export async function getDispatchOverview(): Promise<DispatchOverview> {
  const status = await getDispatchStatus();
  return {
    needsAttention: status.needsAttentionCount,
    waiting: status.orders.length,
    askingNow: status.orders.filter((order) => order.liveOffer !== null).length,
    startingLater: status.upcoming.length,
  };
}

/** The waiting-for-a-rider entry for one order, or null when it has a rider or has not been waiting long. */
export async function getWaitingForOrder(orderId: string): Promise<WaitingOrder | null> {
  return (await listWaitingForRider()).find((order) => order.orderId === orderId) ?? null;
}

/** Every rider asked for one order, how each answered, and the key events. Null when the order does not exist. */
export async function getDispatchHistory(orderId: string): Promise<DispatchHistory | null> {
  await requireAdminContext();
  if (!z.string().uuid().safeParse(orderId).success) return null;
  const { data, error } = await createAdminClient().rpc("admin_dispatch_order_history", { p_order_id: orderId });
  if (error?.code === "P0002") return null;
  if (error) throw new Error(error.message);
  return readDispatchHistory(data);
}

/** The last 7 days (the database's default window). */
export async function getDispatchMetrics(): Promise<DispatchMetrics> {
  await requireAdminContext();
  const { data, error } = await createAdminClient().rpc("admin_dispatch_metrics", {});
  if (error) throw new Error(error.message);
  return readDispatchMetrics(data);
}
