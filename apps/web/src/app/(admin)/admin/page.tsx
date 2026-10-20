import { getDashboardMetrics, listPayables } from "@/lib/admin/finance";
import { listFlaggedOrders } from "@/lib/admin/flagged";
import { listOrders, type OrderListItem } from "@/lib/admin/orders";
import { countVendorsByStatus } from "@/lib/admin/vendors";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, Card, CardBody, EmptyState, OrderStatusBadge } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime, humanize, money } from "../_components/format";
import { ANOMALY_LABELS } from "../_components/labels";
import { PageHeader } from "../_components/PageHeader";
import { Section } from "../_components/Section";

export const metadata: Metadata = { title: "Admin overview" };

const PIPELINE_STATUSES = [
  "placed",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "rider_assigned",
  "picked_up",
  "in_transit",
  "arrived",
] as const;

export default async function AdminOverviewPage() {
  await requireAdminContext();

  const [metrics, flagged, readyOrders, arrivedOrders, failedOrders, vendorCounts, owed] = await Promise.all([
    getDashboardMetrics(),
    listFlaggedOrders({ pageSize: 5 }),
    listOrders({ status: "ready_for_pickup", pageSize: 5 }),
    listOrders({ status: "arrived", pageSize: 5 }),
    listOrders({ status: "failed_delivery", pageSize: 5 }),
    countVendorsByStatus(),
    listPayables({ pageSize: 1 }),
  ]);

  const { stuck_orders: stuck, capture_anomalies_7d: anomalies, gateway_refunds: refunds } = metrics;
  const anomalyTotal = anomalies.duplicate_capture + anomalies.underpaid_capture + anomalies.amount_mismatch;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Overview"
        description={`What is happening on KiaKia, and what needs you. Updated ${formatDateTime(metrics.generated_at)}.`}
      />

      <Section title="Needs attention">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AttentionCount label="Vendors waiting for approval" count={vendorCounts.pending} href="/admin/vendors?status=pending" />
          <AttentionCount
            label="Riders waiting for approval"
            count={metrics.riders.pending_kyc}
            href="/admin/riders?state=pending"
            hint={`${metrics.riders.documents_pending} documents to check`}
          />
          <AttentionCount label="Payment problems this week" count={anomalyTotal} href="/admin/flagged-orders" />
          <AttentionCount
            label="People waiting to be paid"
            count={owed.total}
            href="/admin/payouts"
            hint={owed.total > 0 ? `${money(owed.totalOwedKobo)} owed` : undefined}
          />
        </ul>
      </Section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Delivered, last 24 hours" value={String(metrics.delivered.last_24h.orders)} hint={money(metrics.delivered.last_24h.gmv_kobo)} />
        <Metric label="Delivered, last 7 days" value={String(metrics.delivered.last_7d.orders)} hint={money(metrics.delivered.last_7d.gmv_kobo)} />
        <Metric label="Delivered, last 30 days" value={String(metrics.delivered.last_30d.orders)} hint={money(metrics.delivered.last_30d.gmv_kobo)} />
        <Metric label="KiaKia earnings, last 30 days" value={money(metrics.platform_revenue_30d_kobo)} />
        <Metric label="Riders online" value={String(metrics.riders.online)} />
        <Metric label="Vendors suspended" value={String(metrics.vendors_suspended)} href="/admin/vendors?status=suspended" />
        <Metric
          label="Card refunds in progress"
          value={String(refunds.pending + refunds.failed + refunds.not_requested)}
          hint={`${refunds.pending} waiting for Monnify, ${refunds.failed} failed, ${refunds.not_requested} not yet sent`}
          alert={refunds.failed + refunds.not_requested > 0}
        />
      </div>

      <Section title="Orders in progress">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PIPELINE_STATUSES.map((status) => (
            <Link
              key={status}
              href={`/admin/orders?status=${status}`}
              className="rounded-control border border-border px-3 py-2 hover:bg-surface-sunken"
            >
              <p className="text-xs text-ink-muted">{humanize(status)}</p>
              <p className="text-lg font-semibold text-ink">{metrics.orders_by_status[status]}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Orders that need a hand">
        <ul className="grid gap-3 sm:grid-cols-3">
          <AttentionCount label="Ready for pickup, no rider after 15 minutes" count={stuck.ready_without_rider} href="/admin/orders?status=ready_for_pickup" />
          <AttentionCount label="Delivery code locked after too many wrong tries" count={stuck.delivery_code_locked} href="/admin/orders?status=arrived" />
          <AttentionCount label="Delivery failed, customer's money still held" count={stuck.failed_delivery_escrow_held} href="/admin/orders?status=failed_delivery" />
        </ul>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <OrderList title="Ready for pickup" href="/admin/orders?status=ready_for_pickup" orders={readyOrders.rows} />
        <OrderList title="Rider has arrived" href="/admin/orders?status=arrived" orders={arrivedOrders.rows} />
        <OrderList title="Failed deliveries" href="/admin/orders?status=failed_delivery" orders={failedOrders.rows} />

        <Section
          title="Latest payment problems"
          aside={
            <Link href="/admin/flagged-orders" className="text-sm text-brand-600 hover:underline">
              View all
            </Link>
          }
        >
          {flagged.rows.length === 0 ? (
            <EmptyState title="No payment problems" description="Orders with a payment that looks wrong will be listed here." />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {flagged.rows.map((event) => (
                <li key={event.eventId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/admin/orders/${event.orderId}`} className="font-medium text-brand-600 hover:underline">
                    {event.orderCode ?? event.orderId}
                  </Link>
                  <span className="flex flex-wrap justify-end gap-1">
                    {event.anomalies.map((anomaly) => (
                      <Badge key={anomaly} tone="danger">
                        {ANOMALY_LABELS[anomaly]}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  href,
  alert,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  alert?: boolean;
}) {
  const body = (
    <Card className={alert ? "border-danger" : href ? "hover:bg-surface-sunken" : undefined}>
      <CardBody>
        <p className="text-xs uppercase tracking-wide">{label}</p>
        <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
        {hint && <p className="mt-0.5 text-xs">{hint}</p>}
      </CardBody>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function AttentionCount({ label, count, href, hint }: { label: string; count: number; href: string; hint?: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2 hover:bg-surface-sunken"
      >
        <span className="min-w-0 text-sm text-ink">
          {label}
          {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
        </span>
        <Badge tone={count > 0 ? "danger" : "positive"}>{count > 0 ? count : "None"}</Badge>
      </Link>
    </li>
  );
}

function OrderList({ title, href, orders }: { title: string; href: string; orders: readonly OrderListItem[] }) {
  return (
    <Section
      title={title}
      aside={
        <Link href={href} className="text-sm text-brand-600 hover:underline">
          View all
        </Link>
      }
    >
      {orders.length === 0 ? (
        <EmptyState title="None right now" description="Nothing in this state at the moment." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {orders.map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <Link href={`/admin/orders/${order.id}`} className="font-medium text-brand-600 hover:underline">
                  {order.code}
                </Link>
                <p className="truncate text-xs text-ink-muted">
                  {order.vendorName ?? "Unknown vendor"} · {formatDateTime(order.createdAt)}
                </p>
              </div>
              <OrderStatusBadge status={order.status} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
