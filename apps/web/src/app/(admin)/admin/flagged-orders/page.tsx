import { listFlaggedOrders, type CaptureAnomaly } from "@/lib/admin/flagged";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime, humanize, money } from "../../_components/format";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { pageParam, type SearchParams } from "../../_components/search-params";

export const metadata: Metadata = { title: "Flagged orders" };

const ANOMALY_TONE: Record<CaptureAnomaly, "danger" | "warning"> = {
  amount_mismatch: "danger",
  underpaid_capture: "danger",
  duplicate_capture: "warning",
};

function metaValue(meta: unknown, key: string): unknown {
  return typeof meta === "object" && meta !== null && !Array.isArray(meta) ? (meta as Record<string, unknown>)[key] : undefined;
}

function metaMoney(meta: unknown, key: string): string {
  const value = Number(metaValue(meta, key));
  return Number.isFinite(value) ? money(value) : "—";
}

/**
 * "Flagged" = an order_events row written by capture_payment() with an
 * amount_mismatch, duplicate_capture_attempt or underpaid_capture marker.
 * Read-only here; open the order to refund it or inspect its ledger.
 */
export default async function FlaggedOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();

  const flagged = await listFlaggedOrders({ page: pageParam((await searchParams).page) });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <PageHeader
        title="Flagged orders"
        description="Payment-capture anomalies recorded by capture_payment(): an amount that did not match the order total, an underpayment, or a second payment against an order that was already paid."
      />

      {flagged.rows.length === 0 ? (
        <EmptyState title="No flagged orders" description="No capture anomalies recorded." />
      ) : (
        flagged.rows.map((event) => (
          <Card key={event.eventId}>
            <CardHeader>
              <CardTitle>
                <Link href={`/admin/orders/${event.orderId}`} className="text-brand-600 hover:underline">
                  Order {event.orderCode ?? event.orderId}
                </Link>
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                {event.anomalies.map((anomaly) => (
                  <Badge key={anomaly} tone={ANOMALY_TONE[anomaly]}>
                    {humanize(anomaly)}
                  </Badge>
                ))}
              </div>
            </CardHeader>
            <CardBody>
              <p>
                Customer: {event.customerName ?? "Unknown"}
                {event.orderTotalKobo !== null && <> · Order total {money(event.orderTotalKobo)}</>}
              </p>
              <p className="mt-1 text-xs">{formatDateTime(event.at)}</p>

              {(event.anomalies.includes("amount_mismatch") || event.anomalies.includes("underpaid_capture")) && (
                <div className="mt-3 rounded-control bg-danger-surface p-3 text-danger">
                  Paid: {metaMoney(event.meta, "paid_amount_kobo")} vs expected: {metaMoney(event.meta, "expected_total_kobo")}
                </div>
              )}

              {event.anomalies.includes("duplicate_capture") && (
                <div className="mt-3 flex flex-col gap-1 rounded-control bg-warning-surface p-3 text-warning">
                  <span>Existing provider ref: {String(metaValue(event.meta, "existing_provider_ref") ?? "—")}</span>
                  <span>New provider ref: {String(metaValue(event.meta, "new_provider_ref") ?? "—")}</span>
                  <span>New amount: {metaMoney(event.meta, "new_amount_kobo")}</span>
                </div>
              )}
            </CardBody>
          </Card>
        ))
      )}

      <Pagination
        basePath="/admin/flagged-orders"
        params={{}}
        page={flagged.page}
        pageSize={flagged.pageSize}
        total={flagged.total}
      />
    </div>
  );
}
