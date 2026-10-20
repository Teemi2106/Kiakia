import "server-only";
import type { Json } from "@kiakia/db";
import { z } from "zod";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrderCodes, loadProfiles, loadVendorNames } from "./lookups";
import { emptyPage, optionalUuid, pageWindow, type Page, type PageParams } from "./query";

export const AUDIT_TARGET_TYPES = ["user", "vendor", "rider", "rider_document", "order", "service_area", "export", "platform_setting"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface AuditLogFilters extends PageParams {
  /** Exact action, e.g. "vendor.set_commission". */
  readonly action?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly actorId?: string;
}

export interface AuditLogItem {
  readonly id: string;
  readonly actorId: string;
  readonly actorName: string | null;
  readonly action: string;
  readonly targetType: AuditTargetType;
  readonly targetId: string;
  /** Who or what the action was done to (a person, store or order code); null for anything without a name. */
  readonly targetName: string | null;
  readonly reason: string | null;
  /** Before/after values and other context the RPC recorded. */
  readonly details: Json;
  readonly createdAt: string;
}

const filterSchema = z.object({
  action: z
    .string()
    .regex(/^[a-z_.]{1,64}$/)
    .optional()
    .catch(undefined),
  targetType: z.enum(AUDIT_TARGET_TYPES).optional().catch(undefined),
  targetId: optionalUuid,
  actorId: optionalUuid,
});

export async function listAuditLog(filters: AuditLogFilters = {}): Promise<Page<AuditLogItem>> {
  await requireAdminContext();
  const admin = createAdminClient();
  const { page, pageSize, from, to } = pageWindow(filters);
  const parsed = filterSchema.parse(filters);

  let query = admin
    .from("admin_audit_log")
    .select("id, actor_id, action, target_type, target_id, reason, details, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (parsed.action) query = query.eq("action", parsed.action);
  if (parsed.targetType) query = query.eq("target_type", parsed.targetType);
  if (parsed.targetId) query = query.eq("target_id", parsed.targetId);
  if (parsed.actorId) query = query.eq("actor_id", parsed.actorId);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return { ...emptyPage<AuditLogItem>(filters), total: count ?? 0 };

  const idsOf = (...types: AuditTargetType[]) => data.filter((entry) => types.includes(entry.target_type)).map((entry) => entry.target_id);
  const [people, vendors, orders] = await Promise.all([
    loadProfiles(admin, [...data.map((entry) => entry.actor_id), ...idsOf("user", "rider")]),
    loadVendorNames(admin, idsOf("vendor")),
    loadOrderCodes(admin, idsOf("order")),
  ]);
  const targetNameOf = (type: AuditTargetType, id: string): string | null => {
    if (type === "user" || type === "rider") return people.get(id)?.fullName ?? null;
    if (type === "vendor") return vendors.get(id) ?? null;
    if (type === "order") return orders.get(id) ?? null;
    return null;
  };

  return {
    rows: data.map((entry) => ({
      id: entry.id,
      actorId: entry.actor_id,
      actorName: people.get(entry.actor_id)?.fullName ?? null,
      action: entry.action,
      targetType: entry.target_type,
      targetId: entry.target_id,
      targetName: targetNameOf(entry.target_type, entry.target_id),
      reason: entry.reason,
      details: entry.details,
      createdAt: entry.created_at,
    })),
    total: count ?? data.length,
    page,
    pageSize,
  };
}
