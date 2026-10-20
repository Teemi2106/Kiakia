import "server-only";
import { mealCategoryLabel } from "@kiakia/domain";
import type { VendorRow } from "@kiakia/db";
import { z } from "zod";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnerBalance, loadRecentPayouts, type OwnerBalance, type PayoutRecord } from "./finance";
import { loadProfiles, unwrap, type AdminClient, type ProfileSummary } from "./lookups";
import { loadRecentOrders, type RecentOrderView } from "./orders";
import { loadRecentVendorRatings, type VendorRatingView } from "./ratings";
import { orIlike, pageWindow, searchTerm, type Page, type PageParams } from "./query";

export interface VendorListFilters extends PageParams {
  /** Matches the store name, or the owner's name or phone. */
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

/** Owner profiles a search may match; 50 uuids keep the request URL well under PostgREST's limit. */
const OWNER_MATCH_CAP = 50;

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

  if (term) {
    // An account that is both customer and vendor is found by the person's own name or phone as well as the store's.
    const owners = unwrap(await admin.from("profiles").select("id").or(orIlike(["full_name", "phone"], term)).limit(OWNER_MATCH_CAP)) ?? [];
    const ownerFilter = owners.length ? `,owner_user_id.in.(${owners.map((owner) => owner.id).join(",")})` : "";
    query = query.or(`name.ilike.%${term}%${ownerFilter}`);
  }
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

export type VendorStatus = VendorRow["status"];

/** Stores per status, for the Vendors page tabs. */
export async function countVendorsByStatus(): Promise<Record<VendorStatus, number>> {
  await requireAdminContext();
  const admin = createAdminClient();
  const statuses = ["pending", "active", "suspended"] as const;
  const counts = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await admin.from("vendors").select("id", { count: "exact", head: true }).eq("status", status);
      if (error) throw new Error(error.message);
      return count ?? 0;
    }),
  );
  return { pending: counts[0], active: counts[1], suspended: counts[2] };
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
  /** Read-only view of the vendor's menu: categories with their items. */
  readonly menu: VendorMenuView;
  /** Newest first, last 20. */
  readonly recentRatings: readonly VendorRatingView[];
}

export interface VendorMenuItemView {
  readonly id: string;
  readonly name: string;
  readonly priceKobo: number;
  readonly isAvailable: boolean;
}

export interface VendorMenuCategoryView {
  /** Null for the group of items that have no category. */
  readonly id: string | null;
  readonly categoryKey: string | null;
  readonly label: string;
  readonly isActive: boolean;
  readonly items: readonly VendorMenuItemView[];
}

export interface VendorMenuView {
  readonly categories: readonly VendorMenuCategoryView[];
  /** True when the vendor has more than MENU_ITEM_CAP items and the list was cut. */
  readonly truncated: boolean;
}

/** Upper bound on items loaded for the read-only menu view. */
export const MENU_ITEM_CAP = 500;

async function loadVendorMenu(admin: AdminClient, vendorId: string): Promise<VendorMenuView> {
  const [categoryRows, itemRows] = await Promise.all([
    admin.from("menu_categories").select("id, category_key, sort_order, is_active").eq("vendor_id", vendorId).order("sort_order"),
    // One over the cap so "exactly at the cap" is not reported as truncated.
    admin
      .from("menu_items")
      .select("id, category_id, name, price_kobo, is_available, sort_order")
      .eq("vendor_id", vendorId)
      .order("sort_order")
      .order("name")
      .limit(MENU_ITEM_CAP + 1),
  ]);
  const categories = unwrap(categoryRows) ?? [];
  const allItems = unwrap(itemRows) ?? [];
  const truncated = allItems.length > MENU_ITEM_CAP;
  const items = truncated ? allItems.slice(0, MENU_ITEM_CAP) : allItems;

  const byCategory = new Map<string | null, VendorMenuItemView[]>();
  for (const item of items) {
    const key = item.category_id && categories.some((category) => category.id === item.category_id) ? item.category_id : null;
    byCategory.set(key, [
      ...(byCategory.get(key) ?? []),
      { id: item.id, name: item.name, priceKobo: item.price_kobo, isAvailable: item.is_available },
    ]);
  }

  const grouped: VendorMenuCategoryView[] = categories.map((category) => ({
    id: category.id,
    categoryKey: category.category_key,
    label: mealCategoryLabel(category.category_key),
    isActive: category.is_active,
    items: byCategory.get(category.id) ?? [],
  }));
  const uncategorised = byCategory.get(null);
  if (uncategorised) grouped.push({ id: null, categoryKey: null, label: "Uncategorised", isActive: true, items: uncategorised });

  return { categories: grouped, truncated };
}

export async function getVendorDetail(vendorId: string): Promise<VendorDetail | null> {
  await requireAdminContext();
  if (!z.string().uuid().safeParse(vendorId).success) return null;
  const admin = createAdminClient();

  const vendor = unwrap(await admin.from("vendors").select("*").eq("id", vendorId).maybeSingle());
  if (!vendor) return null;

  const [staffRows, recentOrders, balance, recentPayouts, menu, recentRatings] = await Promise.all([
    admin.from("vendor_staff").select("user_id, role, created_at").eq("vendor_id", vendorId),
    loadRecentOrders(admin, "vendor_id", vendorId),
    loadOwnerBalance(admin, "vendor", vendorId),
    loadRecentPayouts(admin, "vendor", vendorId),
    loadVendorMenu(admin, vendorId),
    loadRecentVendorRatings(admin, vendorId),
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
    menu,
    recentRatings,
  };
}
