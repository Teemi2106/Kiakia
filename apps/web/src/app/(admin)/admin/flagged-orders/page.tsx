import { listFlaggedOrders, type CaptureAnomaly } from "@/lib/admin/flagged";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, buttonVariants } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime, money } from "../../_components/format";
import { ANOMALY_LABELS } from "../../_components/labels";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { pageParam, type SearchParams } from "../../_components/search-params";

export const metadata: Metadata = { title: "Problems to review" };

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
  return Number.isFinite(value) ? money(value) : "an unknown amount";
}

/** What happened and what to do, in words, for each kind of payment problem. */
function Explanation({ anomaly, meta }: { anomaly: CaptureAnomaly; meta: unknown }) {
  switch (anomaly) {
    case "amount_mismatch":
      return (
        <>
          <p>
            The customer paid <strong>{metaMoney(meta, "paid_amount_kobo")}</strong> but the order total was{" "}
            <strong>{metaMoney(meta, "expected_total_kobo")}</strong>. The order went ahead as paid.
          </p>
          <p className="mt-1 text-ink-muted">
            What to do: check the payment in Monnify. If the customer paid too much, send the difference back to them.
          </p>
        </>
      );
    case "underpaid_capture":
      return (
        <>
          <p>
            The customer paid only <strong>{metaMoney(meta, "paid_amount_kobo")}</strong> for an order of{" "}
            <strong>{metaMoney(meta, "expected_total_kobo")}</strong>. The order was not marked as paid, and what they paid was added to
            their KiaKia wallet.
          </p>
          <p className="mt-1 text-ink-muted">
            What to do: usually nothing, since no money is lost. The customer can pay again. Contact them if they are stuck.
          </p>
        </>
      );
    case "duplicate_capture":
      return (
        <>
          <p>
            The customer paid twice for this order. The second payment (reference{" "}
            <span className="font-mono text-xs">{String(metaValue(meta, "new_provider_ref") ?? "unknown")}</span>,{" "}
            <strong>{metaMoney(meta, "new_amount_kobo")}</strong>) was not added to the money records.
          </p>
          <p className="mt-1 text-ink-muted">
            What to do: find the second payment in Monnify and refund it to the customer. The first payment is fine.
          </p>
        </>
      );
  }
}

/**
 * "Problems" = an order_events row written when a payment was captured with an
 * amount_mismatch, duplicate_capture_attempt or underpaid_capture marker.
 * Read-only here; open the order to refund it or inspect its money records.
 */
export default async function FlaggedOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();

  const flagged = await listFlaggedOrders({ page: pageParam((await searchParams).page) });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <PageHeader
        title="Problems to review"
        description="Orders where a customer's payment did not go through cleanly: they paid the wrong amount or paid twice. Each one says what happened and what to do."
      />

      {flagged.rows.length === 0 ? (
        <EmptyState title="No problems to review" description="Every payment so far has matched its order." />
      ) : (
        flagged.rows.map((event) => (
          <Card key={event.eventId}>
            <CardHeader>
              <CardTitle>Order {event.orderCode ?? event.orderId}</CardTitle>
              <div className="flex flex-wrap gap-2">
                {event.anomalies.map((anomaly) => (
                  <Badge key={anomaly} tone={ANOMALY_TONE[anomaly]}>
                    {ANOMALY_LABELS[anomaly]}
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

              <div className="mt-3 flex flex-col gap-3 rounded-control bg-surface-sunken p-3 text-sm text-ink">
                {event.anomalies.map((anomaly) => (
                  <div key={anomaly}>
                    <Explanation anomaly={anomaly} meta={event.meta} />
                  </div>
                ))}
              </div>

              <Link href={`/admin/orders/${event.orderId}`} className={`${buttonVariants({ variant: "secondary", size: "sm" })} mt-3`}>
                Open order
              </Link>
            </CardBody>
          </Card>
        ))
      )}

      <Pagination basePath="/admin/flagged-orders" params={{}} page={flagged.page} pageSize={flagged.pageSize} total={flagged.total} />
    </div>
  );
}
