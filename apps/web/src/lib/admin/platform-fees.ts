import "server-only";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlatformFeeKey } from "@/lib/validation/admin";
import { loadProfiles, unwrap } from "./lookups";

export interface PlatformFeeValue {
  readonly key: PlatformFeeKey;
  readonly valueBps: number;
  readonly updatedAt: string;
  readonly updatedByName: string | null;
}

export interface FeeChange {
  readonly id: string;
  readonly at: string;
  readonly actorName: string | null;
  readonly action: string;
  readonly reason: string | null;
  /** Before/after of a platform_fee.set change; null for other fee edits, which the audit log explains. */
  readonly change: { readonly key: string; readonly from: number; readonly to: number } | null;
}

const FEE_ACTIONS = ["platform_fee.set", "service_area.update", "vendor.set_commission"];

/**
 * Current platform fees, read straight from the database on every call (no
 * caching): the Settings page must show what place_order() will apply to the
 * very next order.
 */
export async function getPlatformFees(): Promise<PlatformFeeValue[]> {
  await requireAdminContext();
  const admin = createAdminClient();
  const rows = unwrap(await admin.from("platform_settings").select("key, value_int, updated_at, updated_by")) ?? [];
  const people = await loadProfiles(admin, rows.map((row) => row.updated_by));

  return rows
    .filter((row): row is typeof row & { key: PlatformFeeKey } => row.key === "service_fee_bps" || row.key === "default_vendor_commission_bps")
    .map((row) => ({
      key: row.key,
      valueBps: Number(row.value_int),
      updatedAt: row.updated_at,
      updatedByName: row.updated_by ? (people.get(row.updated_by)?.fullName ?? null) : null,
    }));
}

/** The last few fee edits of every kind (platform, delivery area, vendor commission), newest first. */
export async function listRecentFeeChanges(limit = 8): Promise<FeeChange[]> {
  await requireAdminContext();
  const admin = createAdminClient();
  const rows =
    unwrap(
      await admin
        .from("admin_audit_log")
        .select("id, actor_id, action, reason, details, created_at")
        .in("action", FEE_ACTIONS)
        .order("created_at", { ascending: false })
        .limit(limit),
    ) ?? [];
  const people = await loadProfiles(admin, rows.map((row) => row.actor_id));

  return rows.map((row) => {
    const details = row.details as { key?: unknown; from?: unknown; to?: unknown } | null;
    const change =
      row.action === "platform_fee.set" && typeof details?.key === "string" && typeof details.from === "number" && typeof details.to === "number"
        ? { key: details.key, from: details.from, to: details.to }
        : null;
    return {
      id: row.id,
      at: row.created_at,
      actorName: people.get(row.actor_id)?.fullName ?? null,
      action: row.action,
      reason: row.reason,
      change,
    };
  });
}
