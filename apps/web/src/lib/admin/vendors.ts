import "server-only";
import type { VendorRow } from "@kiakia/db";
import { z } from "zod";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnerBalance, loadRecentPayouts, type OwnerBalance, type PayoutRecord } from "./finance";
import { loadProfiles, unwrap, type ProfileSummary } from "./lookups";
import { loadRecentOrders, type RecentOrderView } from "./orders";
import { pageWindow, searchTerm, type Page, type PageParams } from "./query";

export interface VendorListFilters extends PageParams {
  /** Matches the store name. */
  readonly q?: string;
  readonly status?: string;
}

export interface VendorListItem {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly category: string;
  readonly status: VendorRow["status"];
  readonly kycStatus: VendorRow["kyc_status"];
  readonly commissionBps: number;
  readonly isAcceptingOrders: boolean;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly createdAt: string;
}

const statusSchema = z.enum(["pending", "active", "suspended"]).optional().catch(undefined);

export async function listVendors(filters: VendorListFilters = {}): Promise<Page<VendorListItem>> {
  await requireAdminContext();
  const admin = createAdminClient();
  const { page, pageSize, from, to } = pageWindow(filters);
  const term = searchTerm(filters.q);
  const status = statusSchema.parse(filters.status);

  let query = admin
    .from("vendors")
    .select("id, name, slug, category, status, kyc_status, commission_bps, is_accepting_orders, owner_user_id, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (term) query = query.ilike("name", `%${term}%`);
  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const owners = await loadProfiles(admin, (data ?? []).map((vendor) => vendor.owner_user_id));

  return {
    rows: (data ?? []).map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      slug: vendor.slug,
      category: vendor.category,
      status: vendor.status,
      kycStatus: vendor.kyc_status,
      commissionBps: vendor.commission_bps,
      isAcceptingOrders: vendor.is_accepting_orders,
      ownerUserId: vendor.owner_user_id,
      ownerName: owners.get(vendor.owner_user_id)?.fullName ?? null,
      createdAt: vendor.created_at,
    })),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export interface VendorStaffView {
  readonly userId: string;
  readonly role: "vendor_staff" | "vendor_manager" | "vendor_owner";
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly joinedAt: string;
}

export interface VendorDetail {
  readonly vendor: VendorRow;
  readonly owner: ProfileSummary | null;
  readonly staff: readonly VendorStaffView[];
  /** Null until the vendor has earned anything. */
  readonly balance: OwnerBalance | null;
  readonly recentPayouts: readonly PayoutRecord[];
  /** Newest first, last 20. */
  readonly recentOrders: readonly RecentOrderView[];
}

export async function getVendorDetail(vendorId: string): Promise<VendorDetail | null> {
  await requireAdminContext();
  if (!z.string().uuid().safeParse(vendorId).success) return null;
  const admin = createAdminClient();

  const vendor = unwrap(await admin.from("vendors").select("*").eq("id", vendorId).maybeSingle());
  if (!vendor) return null;

  const [staffRows, recentOrders, balance, recentPayouts] = await Promise.all([
    admin.from("vendor_staff").select("user_id, role, created_at").eq("vendor_id", vendorId),
    loadRecentOrders(admin, "vendor_id", vendorId),
    loadOwnerBalance(admin, "vendor", vendorId),
    loadRecentPayouts(admin, "vendor", vendorId),
  ]);

  const staff = unwrap(staffRows) ?? [];
  const profiles = await loadProfiles(admin, [vendor.owner_user_id, ...staff.map((member) => member.user_id)]);

  return {
    vendor,
    owner: profiles.get(vendor.owner_user_id) ?? null,
    staff: staff.map((member) => ({
      userId: member.user_id,
      role: member.role,
      fullName: profiles.get(member.user_id)?.fullName ?? null,
      phone: profiles.get(member.user_id)?.phone ?? null,
      joinedAt: member.created_at,
    })),
    balance,
    recentPayouts,
    recentOrders,
  };
}
