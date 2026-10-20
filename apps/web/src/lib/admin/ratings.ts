import "server-only";
import { loadOrderCodes, loadProfiles, unwrap, type AdminClient } from "./lookups";

export interface VendorRatingView {
  readonly orderId: string;
  readonly orderCode: string | null;
  readonly rating: number;
  readonly comment: string | null;
  readonly customerName: string | null;
  readonly createdAt: string;
}

export interface RiderRatingView {
  readonly orderId: string;
  readonly orderCode: string | null;
  readonly rating: number;
  readonly comment: string | null;
  readonly createdAt: string;
}

/** A vendor's newest ratings (order_ratings_vendor_created_idx), with order code and customer name batch-resolved. */
export async function loadRecentVendorRatings(admin: AdminClient, vendorId: string, limit = 20): Promise<VendorRatingView[]> {
  const rows =
    unwrap(
      await admin
        .from("order_ratings")
        .select("order_id, customer_id, vendor_rating, vendor_comment, created_at")
        .eq("vendor_id", vendorId)
        .order("created_at", { ascending: false })
        .limit(limit),
    ) ?? [];
  if (rows.length === 0) return [];

  const [codes, customers] = await Promise.all([
    loadOrderCodes(admin, rows.map((row) => row.order_id)),
    loadProfiles(admin, rows.map((row) => row.customer_id)),
  ]);
  return rows.map((row) => ({
    orderId: row.order_id,
    orderCode: codes.get(row.order_id) ?? null,
    rating: row.vendor_rating,
    comment: row.vendor_comment,
    customerName: customers.get(row.customer_id)?.fullName ?? null,
    createdAt: row.created_at,
  }));
}

/** A rider's newest ratings (order_ratings_rider_created_idx); rows without a rider rating are never stored against the rider. */
export async function loadRecentRiderRatings(admin: AdminClient, riderId: string, limit = 20): Promise<RiderRatingView[]> {
  const rows =
    unwrap(
      await admin
        .from("order_ratings")
        .select("order_id, rider_rating, rider_comment, created_at")
        .eq("rider_id", riderId)
        .order("created_at", { ascending: false })
        .limit(limit),
    ) ?? [];
  if (rows.length === 0) return [];

  const codes = await loadOrderCodes(admin, rows.map((row) => row.order_id));
  return rows.flatMap((row) =>
    row.rider_rating == null
      ? []
      : [
          {
            orderId: row.order_id,
            orderCode: codes.get(row.order_id) ?? null,
            rating: row.rider_rating,
            comment: row.rider_comment,
            createdAt: row.created_at,
          },
        ],
  );
}
