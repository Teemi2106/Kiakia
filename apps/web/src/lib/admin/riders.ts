import "server-only";
import type { RiderRow } from "@kiakia/db";
import { z } from "zod";
import { canManageFinance, requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { toBankDetails, type BankDetails } from "./bank";
import { loadOwnerBalance, loadRecentPayouts, type OwnerBalance, type PayoutRecord } from "./finance";
import { loadProfiles, unwrap, type ProfileSummary } from "./lookups";
import { loadRecentOrders, type RecentOrderView } from "./orders";
import { pageWindow, type Page, type PageParams } from "./query";

/** Private storage bucket holding rider KYC uploads (0052). */
const KYC_BUCKET = "rider-kyc";
const SIGNED_URL_TTL_SECONDS = 300;

export interface RiderListFilters extends PageParams {
  readonly kycStatus?: string;
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
  readonly isOnline: boolean;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly lastPingAt: string | null;
  /** Documents awaiting review. */
  readonly documentsPending: number;
  readonly createdAt: string;
}

const filterSchema = z.object({
  kycStatus: z.enum(["pending", "approved", "rejected"]).optional().catch(undefined),
  availability: z.enum(["online", "offline"]).optional().catch(undefined),
});

export async function listRiders(filters: RiderListFilters = {}): Promise<Page<RiderListItem>> {
  await requireAdminContext();
  const admin = createAdminClient();
  const { page, pageSize, from, to } = pageWindow(filters);
  const parsed = filterSchema.parse(filters);

  let query = admin
    .from("riders")
    .select("user_id, vehicle_type, plate_number, kyc_status, is_online, rating_avg, rating_count, last_ping_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (parsed.kycStatus) query = query.eq("kyc_status", parsed.kycStatus);
  if (parsed.availability) query = query.eq("is_online", parsed.availability === "online");

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const riders = data ?? [];
  const riderIds = riders.map((rider) => rider.user_id);

  const [profiles, pendingDocuments] = await Promise.all([
    loadProfiles(admin, riderIds),
    riderIds.length
      ? admin.from("rider_documents").select("rider_id").eq("status", "pending").in("rider_id", riderIds)
      : null,
  ]);
  const pendingByRider = new Map<string, number>();
  for (const document of (pendingDocuments ? unwrap(pendingDocuments) : null) ?? []) {
    pendingByRider.set(document.rider_id, (pendingByRider.get(document.rider_id) ?? 0) + 1);
  }

  return {
    rows: riders.map((rider) => ({
      userId: rider.user_id,
      fullName: profiles.get(rider.user_id)?.fullName ?? null,
      phone: profiles.get(rider.user_id)?.phone ?? null,
      vehicleType: rider.vehicle_type,
      plateNumber: rider.plate_number,
      kycStatus: rider.kyc_status,
      isOnline: rider.is_online,
      ratingAvg: rider.rating_avg,
      ratingCount: rider.rating_count,
      lastPingAt: rider.last_ping_at,
      documentsPending: pendingByRider.get(rider.user_id) ?? 0,
      createdAt: rider.created_at,
    })),
    total: count ?? 0,
    page,
    pageSize,
  };
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

  const [documentRows, profiles, balance, recentPayouts, recentDeliveries] = await Promise.all([
    admin.from("rider_documents").select("id, doc_type, storage_path, status, review_note, updated_at").eq("rider_id", riderId).order("doc_type"),
    loadProfiles(admin, [riderId]),
    loadOwnerBalance(admin, "rider", riderId),
    loadRecentPayouts(admin, "rider", riderId),
    loadRecentOrders(admin, "rider_id", riderId),
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
  };
}
