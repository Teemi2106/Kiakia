import "server-only";
import type { Json } from "@kiakia/db";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProfiles, unwrap } from "./lookups";
import { distinctIds, pageWindow, type Page, type PageParams } from "./query";

export type CaptureAnomaly = "amount_mismatch" | "duplicate_capture" | "underpaid_capture";

export interface FlaggedOrderEvent {
  readonly eventId: string;
  readonly orderId: string;
  readonly orderCode: string | null;
  readonly orderTotalKobo: number | null;
  readonly customerName: string | null;
  readonly anomalies: readonly CaptureAnomaly[];
  /** paid_amount_kobo, expected_total_kobo, existing_provider_ref, new_provider_ref, new_amount_kobo, as the anomaly applies. */
  readonly meta: Json;
  readonly at: string;
}

/** Capture anomalies recorded in order_events by capture_payment(), newest first. */
export async function listFlaggedOrders(params: PageParams = {}): Promise<Page<FlaggedOrderEvent>> {
  await requireAdminContext();
  const admin = createAdminClient();
  const { page, pageSize, from, to } = pageWindow(params);

  const { data, error, count } = await admin
    .from("order_events")
    .select("id, order_id, at, meta", { count: "exact" })
    .or("meta->>amount_mismatch.eq.true,meta->>duplicate_capture_attempt.eq.true,meta->>underpaid_capture.eq.true")
    .order("at", { ascending: false })
    .range(from, to);
  if (error) throw new Error(error.message);
  const events = data ?? [];

  const orders = events.length
    ? (unwrap(
        await admin
          .from("orders")
          .select("id, code, total_kobo, customer_id")
          .in(
            "id",
            distinctIds(events.map((event) => event.order_id)),
          ),
      ) ?? [])
    : [];
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const customers = await loadProfiles(
    admin,
    orders.map((order) => order.customer_id),
  );

  return {
    rows: events.map((event) => {
      const order = orderById.get(event.order_id);
      return {
        eventId: event.id,
        orderId: event.order_id,
        orderCode: order?.code ?? null,
        orderTotalKobo: order?.total_kobo ?? null,
        customerName: order ? (customers.get(order.customer_id)?.fullName ?? null) : null,
        anomalies: anomaliesOf(event.meta),
        meta: event.meta,
        at: event.at,
      };
    }),
    total: count ?? 0,
    page,
    pageSize,
  };
}

function anomaliesOf(meta: Json): CaptureAnomaly[] {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return [];
  const flagged = (key: string) => meta[key] === true || meta[key] === "true";
  const anomalies: CaptureAnomaly[] = [];
  if (flagged("amount_mismatch")) anomalies.push("amount_mismatch");
  if (flagged("duplicate_capture_attempt")) anomalies.push("duplicate_capture");
  if (flagged("underpaid_capture")) anomalies.push("underpaid_capture");
  return anomalies;
}
