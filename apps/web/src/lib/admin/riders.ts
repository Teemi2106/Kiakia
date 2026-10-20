import "server-only";
import type { RiderRow } from "@kiakia/db";
import { z } from "zod";
import { canManageFinance, requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { toBankDetails, type BankDetails } from "./bank";
import { loadOwnerBalance, loadRecentPayouts, type OwnerBalance, type PayoutRecord } from "./finance";
import { loadProfiles, unwrap, type ProfileSummary } from "./lookups";
import { loadRecentOrders, type RecentOrderView } from "./orders";
import { loadRecentRiderRatings, type RiderRatingView } from "./ratings";
import { pageWindow, type Page, type PageParams } from "./query";

/** Private storage bucket holding rider KYC uploads (0052). */
const KYC_BUCKET = "rider-kyc";
const SIGNED_URL_TTL_SECONDS = 300;

export type RiderState = "pending" | "active" | "rejected" | "suspended" | "deleted";

export interface RiderListFilters extends PageParams {
  /** Matches name, phone or plate number. */
  readonly q?: string;
  /** Approval state: pending, active, rejected or suspended; anything else is no filter. */
  readonly state?: string;
  /** "online" or "offline"; anything else is no filter. */
  readonly availability?: string;
}

export interface RiderListItem {
  readonly userId: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  readonly kycStatus: RiderRow["kyc_status"];
  /** Suspended and deleted accounts outrank the KYC decision. */
  readonly state: RiderState;
  readonly isOnline: boolean;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly lastPingAt: string | null;
  /** Documents awaiting review. */
  readonly documentsPending: number;
  readonly createdAt: string;
}

const filterSchema = z.object({
  state: z.enum(["pending", "active", "rejected", "suspended"]).optional().catch(undefined),
  availability: z.enum(["online", "offline"]).optional().catch(undefined),
});

export async function listRiders(filters: RiderListFilters = {}): Promise<Page<RiderListItem>> {
  await requireAdminContext();
  const { page, pageSize, from } = pageWindow(filters);
  const parsed = filterSchema.parse(filters);
  const term = filters.q?.trim().slice(0, 64) || null;

  const rows =
    unwrap(
      await createAdminClient().rpc("admin_list_riders", {
        p_q: term,
        p_state: parsed.state ?? null,
        p_availability: parsed.availability ?? null,
        p_limit: pageSize,
        p_offset: from,
      }),
    ) ?? [];

  return {
    rows: rows.map((rider) => ({
      userId: rider.user_id,
      fullName: rider.full_name,
      phone: rider.phone,
      vehicleType: rider.vehicle_type,
      plateNumber: rider.plate_number,
      kycStatus: rider.kyc_status,
      state: rider.state,
      isOnline: rider.is_online,
      ratingAvg: rider.rating_avg,
      ratingCount: rider.rating_count,
      lastPingAt: rider.last_ping_at,
      documentsPending: rider.documents_pending,
      createdAt: rider.created_at,
    })),
    total: rows[0]?.total_count ?? 0,
    page,
    pageSize,
  };
}

/** Riders per state, for the Riders page tabs; a state nobody is in is 0. */
export async function countRidersByState(): Promise<Record<RiderState, number>> {
  await requireAdminContext();
  const rows = unwrap(await createAdminClient().rpc("admin_rider_state_counts")) ?? [];
  const counts: Record<RiderState, number> = { pending: 0, active: 0, rejected: 0, suspended: 0, deleted: 0 };
  for (const row of rows) counts[row.state] = row.total;
  return counts;
}

export interface RiderDocumentView {
  readonly id: string;
  readonly docType: "government_id" | "drivers_license" | "vehicle_photo";
  readonly status: "pending" | "approved" | "rejected";
  /** Shown to the rider in their app. */
  readonly reviewNote: string | null;
  /** Expires after 5 minutes; null if the file is missing from storage. */
  readonly signedUrl: string | null;
  readonly updatedAt: string;
}

export interface RiderDetail {
  /** Without the bank account number; see `bank`. */
  readonly rider: Omit<RiderRow, "bank_account_number">;
  /** Account number masked, with the full one only for finance admins (canManageFinance()). */
  readonly bank: BankDetails | null;
  readonly profile: ProfileSummary | null;
  readonly documents: readonly RiderDocumentView[];
  /** Null until the rider has earned anything. */
  readonly balance: OwnerBalance | null;
  readonly recentPayouts: readonly PayoutRecord[];
  /** Newest first, last 20 orders assigned to this rider. */
  readonly recentDeliveries: readonly RecentOrderView[];
  /** Newest first, last 20 ratings customers left for this rider. */
  readonly recentRatings: readonly RiderRatingView[];
}

export async function getRiderDetail(riderId: string): Promise<RiderDetail | null> {
  await requireAdminContext();
  if (!z.string().uuid().safeParse(riderId).success) return null;
  const admin = createAdminClient();

  const row = unwrap(await admin.from("riders").select("*").eq("user_id", riderId).maybeSingle());
  if (!row) return null;
  const { bank_account_number: accountNumber, ...rider } = row;
  const bank = toBankDetails(
    { bankName: rider.bank_name, accountName: rider.bank_account_name, accountNumber },
    await canManageFinance(),
  );

  const [documentRows, profiles, balance, recentPayouts, recentDeliveries, recentRatings] = await Promise.all([
    admin.from("rider_documents").select("id, doc_type, storage_path, status, review_note, updated_at").eq("rider_id", riderId).order("doc_type"),
    loadProfiles(admin, [riderId]),
    loadOwnerBalance(admin, "rider", riderId),
    loadRecentPayouts(admin, "rider", riderId),
    loadRecentOrders(admin, "rider_id", riderId),
    loadRecentRiderRatings(admin, riderId),
  ]);

  const documents = unwrap(documentRows) ?? [];
  const signed = documents.length
    ? unwrap(
        await admin.storage.from(KYC_BUCKET).createSignedUrls(
          documents.map((document) => document.storage_path),
          SIGNED_URL_TTL_SECONDS,
        ),
      )
    : [];
  const urlByPath = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
  }

  return {
    rider,
    bank,
    profile: profiles.get(riderId) ?? null,
    documents: documents.map((document) => ({
      id: document.id,
      docType: document.doc_type,
      status: document.status,
      reviewNote: document.review_note,
      signedUrl: urlByPath.get(document.storage_path) ?? null,
      updatedAt: document.updated_at,
    })),
    balance,
    recentPayouts,
    recentDeliveries,
    recentRatings,
  };
}
